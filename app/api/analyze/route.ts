import { NextResponse } from 'next/server';
import dns from 'node:dns/promises';
import net from 'node:net';

export const runtime = 'nodejs';
const MAX_HTML = 3_000_000;
const MAX_PAGES = 6;

function abs(value: string, base: string) { try { return new URL(value, base).href; } catch { return ''; } }
function cleanText(value: string) { return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function isPrivateIp(value: string) {
  if (!net.isIP(value)) return false;
  const ip = value.toLowerCase();
  return ip === '127.0.0.1' || ip === '::1' || ip === '0.0.0.0' || ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.') || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip) || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:');
}
async function assertPublicUrl(raw: string) {
  const u = new URL(raw);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only http and https URLs are supported.');
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || isPrivateIp(host)) throw new Error('Local and internal addresses are not allowed.');
  try { const records = await dns.lookup(host, { all: true }); if (records.some(record => isPrivateIp(record.address))) throw new Error('The hostname resolves to a private or local address.'); } catch (error) { if (error instanceof Error && /private|local/i.test(error.message)) throw error; }
}
function parseAnchors(html: string, base: string) {
  return [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(m => ({ text: cleanText(m[2]), url: abs(m[1], base) })).filter(x => x.text && x.url);
}
function parseForms(html: string, base: string) {
  return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].map(m => {
    const attrs = m[1]; const body = m[2];
    const action = attrs.match(/action=["']([^"']*)["']/i)?.[1] || base;
    const method = (attrs.match(/method=["']([^"']+)["']/i)?.[1] || 'get').toLowerCase();
    const input = body.match(/<(?:input|textarea)\b[^>]*(?:name|id)=["']([^"']*(?:q|query|search|keyword|term)[^"']*)["'][^>]*>/i)?.[1] || 'q';
    return { action: abs(action, base), method, input };
  }).filter(x => x.action);
}
function jsonLd(html: string) {
  const out: any[] = []; const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi; let m: RegExpExecArray | null;
  while ((m = re.exec(html))) { try { const v = JSON.parse(m[1].trim()); if (Array.isArray(v)) out.push(...v); else if (v && Array.isArray(v['@graph'])) out.push(...v['@graph']); else out.push(v); } catch {} }
  return out;
}
function mediaUrls(html: string, base: string) {
  return [...html.matchAll(/(?:https?:)?\/\/[^\s"'<>]+\.(?:m3u8|mp4|webm)(?:\?[^\s"'<>]*)?/gi)].map(m => abs(m[0], base)).filter(Boolean).slice(0, 30);
}
function apiHints(html: string, base: string) {
  const hints = [...html.matchAll(/(?:https?:)?\/\/[^\s"'<>]*(?:\/api\/|\/graphql|\.json(?:\?|$)|ajax|player|stream)[^\s"'<>]*/gi)].map(m => abs(m[0], base)).filter(Boolean);
  return [...new Set(hints)].slice(0, 20);
}
function classify(url: string, home: string) {
  try {
    const p = new URL(url).pathname.toLowerCase();
    if (url === home) return 'home';
    if (/\/(?:category|categories|genre|genres|collection|collections|browse|catalog|popular|latest|trending|movies?|shows?|series|anime|tv)(?:\/|$)/i.test(p)) return 'category';
    if (/\/(?:watch|play|episode|ep|movie|film|show|series|anime|title|detail)(?:[-_\/]|\d|$)/i.test(p)) return 'detail';
    return 'other';
  } catch { return 'other'; }
}
async function fetchPage(url: string, signal: AbortSignal) {
  await assertPublicUrl(url);
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 VegaProviderGenerator/2.0' }, redirect: 'follow', signal });
  await assertPublicUrl(r.url);
  const contentLength = Number(r.headers.get('content-length') || 0);
  if (contentLength > MAX_HTML) throw new Error('The page is too large to analyze (3 MB limit).');
  return { url: r.url, status: r.status, contentType: r.headers.get('content-type') || '', html: (await r.text()).slice(0, MAX_HTML) };
}

export async function POST(req: Request) {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 18000);
  try {
    const { url } = await req.json();
    if (!url || !/^https?:\/\//i.test(url)) return NextResponse.json({ error: 'Enter a valid http/https URL.' }, { status: 400 });
    const first = await fetchPage(url, controller.signal); const origin = new URL(first.url).origin;
    const allLinks = parseAnchors(first.html, first.url); const sameHost = allLinks.filter(x => { try { return new URL(x.url).origin === origin; } catch { return false; } });
    const categoryLinks = sameHost.filter(x => /\/(?:category|categories|genre|genres|collection|collections|browse|catalog|popular|latest|trending|movies?|shows?|series|anime|tv)(?:\/|$)/i.test(new URL(x.url).pathname)).slice(0, 20);
    const detailLinks = sameHost.filter(x => /\/(?:watch|play|episode|ep|movie|film|show|series|anime|title|detail)(?:[-_\/]|\d|$)/i.test(new URL(x.url).pathname)).slice(0, 24);
    const candidates = [...new Map([first.url, ...categoryLinks.map(x => x.url), ...detailLinks.map(x => x.url)].map(u => [u, u])).values()].slice(0, MAX_PAGES);
    const pages: any[] = [];
    for (const candidate of candidates) {
      if (candidate === first.url) { pages.push({ url: first.url, status: first.status, contentType: first.contentType, html: first.html }); continue; }
      try { pages.push({ ...(await fetchPage(candidate, controller.signal)) }); } catch {}
      if (pages.length >= MAX_PAGES) break;
    }
    const combinedLinks = pages.flatMap(p => parseAnchors(p.html, p.url));
    const links = [...new Map(combinedLinks.map(x => [x.url, x])).values()].slice(0, 300);
    const images = [...new Set(pages.flatMap(p => { const meta = [...p.html.matchAll(/<meta\b[^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["']([^"']+)/gi)].map(m => abs(m[1], p.url)); const imgs = [...p.html.matchAll(/<img\b[^>]*(?:src|data-src)=["']([^"']+)/gi)].map(m => abs(m[1], p.url)); return [...meta, ...imgs].filter(v => /\.(?:jpg|jpeg|png|webp|gif)(?:$|\?)/i.test(v)); }))].slice(0, 20);
    const videos = [...new Set(pages.flatMap(p => [...p.html.matchAll(/<(?:video|source)\b[^>]*(?:src|data-src|data-url)=["']([^"']+)/gi)].map(m => abs(m[1], p.url)).filter(Boolean)))].slice(0, 30);
    const streams = [...new Set(pages.flatMap(p => mediaUrls(p.html, p.url)))].slice(0, 40);
    const iframes = [...new Set(pages.flatMap(p => [...p.html.matchAll(/<iframe\b[^>]*src=["']([^"']+)/gi)].map(m => abs(m[1], p.url)).filter(Boolean)))].slice(0, 30);
    const forms = pages.flatMap(p => parseForms(p.html, p.url));
    const search = forms.find(x => /^(get|post)$/i.test(x.method) && /q|query|search|keyword|term/i.test(x.input)) || null;
    const api = [...new Set(pages.flatMap(p => apiHints(p.html, p.url)))].slice(0, 30);
    const structuredTitles = pages.flatMap(p => jsonLd(p.html)).map(x => x?.name).filter(Boolean).slice(0, 20);
    const categories = [...new Set(categoryLinks.map(x => x.text).filter(x => x.length > 2 && x.length < 80))].slice(0, 30);
    const samples = pages.map(p => ({ url: p.url, title: p.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || new URL(p.url).hostname, kind: classify(p.url, first.url), links: parseAnchors(p.html, p.url).slice(0, 80), streams: mediaUrls(p.html, p.url), iframes: [...p.html.matchAll(/<iframe\b[^>]*src=["']([^"']+)/gi)].map(m => abs(m[1], p.url)).filter(Boolean).slice(0, 10) }));
    const title = first.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || new URL(first.url).hostname;
    const description = first.html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)?.[1] || '';
    return NextResponse.json({ url: first.url, title, description, images, videos, streams, iframes, links, categories, categoryLinks, detailLinks, search, apiHints: api, structuredTitles, samplePages: samples, crawledPages: pages.length, status: first.status, contentType: first.contentType, dynamicHint: streams.length === 0 && (iframes.length > 0 || /<script\b/i.test(first.html)), warnings: [ ...(detailLinks.length ? [] : ['No obvious detail-page links were found; metadata/episodes may need manual adjustment.']), ...(streams.length || iframes.length ? [] : ['No public stream URL or iframe was visible in analyzed HTML; the generated provider will rely on WebView and may still need site-specific player logic.']), ...(search ? [] : ['No reliable GET/POST search form was found; search will fall back to homepage filtering.']) ] });
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError' ? 'The website took too long to analyze.' : String(error instanceof Error ? error.message : error);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally { clearTimeout(timeout); }
}
