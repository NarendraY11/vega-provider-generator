'use client';
import { useState } from 'react';

export default function Home() {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [a, setA] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [zip, setZip] = useState<any>(null);

  async function analyze() {
    setLoading(true); setError(''); setZip(null);
    try {
      const r = await fetch('/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
      const d = await r.json(); if (!r.ok) throw Error(d.error); setA(d); if (!name) setName(d.title || 'Website Provider');
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }

  async function generate() {
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ analysis: a, name }) });
      const d = await r.json(); if (!r.ok) throw Error(d.error); setZip(d);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }

  function download() {
    const bin = atob(zip.base64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const b = new Blob([bytes], { type: 'application/zip' }); const x = document.createElement('a'); x.href = URL.createObjectURL(b); x.download = zip.filename; x.click();
  }

  return <main className="wrap">
    <section className="hero"><span className="badge">VEGA • PROVIDER GENERATOR</span><h1>Turn a public website into a Vega provider.</h1><p>Analyze the site's public structure, then generate the current Vega provider files: catalog, posts, metadata, streams and episode handling. JavaScript-heavy sites get a WebView fallback inside the generated provider.</p></section>
    <div className="card">
      <div className="row"><input className="input" placeholder="https://example.com" value={url} onChange={e => setUrl(e.target.value)} /><button className="btn" onClick={analyze} disabled={loading || !url}>{loading ? 'Working…' : 'Analyze'}</button></div>
      {a && <>
        <div className="grid">
          <div className="panel"><h3>Website</h3><div>{a.title}</div><p className="muted">HTTP {a.status} • {a.contentType}</p></div>
          <div className="panel"><h3>Detection</h3><div className="success">{a.links.length} links • {a.iframes.length} embeds • {a.streams.length} direct streams</div><p className="muted">{a.dynamicHint ? 'This page looks JavaScript-heavy. The generated provider will try normal HTTP first, then Vega openWebView.' : 'The analyzer found usable public HTML. The generated provider still uses WebView as a fallback when needed.'}</p></div>
        </div>
        {a.categories?.length > 0 && <div className="chips">{a.categories.slice(0, 15).map((x: string) => <span className="chip" key={x}>{x}</span>)}</div>}
        <div style={{ marginTop: 18 }} className="row"><input className="input" placeholder="Provider name" value={name} onChange={e => setName(e.target.value)} /><button className="btn" onClick={generate} disabled={loading || !name}>Generate ZIP</button></div>
        <p className="muted" style={{ marginTop: 12 }}>Important: analysis cannot guarantee that a site's player API or stream resolver is publicly exposed. Generated code should be tested in the official Vega provider template.</p>
      </>}
      {error && <div className="error">{error}</div>}
      {zip && <div className="panel" style={{ marginTop: 16 }}><h3 className="success">Provider generated successfully</h3><p className="muted">{zip.files.length} files created, including optional episode support. Put the provider folder into your Vega providers repository, merge its manifest entry, then run the official template build and provider tests.</p><button className="btn" style={{ height: 44 }} onClick={download}>Download provider ZIP</button></div>}
    </div>
    <div className="footer">Only use sources you are authorized to access. This tool does not bypass DRM, authentication, paywalls, or anti-bot protections. Vega requires the provider repository's built <code>dist/</code> files before the app can download the provider modules.</div>
  </main>;
}
