import { NextResponse } from 'next/server';
import dns from 'node:dns/promises';
import net from 'node:net';

export const runtime = 'nodejs';

function abs(value: string, base: string) {
  try {
    return new URL(value, base).href;
  } catch {
    return '';
  }
}

function cleanText(value: string) {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function isPrivateIp(value: string) {
  if (!net.isIP(value)) return false;
  const ip = value.toLowerCase();
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '0.0.0.0' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('169.254.') ||
    ip.startsWith('172.16.') || ip.startsWith('172.17.') || ip.startsWith('172.18.') || ip.startsWith('172.19.') ||
    ip.startsWith('172.20.') || ip.startsWith('172.21.') || ip.startsWith('172.22.') || ip.startsWith('172.23.') ||
    ip.startsWith('172.24.') || ip.startsWith('172.25.') || ip.startsWith('172.26.') || ip.startsWith('172.27.') ||
    ip.startsWith('172.28.') || ip.startsWith('172.29.') || ip.startsWith('172.30.') || ip.startsWith('172.31.') ||
    ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')
  );
}

async function assertPublicUrl(raw: string) {
  const u = new URL(raw);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only http and https URLs are supported.');
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Local and internal addresses are not allowed.');
  }
  if (isPrivateIp(host)) throw new Error('Private or local IP addresses are not allowed.');
  try {
    const records = await dns.lookup(host, { all: true });
    if (records.some(record => isPrivateIp(record.address))) throw new Error('The hostname resolves to a private or local address.');
  } catch (error) {
    if (error instanceof Error && /private|local/i.test(error.message)) throw error;
  }
}

function parseAnchors(html: string, base: string) {
  return [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map(match => ({ text: cleanText(match[2]), url: abs(match[1], base) }))
    .filter(item => item.text && item.url);
}

function parseForms(html: string, base: string) {
  return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].map(match => {
    const attrs = match[1];
    const body = match[2];
    const actionMatch = attrs.match(/action=["']([^"']*)["']/i);
    const methodMatch = attrs.match(/method=["']([^"']+)["']/i);
    const inputMatch = body.match(/<input\b[^>]*(?:name|id)=["']([^"']*(?:q|query|search|keyword)[^"']*)["'][^>]*>/i);
    return {
      action: abs(actionMatch?.[1] || base, base),
      method: (methodMatch?.[1] || 'get').toLowerCase(),
      input: inputMatch?.[1] || 'q',
    };
  }).filter(form => form.action);
}

export async function POST(req: Request) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const { url } = await req.json();
    if (!url || !/^https?:\/\//i.test(url)) return NextResponse.json({ error: 'Enter a valid http/https URL.' }, { status: 400 });
    await assertPublicUrl(url);
    const r = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 VegaProviderGenerator/1.1' },
      redirect: 'follow',
      signal: controller.signal,
    });
    await assertPublicUrl(r.url);
    const contentLength = Number(r.headers.get('content-length') || 0);
    if (contentLength > 4_000_000) throw new Error('The page is too large to analyze (4 MB limit).');
    const html = (await r.text()).slice(0, 4_000_000);
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || new URL(r.url).hostname;
    const description = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)?.[1] || '';
    const images = [...html.matchAll(/<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)/gi)].map(x => abs(x[1], r.url)).filter(Boolean).slice(0, 10);
    const videos = [...html.matchAll(/<(?:video|source)\b[^>]*(?:src|data-src|data-url)=["']([^"']+)/gi)].map(x => abs(x[1], r.url)).filter(Boolean).slice(0, 30);
    const streams = [...html.matchAll(/(?:https?:)?\/\/[^\s"'<>]+\.(?:m3u8|mp4)(?:\?[^\s"'<>]*)?/gi)].map(x => abs(x[0], r.url)).filter(Boolean).slice(0, 30);
    const iframes = [...html.matchAll(/<iframe\b[^>]*src=["']([^"']+)/gi)].map(x => abs(x[1], r.url)).filter(Boolean).slice(0, 20);
    const links = parseAnchors(html, r.url).slice(0, 150);
    const origin = new URL(r.url).origin;
    const sameHost = links.filter(x => { try { return new URL(x.url).origin === origin; } catch { return false; } });
    const categoryLinks = sameHost.filter(x => /\/(?:category|categories|genre|genres|collection|collections|browse|catalog|popular|latest|trending|movies?|shows?|series|anime|tv)(?:\/|$)/i.test(new URL(x.url).pathname)).slice(0, 20);
    const forms = parseForms(html, r.url);
    const searchForm = forms.find(form => /get/i.test(form.method) && /q|query|search|keyword/i.test(form.input));
    const categories = [...new Set(categoryLinks.map(x => x.text).filter(x => x.length > 2 && x.length < 60))].slice(0, 20);
    return NextResponse.json({
      url: r.url,
      title,
      description,
      images,
      videos,
      streams,
      iframes,
      links,
      categories,
      categoryLinks,
      search: searchForm || null,
      status: r.status,
      contentType: r.headers.get('content-type') || '',
      dynamicHint: streams.length === 0 && (iframes.length > 0 || /<script\b/i.test(html)),
    });
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError' ? 'The website took too long to respond.' : String(error instanceof Error ? error.message : error);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    clearTimeout(timeout);
  }
}
