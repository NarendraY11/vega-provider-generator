export type Analysis={url:string;title:string;description:string;images:string[];videos:string[];streams:string[];iframes:string[];links:{text:string;url:string}[];categories:string[]};

const slug=(s:string)=>s.toLowerCase().replace(/https?:\/\//,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)||'website-provider';

export function generateProvider(a:Analysis,name:string){
  const id=slug(name);
  const base=new URL(a.url).origin;
  const usefulLinks=a.links
    .filter(x=>x.url.startsWith('http') && new URL(x.url).hostname===new URL(a.url).hostname)
    .filter(x=>x.text.length>1)
    .filter((x,i,arr)=>arr.findIndex(y=>y.url===x.url)===i)
    .slice(0,12);
  const catalog=usefulLinks.length
    ? usefulLinks.map(x=>`  { title: ${JSON.stringify(x.text.slice(0,80))}, filter: ${JSON.stringify(x.url)} },`).join('\n')
    : `  { title: ${JSON.stringify(a.title||'Home')}, filter: ${JSON.stringify(a.url)} },`;

  const posts=`import { Post, ProviderContext } from "../types";

const BASE = ${JSON.stringify(base)};

function absolute(value: string, pageUrl: string) {
  try { return new URL(value, pageUrl).href; } catch { return ""; }
}

function parsePosts(html: string, pageUrl: string, cheerio: ProviderContext["cheerio"]): Post[] {
  const $ = cheerio.load(html);
  const out: Post[] = [];
  $("a").each((_, el) => {
    const href = $(el).attr("href") || $(el).attr("data-href");
    const title = $(el).find(".title,[class*=title],h2,h3").first().text().trim() || $(el).text().replace(/\\s+/g," ").trim();
    const imageRaw = $(el).find("img").first().attr("src") || $(el).find("img").first().attr("data-src") || $(el).find("img").first().attr("data-lazy-src") || "";
    const link = href ? absolute(href, pageUrl) : "";
    const image = imageRaw ? absolute(imageRaw, pageUrl) : "";
    if (link && title && title.length >= 2 && title.length < 180 && link !== pageUrl) out.push({ title, link, image });
  });
  return out.filter((x,i,arr)=>arr.findIndex(y=>y.link===x.link)===i).slice(0,50);
}

async function getHtml(url:string, providerContext:ProviderContext) {
  const { axios, commonHeaders, openWebView } = providerContext;
  try {
    const html = String((await axios.get(url,{headers:commonHeaders})).data);
    const hasLinks = /<a\\b/i.test(html);
    if (hasLinks) return html;
  } catch {}
  const rendered = await openWebView(url,{title:"Open site",description:"Render the page so the provider can read dynamically loaded content."});
  return rendered.data;
}

export const getPosts = async function ({ filter, providerContext }: { filter:string; page:number; providerValue:string; signal:AbortSignal; providerContext:ProviderContext }): Promise<Post[]> {
  const url = filter.startsWith("http") ? filter : new URL(filter || "/", BASE).href;
  const html = await getHtml(url, providerContext);
  return parsePosts(html,url,providerContext.cheerio);
};

export const getSearchPosts = async function ({ searchQuery, providerContext }: { searchQuery:string; page:number; providerValue:string; signal:AbortSignal; providerContext:ProviderContext }): Promise<Post[]> {
  const html = await getHtml(BASE, providerContext);
  return parsePosts(html,BASE,providerContext.cheerio).filter(x=>x.title.toLowerCase().includes(searchQuery.toLowerCase()));
};`;

  const meta=`import { Info, ProviderContext } from "../types";

export const getMeta = async function ({ link, providerContext }: { link:string; providerContext:ProviderContext }): Promise<Info> {
  const { axios, cheerio, commonHeaders, openWebView } = providerContext;
  let html="";
  try { html=String((await axios.get(link,{headers:commonHeaders})).data); } catch {}
  if (!html || !/<title\\b/i.test(html)) {
    const rendered=await openWebView(link,{title:"Open item",description:"Render the item page to read its metadata."});
    html=rendered.data;
  }
  const $=cheerio.load(html);
  const image=$("meta[property=\\"og:image\\"]").attr("content") || $("meta[name=\\"twitter:image\\"]").attr("content") || $("img").first().attr("src") || "";
  return {
    title: $("meta[property=\\"og:title\\"]").attr("content") || $("title").text().trim() || "Untitled",
    synopsis: $("meta[name=\\"description\\"]").attr("content") || "",
    image,
    imdbId: "",
    type: "movie",
    linkList: [],
    webUrl: link
  };
};`;

  const stream=`import { Stream, ProviderContext } from "../types";

function findStreams(html:string, cheerio:ProviderContext["cheerio"]){
  const found:string[]=[];
  const add=(value:string)=>{try{const u=new URL(value); if(/\\.(m3u8|mp4)(?:$|[?#])/i.test(u.href)) found.push(u.href);}catch{}};
  const $=cheerio.load(html);
  $("video,source").each((_,el)=>{["src","data-src","data-url","data-file","data-video"].forEach(k=>{const v=$(el).attr(k);if(v)add(v);});});
  $("iframe").each((_,el)=>{const v=$(el).attr("src");if(v)add(v);});
  const re=/(https?:\\/\\/[^\\s'\"<>]+\\.(?:m3u8|mp4)(?:\\?[^\\s'\"<>]*)?)/gi;
  let m; while((m=re.exec(html)) && found.length<30) add(m[1]);
  return [...new Set(found)].slice(0,20);
}

export const getStream = async function ({ link, providerContext }: { link:string; type:string; signal?:AbortSignal; providerContext:ProviderContext; isDownload?:boolean }): Promise<Stream[]> {
  const { axios, commonHeaders, openWebView }=providerContext;
  let html="";
  try { html=String((await axios.get(link,{headers:commonHeaders})).data); } catch {}
  let found=findStreams(html,providerContext.cheerio);
  if(!found.length){
    try { const rendered=await openWebView(link,{title:"Open video page",description:"Render the player page to locate publicly available stream sources."}); found=findStreams(rendered.data,providerContext.cheerio); } catch {}
  }
  return found.map((u,i)=>({server:"Source "+(i+1),link:u,type:u.includes(".m3u8")?"m3u8":"mp4",quality:"Auto"}));
};`;

  const files:Record<string,string>={
    [`providers/${id}/catalog.ts`]:`export const catalog = [\n${catalog}\n];\nexport const genres = [];`,
    [`providers/${id}/posts.ts`]:posts,
    [`providers/${id}/meta.ts`]:meta,
    [`providers/${id}/stream.ts`]:stream,
    "README.md":`# ${name}\n\nGenerated Vega provider for ${a.url}.\n\nThe generated provider follows the official Vega provider structure and uses Vega's \\`openWebView\\` fallback for sites whose content is rendered by JavaScript. It does not bypass DRM, authentication, paywalls, or anti-bot protections.\n`,
    "manifest.json":JSON.stringify([{display_name:name,value:id,version:"1.0",icon:a.images[0]||"",type:"global",disabled:false}],null,2)
  };
  return {id,files};
}
