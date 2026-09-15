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
  detailLinks?: { text: string; url: string }[];
  search?: { action: string; method: string; input: string } | null;
  apiHints?: string[];
  samplePages?: { url: string; title: string; kind: string; links: { text: string; url: string }[]; streams: string[]; iframes: string[] }[];
};

const slug = (s: string) => s.toLowerCase().replace(/https?:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'website-provider';
const unique = <T,>(items: T[], key: (item: T) => string) => items.filter((item, i, all) => all.findIndex(x => key(x) === key(item)) === i);
const json = (value: unknown) => JSON.stringify(value);
const normalizeGenerated = (value: string) => value.replace(/\\\\/g, '\\');

export function generateProvider(a: Analysis, name: string) {
  const id = slug(name);
  const base = new URL(a.url).origin;
  const categoryLinks = unique((a.categoryLinks || []).filter(x => x.url.startsWith('http') && x.text.trim().length > 1), x => x.url).slice(0, 14);
  const detailLinks = unique((a.detailLinks || []).filter(x => x.url.startsWith('http') && x.text.trim().length > 1), x => x.url).slice(0, 12);
  const genreLinks = categoryLinks.filter(x => /\/(?:genre|genres)(?:\/|$)/i.test(new URL(x.url).pathname)).slice(0, 12);
  const catalog = [
    `  { title: "Home", filter: ${json(a.url)} },`,
    ...categoryLinks.map(x => `  { title: ${json(x.text.slice(0, 80))}, filter: ${json(x.url)} },`),
  ].join('\n');
  const genres = genreLinks.map(x => `  { title: ${json(x.text.slice(0, 80))}, filter: ${json(x.url)} },`).join('\n');
  const searchConfig = a.search ? json({ action: a.search.action, method: a.search.method.toLowerCase() === 'post' ? 'post' : 'get', input: a.search.input || 'q' }) : 'null';
  const hints = json({ categoryUrls: categoryLinks.map(x => x.url), detailUrls: detailLinks.map(x => x.url), apiHints: (a.apiHints || []).slice(0, 20) });

  const posts = String.raw`import { Post, ProviderContext } from "../types";

const BASE = ${json(base)};
const SEARCH = ${searchConfig};
const HINTS = ${hints};

function absolute(value: string, pageUrl: string) { try { return new URL(value, pageUrl).href; } catch { return ""; } }
function text(value: string) { return value.replace(/\s+/g, " ").trim(); }
function jsonLd(html: string) {
  const out: any[] = []; const re = /<script[^>]+type=["']application\\/ld\\+json["'][^>]*>([\\s\\S]*?)<\\/script>/gi; let m: RegExpExecArray | null;
  while ((m = re.exec(html))) { try { const v = JSON.parse(m[1].trim()); if (Array.isArray(v)) out.push(...v); else if (v && Array.isArray(v["@graph"])) out.push(...v["@graph"]); else out.push(v); } catch {} }
  return out;
}
function imageFrom(el: any, pageUrl: string) {
  const raw = el.attr("src") || el.attr("data-src") || el.attr("data-lazy-src") || el.attr("data-original") || el.attr("data-image") || el.attr("data-poster") || el.attr("poster") || el.attr("srcset")?.split(",")[0]?.trim().split(" ")[0] || "";
  return absolute(raw, pageUrl);
}
function parsePosts(html: string, pageUrl: string, cheerio: ProviderContext["cheerio"]): Post[] {
  const $ = cheerio.load(html); const out: Post[] = []; const seen = new Set<string>();
  const add = (title: string, link: string, image: string) => { title = text(title); if (!link || !image || !title || title.length < 2 || title.length > 180 || link === pageUrl || seen.has(link)) return; seen.add(link); out.push({ title, link, image }); };
  $("article a[href], .item a[href], .card a[href], .film a[href], .movie a[href], .show a[href], .poster a[href], .post a[href], a[href]").each((_, el) => {
    const link = absolute($(el).attr("href") || $(el).attr("data-href") || "", pageUrl); const img = $(el).find("img").first();
    const title = img.attr("alt") || $(el).attr("title") || $(el).attr("aria-label") || $(el).find(".title,[class*=title],h2,h3,h4").first().text() || $(el).text();
    add(title, link, imageFrom(img, pageUrl));
  });
  if (out.length < 3) for (const item of jsonLd(html)) for (const entry of item?.itemListElement || []) { const v = entry?.item || entry; add(v?.name || entry?.name || "", absolute(v?.url || entry?.url || "", pageUrl), absolute(Array.isArray(v?.image) ? v.image[0] : v?.image || "", pageUrl)); }
  return out.slice(0, 60);
}
async function fetchHtml(url: string, providerContext: ProviderContext) {
  const { axios, commonHeaders, openWebView } = providerContext;
  try { const r = await axios.get(url, { headers: commonHeaders, timeout: 15000 }); const html = String(r.data); if (html && (/<main\\b|<article\\b|application\\/ld\\+json/i.test(html) || parsePosts(html, url, providerContext.cheerio).length >= 2)) return html; } catch {}
  try { return (await openWebView(url, { title: "Render website", description: "The site may load its catalog with JavaScript." })).data; } catch { return ""; }
}
function pageUrl(url: string, page: number) { if (page <= 1) return url; try { const u = new URL(url); if (/\\/page\\/\\d+\\/?$/i.test(u.pathname)) u.pathname = u.pathname.replace(/\\/page\\/\\d+\\/?$/i, "/page/" + page + "/"); else u.searchParams.set("page", String(page)); return u.href; } catch { return url; } }

export const getPosts = async function ({ filter, page, providerContext }: { filter: string; page: number; providerValue: string; signal: AbortSignal; providerContext: ProviderContext }): Promise<Post[]> {
  const url = filter.startsWith("http") ? filter : new URL(filter || "/", BASE).href; let target = pageUrl(url, page); let html = await fetchHtml(target, providerContext); let posts = parsePosts(html, target, providerContext.cheerio);
  if (posts.length < 2 && target !== url) { target = url; html = await fetchHtml(target, providerContext); posts = parsePosts(html, target, providerContext.cheerio); }
  return posts;
};

export const getSearchPosts = async function ({ searchQuery, page, providerContext }: { searchQuery: string; page: number; providerValue: string; signal: AbortSignal; providerContext: ProviderContext }): Promise<Post[]> {
  let url = BASE;
  try {
    if (SEARCH) { const target = new URL(SEARCH.action, BASE); if (SEARCH.method === "post") { const r = await providerContext.axios.post(target.href, new URLSearchParams({ [SEARCH.input || "q"]: searchQuery, page: String(page) }), { headers: { ...providerContext.commonHeaders, "content-type": "application/x-www-form-urlencoded" }, timeout: 15000 }); const posts = parsePosts(String(r.data), target.href, providerContext.cheerio); if (posts.length) return posts; } else { target.searchParams.set(SEARCH.input || "q", searchQuery); if (page > 1) target.searchParams.set("page", String(page)); url = target.href; } }
  } catch {}
  const posts = parsePosts(await fetchHtml(url, providerContext), url, providerContext.cheerio);
  return SEARCH ? posts : posts.filter(x => x.title.toLowerCase().includes(searchQuery.toLowerCase()));
};`;

  const meta = String.raw`import { Info, ProviderContext } from "../types";
function absolute(value: string, pageUrl: string) { try { return new URL(value, pageUrl).href; } catch { return ""; } }
function text(value: string) { return value.replace(/\s+/g, " ").trim(); }
function jsonLd(html: string) { const out: any[] = []; const re = /<script[^>]+type=["']application\\/ld\\+json["'][^>]*>([\\s\\S]*?)<\\/script>/gi; let m: RegExpExecArray | null; while ((m = re.exec(html))) { try { const v = JSON.parse(m[1].trim()); if (Array.isArray(v)) out.push(...v); else if (v && Array.isArray(v["@graph"])) out.push(...v["@graph"]); else out.push(v); } catch {} } return out; }
export const getMeta = async function ({ link, providerContext }: { link: string; providerContext: ProviderContext }): Promise<Info> {
  const { axios, cheerio, commonHeaders, openWebView } = providerContext; let html = ""; try { html = String((await axios.get(link, { headers: commonHeaders, timeout: 15000 })).data); } catch {}
  const parse = (source: string) => {
    const $ = cheerio.load(source); const data = jsonLd(source); const media = data.find(x => /movie|tvseries|tvseason|creativework/i.test(String(x?.["@type"] || ""))) || data[0] || {};
    const title = text(String(media.name || $('meta[property="og:title"]').attr("content") || $("h1").first().text() || $("title").text() || "Untitled"));
    const synopsis = text(String(media.description || $('meta[property="og:description"]').attr("content") || $('meta[name="description"]').attr("content") || ""));
    const rawImage = (Array.isArray(media.image) ? media.image[0] : media.image) || $('meta[property="og:image"]').attr("content") || $('meta[name="twitter:image"]').attr("content") || $("img").first().attr("src") || "";
    const image = absolute(String(rawImage), link); const imdbId = String(media.url || "").match(/tt\d{5,10}/)?.[0] || source.match(/\btt\d{5,10}\b/)?.[0] || "";
    const tags = Array.isArray(media.genre) ? media.genre.map(String) : media.genre ? [String(media.genre)] : []; const cast = Array.isArray(media.actor) ? media.actor.map((x: any) => String(x?.name || x)).filter(Boolean) : [];
    const anchors = $("a[href]").map((_, e) => ({ title: text($(e).attr("title") || $(e).text()), link: absolute($(e).attr("href") || "", link) })).get().filter((x: any) => x.title && x.link);
    const seasons = anchors.filter((x: any) => /\bseason\s*\d+\b/i.test(x.title) || /\/season(?:[-_\/]|\d)/i.test(x.link)).slice(0, 30);
    const episodes = anchors.filter((x: any) => /\b(?:episode|ep|e)\s*\d+\b/i.test(x.title) || /\/(?:episode|ep)(?:[-_\/]|\d)/i.test(x.link)).slice(0, 80);
    const directLinks = episodes.map((x: any) => ({ title: x.title, link: x.link, type: "series" as const })); const linkList: any[] = seasons.map((x: any) => ({ title: x.title, episodesLink: x.link })); if (!linkList.length && directLinks.length) linkList.push({ title: "Episodes", directLinks });
    const type = /tv|series|show|season|episode/i.test(String(media["@type"] || "")) || seasons.length > 0 || episodes.length > 0 ? "series" : "movie";
    return { title, synopsis, image, imdbId, type, tags, cast, linkList };
  };
  let parsed = parse(html); if (!html || parsed.title === "Untitled" || (!parsed.image && !parsed.synopsis)) { try { parsed = parse((await openWebView(link, { title: "Render item", description: "Use the rendered page when normal HTTP did not expose metadata." })).data); } catch {} }
  return { title: parsed.title || "Untitled", synopsis: parsed.synopsis || "", image: parsed.image || "", imdbId: parsed.imdbId || "", type: parsed.type, tags: parsed.tags, cast: parsed.cast, linkList: parsed.linkList, webUrl: link };
};`;

  const episodes = String.raw`import { EpisodeLink, ProviderContext } from "../types";
function absolute(value: string, pageUrl: string) { try { return new URL(value, pageUrl).href; } catch { return ""; } }
function text(value: string) { return value.replace(/\s+/g, " ").trim(); }
export const getEpisodes = async function ({ url, providerContext }: { url: string; providerContext: ProviderContext }): Promise<EpisodeLink[]> {
  const { axios, cheerio, commonHeaders, openWebView } = providerContext; let html = ""; try { html = String((await axios.get(url, { headers: commonHeaders, timeout: 15000 })).data); } catch {}
  if (!html || !/<a\\b/i.test(html)) { try { html = (await openWebView(url, { title: "Open episodes", description: "Render the season page to read episode links." })).data; } catch {} }
  const $ = cheerio.load(html); const out: EpisodeLink[] = []; const seen = new Set<string>();
  $("a[href]").each((_, e) => { const title = text($(e).attr("title") || $(e).text() || ""); const link = absolute($(e).attr("href") || "", url); const image = absolute($(e).find("img").attr("src") || $(e).find("img").attr("data-src") || "", url); const episode = /\b(?:episode|ep|e)\s*\d+\b/i.test(title) || /\/(?:episode|ep)[-_\/]?\d+/i.test(link); if (link && title && episode && !seen.has(link)) { seen.add(link); out.push({ title, link, ...(image ? { image } : {}) }); } });
  return out.slice(0, 100);
};`;

  const stream = String.raw`import { Stream, ProviderContext } from "../types";
function absolute(value: string, pageUrl: string) { try { return new URL(value.split(String.fromCharCode(92) + "/").join("/"), pageUrl).href; } catch { return ""; } }
function extract(html: string, pageUrl: string, cheerio: ProviderContext["cheerio"]) {
  const $ = cheerio.load(html); const streams: string[] = []; const frames: string[] = []; const subtitles: { title: string; language: string; type: "application/x-subrip" | "application/ttml+xml" | "text/vtt"; uri: string }[] = [];
  const add = (value: string) => { const u = absolute(value, pageUrl); if (u && /\.(?:m3u8|mp4|webm)(?:$|[?#])/i.test(u) && !streams.includes(u)) streams.push(u); };
  $("video,source").each((_, e) => ["src","data-src","data-url","data-file","data-video","data-hls","data-stream","data-source"].forEach(k => { const v = $(e).attr(k); if (v) add(v); }));
  $("a[href]").each((_, e) => { const v = $(e).attr("href") || ""; if (/\.(?:m3u8|mp4|webm)(?:$|[?#])/i.test(v)) add(v); });
  $("iframe[src]").each((_, e) => { const v = $(e).attr("src"); if (v) frames.push(absolute(v, pageUrl)); });
  $("track[src]").each((_, e) => { const uri = absolute($(e).attr("src") || "", pageUrl); if (!uri) return; const raw = $(e).attr("type") || "text/vtt"; const type = raw === "application/x-subrip" || raw === "application/ttml+xml" ? raw : "text/vtt"; subtitles.push({ title: $(e).attr("label") || "Subtitles", language: $(e).attr("srclang") || "en", type, uri }); });
  for (const re of [/(?:https?:)?\/\/[^\s'\"<>]+?\.(?:m3u8|mp4|webm)(?:\?[^\s'\"<>]*)?/gi, /(?:https?:)?\/\/[^\s'\"<>]+?(?:m3u8|mp4)(?:\?[^\s'\"<>]*)?/gi]) { let m: RegExpExecArray | null; while ((m = re.exec(html)) && streams.length < 30) add(m[0]); }
  return { streams: streams.slice(0, 20), frames: [...new Set(frames)].filter(Boolean).slice(0, 6), subtitles: subtitles.slice(0, 20) };
}
export const getStream = async function ({ link, providerContext, isDownload }: { link: string; type: string; signal?: AbortSignal; providerContext: ProviderContext; isDownload?: boolean }): Promise<Stream[]> {
  const { axios, commonHeaders, openWebView } = providerContext; let html = ""; let headers: any = undefined; try { html = String((await axios.get(link, { headers: commonHeaders, timeout: 15000 })).data); } catch {}
  let result = extract(html, link, providerContext.cheerio); let found = result.streams; let subtitles = result.subtitles;
  if (!found.length) { try { const rendered = await openWebView(link, { title: "Open video page", description: "Render the player page to locate publicly available media sources." }); headers = { ...(rendered.userAgent ? { "User-Agent": rendered.userAgent } : {}), ...(rendered.cookies ? { Cookie: rendered.cookies } : {}), Referer: rendered.url || link }; result = extract(rendered.data, rendered.url || link, providerContext.cheerio); found = result.streams; subtitles = result.subtitles; if (!found.length) for (const frame of result.frames) { try { const fr = await openWebView(frame, { title: "Open embedded player", description: "Inspect the embedded player for a publicly available source." }); const nested = extract(fr.data, fr.url || frame, providerContext.cheerio); found.push(...nested.streams); subtitles.push(...nested.subtitles); if (found.length) { headers = { ...(fr.userAgent ? { "User-Agent": fr.userAgent } : {}), ...(fr.cookies ? { Cookie: fr.cookies } : {}), Referer: fr.url || frame }; break; } } catch {} } } catch {} }
  const links = [...new Set(found)].slice(0, 20); if (isDownload) links.sort((a, b) => Number(/\.mp4|\.webm/i.test(b)) - Number(/\.mp4|\.webm/i.test(a)));
  return links.map((u, i) => ({ server: "Source " + (i + 1), link: u, type: /\.m3u8(?:$|[?#])/i.test(u) ? "m3u8" : /\.webm/i.test(u) ? "webm" : "mp4", quality: /2160|4k/i.test(u) ? "2160" : /1080/i.test(u) ? "1080" : /720/i.test(u) ? "720" : "Auto", ...(subtitles.length ? { subtitles } : {}), ...(headers ? { headers } : {}) }));
};`;

  const files: Record<string, string> = {
    [`providers/${id}/catalog.ts`]: `export const catalog = [\n${catalog}\n];\nexport const genres = [\n${genres}\n];\n`,
    [`providers/${id}/posts.ts`]: normalizeGenerated(posts),
    [`providers/${id}/meta.ts`]: normalizeGenerated(meta),
    [`providers/${id}/stream.ts`]: normalizeGenerated(stream),
    [`providers/${id}/episodes.ts`]: normalizeGenerated(episodes),
    [`providers/${id}/provider-info.json`]: JSON.stringify({ generatorVersion: '2.0', source: a.url, capabilities: { catalog: true, search: Boolean(a.search), metadata: true, episodes: Boolean(detailLinks.length), streams: Boolean(a.streams?.length || a.iframes?.length), webViewFallback: true }, hints: { categoryCount: categoryLinks.length, detailCount: detailLinks.length, apiHints: a.apiHints || [] } }, null, 2),
    [`providers/${id}/README.md`]: `# ${name}\n\nGenerated Vega provider for ${a.url}.\n\nDetected ${categoryLinks.length} catalog candidates, ${detailLinks.length} detail candidates, ${a.search ? a.search.method.toUpperCase() + ' search' : 'no reliable HTML search form'}, ${a.streams?.length || 0} direct media URLs and ${a.iframes?.length || 0} embedded players.\n\nReview and test the generated source with the official Vega provider template before production use. The generator does not bypass DRM, authentication, paywalls, or anti-bot protections.\n`,
    'manifest-entry.json': JSON.stringify({ display_name: name, value: id, version: '2.0', icon: a.images[0] || '', type: 'global', disabled: false }, null, 2),
    'INTEGRATION.md': `# Add this provider to Vega\n\n1. Copy \`providers/${id}\` into the \`providers/\` folder of your Vega providers repository.\n2. Add \`manifest-entry.json\` as a new object inside the repository's existing root \`manifest.json\`. Do not replace the existing manifest.\n3. Run \`npm install\`, then \`npm run build\`.\n4. Commit the generated \`dist/\` files because Vega loads the built provider modules.\n5. Run \`npm test -- ${id}\` where supported.\n`,
    'README.md': `# ${name}\n\nGenerated Vega provider package for ${a.url}. See \`INTEGRATION.md\` for the safe manifest/build workflow.\n`,
  };
  return { id, files };
}
