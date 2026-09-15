export type Analysis = {
  url: string;
  title: string;
  description: string;
  images: string[];
  videos: string[];
  streams: string[];
  iframes: string[];
  links: { text: string; url: string }[];
  categories: string[];
  categoryLinks?: { text: string; url: string }[];
  search?: { action: string; method: string; input: string } | null;
};

const slug = (s: string) => s.toLowerCase().replace(/https?:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'website-provider';
const unique = <T,>(items: T[], key: (item: T) => string) => items.filter((item, i, all) => all.findIndex(x => key(x) === key(item)) === i);

export function generateProvider(a: Analysis, name: string) {
  const id = slug(name);
  const base = new URL(a.url).origin;
  const categoryLinks = unique((a.categoryLinks || []).filter(x => x.url.startsWith('http') && x.text.length > 1), x => x.url).slice(0, 10);
  const catalog = [
    `  { title: "Home", filter: ${JSON.stringify(a.url)} },`,
    ...categoryLinks.map(x => `  { title: ${JSON.stringify(x.text.slice(0, 80))}, filter: ${JSON.stringify(x.url)} },`),
  ].join('\n');
  const genres = categoryLinks.filter(x => /\/(?:genre|genres)(?:\/|$)/i.test(new URL(x.url).pathname)).slice(0, 12).map(x => `  { title: ${JSON.stringify(x.text.slice(0, 80))}, filter: ${JSON.stringify(x.url)} },`).join('\n');
  const searchConfig = a.search && a.search.method.toLowerCase() === 'get' ? JSON.stringify(a.search) : 'null';

  const posts = `import { Post, ProviderContext } from "../types";
const BASE = ${JSON.stringify(base)};
const SEARCH = ${searchConfig};
function absolute(value: string, pageUrl: string) { try { return new URL(value, pageUrl).href; } catch { return ""; } }
function parsePosts(html: string, pageUrl: string, cheerio: ProviderContext["cheerio"]): Post[] {
  const $ = cheerio.load(html); const out: Post[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || $(el).attr("data-href") || "";
    const link = absolute(href, pageUrl);
    const imageEl = $(el).find("img").first();
    const imageRaw = imageEl.attr("src") || imageEl.attr("data-src") || imageEl.attr("data-lazy-src") || imageEl.attr("data-original") || imageEl.attr("data-image") || imageEl.attr("srcset")?.split(",")[0]?.trim().split(" ")[0] || "";
    const image = absolute(imageRaw, pageUrl);
    const title = imageEl.attr("alt")?.trim() || $(el).attr("title")?.trim() || $(el).attr("aria-label")?.trim() || $(el).find(".title,[class*=title],h2,h3,h4").first().text().trim() || $(el).text().replace(/\\s+/g, " ").trim();
    if (link && title && title.length >= 2 && title.length < 180 && link !== pageUrl && image) out.push({ title, link, image });
  });
  return out.filter((x, i, arr) => arr.findIndex(y => y.link === x.link) === i).slice(0, 50);
}
async function fetchHtml(url: string, providerContext: ProviderContext) {
  const { axios, commonHeaders, openWebView } = providerContext;
  try { const html = String((await axios.get(url, { headers: commonHeaders, timeout: 15000 })).data); if (parsePosts(html, url, providerContext.cheerio).length >= 2 || /<main\\b|<article\\b/i.test(html)) return html; } catch {}
  const rendered = await openWebView(url, { title: "Open site", description: "Render the page so the provider can read dynamically loaded content." });
  return rendered.data;
}
export const getPosts = async function ({ filter, page, providerContext }: { filter: string; page: number; providerValue: string; signal: AbortSignal; providerContext: ProviderContext }): Promise<Post[]> {
  const url = filter.startsWith("http") ? filter : new URL(filter || "/", BASE).href;
  const pageUrl = page > 1 ? (() => { try { const u = new URL(url); u.searchParams.set("page", String(page)); return u.href; } catch { return url; } })() : url;
  let html = await fetchHtml(pageUrl, providerContext); let posts = parsePosts(html, pageUrl, providerContext.cheerio);
  if (posts.length < 2) { try { const rendered = await providerContext.openWebView(pageUrl, { title: "Render content", description: "The site may load its catalog with JavaScript." }); posts = parsePosts(rendered.data, pageUrl, providerContext.cheerio); } catch {} }
  return posts;
};
export const getSearchPosts = async function ({ searchQuery, page, providerContext }: { searchQuery: string; page: number; providerValue: string; signal: AbortSignal; providerContext: ProviderContext }): Promise<Post[]> {
  let url = BASE;
  if (SEARCH) { try { const u = new URL(SEARCH.action, BASE); u.searchParams.set(SEARCH.input || "q", searchQuery); if (page > 1) u.searchParams.set("page", String(page)); url = u.href; } catch {} }
  const html = await fetchHtml(url, providerContext);
  const posts = parsePosts(html, url, providerContext.cheerio);
  return SEARCH ? posts : posts.filter(x => x.title.toLowerCase().includes(searchQuery.toLowerCase()));
};`;

  const meta = `import { Info, ProviderContext } from "../types";
function absolute(value: string, pageUrl: string) { try { return new URL(value, pageUrl).href; } catch { return ""; } }
export const getMeta = async function ({ link, providerContext }: { link: string; providerContext: ProviderContext }): Promise<Info> {
  const { axios, cheerio, commonHeaders, openWebView } = providerContext; let html = ""; let rendered: any = null;
  try { html = String((await axios.get(link, { headers: commonHeaders, timeout: 15000 })).data); } catch {}
  const parse = (source: string) => {
    const $ = cheerio.load(source); const title = $("meta[property=\\"og:title\\"]").attr("content") || $("h1").first().text().trim() || $("title").text().trim() || "Untitled";
    const synopsis = $("meta[name=\\"description\\"]").attr("content") || $("meta[property=\\"og:description\\"]").attr("content") || "";
    const rawImage = $("meta[property=\\"og:image\\"]").attr("content") || $("img").first().attr("src") || "";
    const image = absolute(rawImage, link);
    const links = $("a[href]").map((_, e) => ({ title: $(e).text().replace(/\\s+/g, " ").trim(), link: absolute($(e).attr("href") || "", link) })).get().filter((x: any) => x.title && x.link);
    const seasonLinks = links.filter((x: any) => /\\bseason\\s*\\d+\\b/i.test(x.title) || /\\/season(?:-|\\/|$)/i.test(x.link)).slice(0, 30);
    const episodeLinks = links.filter((x: any) => /\\b(?:episode|ep)\\s*\\d+\\b/i.test(x.title)).slice(0, 30);
    const directLinks = episodeLinks.map((x: any) => ({ title: x.title, link: x.link, type: "series" as const }));
    const linkList = seasonLinks.map((x: any) => ({ title: x.title, episodesLink: x.link }));
    if (directLinks.length && !linkList.length) linkList.push({ title: "Episodes", directLinks } as any);
    return { title, synopsis, image, linkList, type: seasonLinks.length || episodeLinks.length ? "series" : "movie" };
  };
  let parsed = parse(html);
  if (!html || parsed.title === "Untitled" || (!parsed.image && !parsed.synopsis)) { try { rendered = await openWebView(link, { title: "Open item", description: "Render the item page to read its metadata." }); parsed = parse(rendered.data); } catch {} }
  return { title: parsed.title, synopsis: parsed.synopsis, image: parsed.image, imdbId: "", type: parsed.type, linkList: parsed.linkList, webUrl: link };
};`;

  const episodes = `import { EpisodeLink, ProviderContext } from "../types";
function absolute(value: string, pageUrl: string) { try { return new URL(value, pageUrl).href; } catch { return ""; } }
export const getEpisodes = async function ({ url, providerContext }: { url: string; providerContext: ProviderContext }): Promise<EpisodeLink[]> {
  const { axios, cheerio, commonHeaders, openWebView } = providerContext; let html = "";
  try { html = String((await axios.get(url, { headers: commonHeaders, timeout: 15000 })).data); } catch {}
  if (!html || !/<a\\b/i.test(html)) { try { html = (await openWebView(url, { title: "Open episodes", description: "Render the season page to read episode links." })).data; } catch {} }
  const $ = cheerio.load(html); const out: EpisodeLink[] = [];
  $("a[href]").each((_, e) => { const title = $(e).text().replace(/\\s+/g, " ").trim() || $(e).attr("title") || ""; const link = absolute($(e).attr("href") || "", url); const image = absolute($(e).find("img").attr("src") || $(e).find("img").attr("data-src") || "", url); if (link && title && (/\\b(?:episode|ep)\\s*\\d+\\b/i.test(title) || /\\/episode(?:-|\\/|$)/i.test(link))) out.push({ title, link, ...(image ? { image } : {}) }); });
  return out.filter((x, i, arr) => arr.findIndex(y => y.link === x.link) === i).slice(0, 100);
};`;

  const stream = `import { Stream, ProviderContext } from "../types";
function absolute(value: string, pageUrl: string) { try { return new URL(value, pageUrl).href; } catch { return ""; } }
function extract(html: string, pageUrl: string, cheerio: ProviderContext["cheerio"]) {
  const found: string[] = []; const frames: string[] = []; const add = (value: string) => { const u = absolute(value.replace(/\\\\\\//g, "/"), pageUrl); if (u && /\\.(m3u8|mp4)(?:$|[?#])/i.test(u)) found.push(u); };
  const $ = cheerio.load(html); $("video,source").each((_, e) => ["src","data-src","data-url","data-file","data-video","data-hls","data-stream"].forEach(k => { const v = $(e).attr(k); if (v) add(v); }));
  $("iframe[src]").each((_, e) => { const v = $(e).attr("src"); if (v) frames.push(absolute(v, pageUrl)); });
  const re = /(?:https?:)?\\/\\/[^\\s'\"<>]+?\\.(?:m3u8|mp4)(?:\\?[^\\s'\"<>]*)?/gi; let m; while ((m = re.exec(html)) && found.length < 40) add(m[0]);
  const escaped = html.replace(/\\\\\\//g, "/"); let e; const re2 = /(?:https?:)?\\/\\/[^\\s'\"<>]+?\\.(?:m3u8|mp4)(?:\\?[^\\s'\"<>]*)?/gi; while ((e = re2.exec(escaped)) && found.length < 40) add(e[0]);
  return { streams: [...new Set(found)].slice(0, 20), frames: [...new Set(frames)].filter(Boolean).slice(0, 5) };
}
export const getStream = async function ({ link, providerContext }: { link: string; type: string; signal?: AbortSignal; providerContext: ProviderContext; isDownload?: boolean }): Promise<Stream[]> {
  const { axios, commonHeaders, openWebView } = providerContext; let html = ""; let headers: any = undefined;
  try { html = String((await axios.get(link, { headers: commonHeaders, timeout: 15000 })).data); } catch {}
  let result = extract(html, link, providerContext.cheerio); let found = result.streams;
  if (!found.length) { try { const r = await openWebView(link, { title: "Open video page", description: "Render the player page to locate publicly available stream sources." }); headers = { ...(r.userAgent ? { "User-Agent": r.userAgent } : {}), ...(r.cookies ? { Cookie: r.cookies } : {}), Referer: r.url || link }; result = extract(r.data, r.url || link, providerContext.cheerio); found = result.streams; if (!found.length) for (const frame of result.frames) { try { const fr = await openWebView(frame, { title: "Open player", description: "Inspect the embedded player for a public stream source." }); const nested = extract(fr.data, fr.url || frame, providerContext.cheerio); found.push(...nested.streams); if (found.length) { headers = { ...(fr.userAgent ? { "User-Agent": fr.userAgent } : {}), ...(fr.cookies ? { Cookie: fr.cookies } : {}), Referer: fr.url || frame }; break; } } catch {} } } catch {} }
  return [...new Set(found)].slice(0, 20).map((u, i) => ({ server: "Source " + (i + 1), link: u, type: /\\.m3u8(?:$|[?#])/i.test(u) ? "m3u8" : "mp4", quality: "Auto", ...(headers ? { headers } : {}) }));
};`;

  const files: Record<string, string> = {
    [`providers/${id}/catalog.ts`]: `export const catalog = [\n${catalog}\n];\nexport const genres = [\n${genres}\n];\n`,
    [`providers/${id}/posts.ts`]: posts,
    [`providers/${id}/meta.ts`]: meta,
    [`providers/${id}/stream.ts`]: stream,
    [`providers/${id}/episodes.ts`]: episodes,
    'README.md': `# ${name}\n\nGenerated Vega provider for ${a.url}.\n\nThe provider follows the current Vega provider interfaces and uses axios/cheerio first, with Vega's openWebView fallback for JavaScript-rendered pages and embedded players. Review the generated selectors and test the provider with the official template before production use. It does not bypass DRM, authentication, paywalls, or anti-bot protections.\n`,
    'manifest.json': JSON.stringify([{ display_name: name, value: id, version: '1.1', icon: a.images[0] || '', type: 'global', disabled: false }], null, 2),
  };
  return { id, files };
}
