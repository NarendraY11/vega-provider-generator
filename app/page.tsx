'use client';
import {useState} from 'react';

export default function Home() {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [a, setA] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [zip, setZip] = useState<any>(null);

  async function analyze() {
    setLoading(true);
    setError('');
    setZip(null);
    try {
      const r = await fetch('/api/analyze', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({url: url.trim()}),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setA(d);
      if (!name) setName(d.title || 'Website Provider');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function generate() {
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/api/generate', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({analysis: a, name}),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setZip(d);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function download() {
    const bin = atob(zip.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const b = new Blob([bytes], {type: 'application/zip'});
    const x = document.createElement('a');
    x.href = URL.createObjectURL(b);
    x.download = zip.filename;
    x.click();
  }

  return (
    <main className="wrap">
      <section className="hero">
        <span className="badge">VEGA • PROVIDER GENERATOR 2.3</span>
        <h1>Turn a public website into a Vega provider.</h1>
        <p>
          Deep-analyze the site's public structure, crawl representative
          category/detail pages, and generate a Vega provider with catalog,
          posts, metadata, episodes and stream handling. JavaScript-heavy sites
          get a Vega WebView fallback.
        </p>
      </section>

      <div className="card">
        <div className="row">
          <input
            className="input"
            placeholder="https://example.com"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && url) analyze();
            }}
          />
          <button className="btn" onClick={analyze} disabled={loading || !url}>
            {loading ? 'Deep analyzing…' : 'Analyze website'}
          </button>
        </div>

        {a && (
          <>
            <div className="grid">
              <div className="panel">
                <h3>Website</h3>
                <div>{a.title}</div>
                <p className="muted">
                  HTTP {a.status} • {a.contentType}
                </p>
                <p className="muted">
                  Crawled {a.crawledPages || 1} representative page(s)
                  {a.renderedPages ? ` • Browser-rendered ${a.renderedPages}` : ''}
                </p>
              </div>
              <div className="panel">
                <h3>Detected structure</h3>
                <div className="success">
                  {a.links.length} links • {a.categoryLinks?.length || 0}{' '}
                  categories • {a.detailLinks?.length || 0} detail candidates
                </div>
                <p className="muted">
                  {a.streams.length} direct streams • {a.iframes.length} embeds
                  • {a.apiHints?.length || 0} API/player hints
                </p>
              </div>
            </div>

            {a.categories?.length > 0 && (
              <div className="chips">
                {a.categories.slice(0, 15).map((x: string) => (
                  <span className="chip" key={x}>
                    {x}
                  </span>
                ))}
              </div>
            )}

            {a.warnings?.length > 0 && (
              <div className="panel" style={{marginTop: 16}}>
                <h3>Generator warnings</h3>
                {a.warnings.map((x: string) => (
                  <p className="muted" key={x}>
                    • {x}
                  </p>
                ))}
              </div>
            )}

            <div style={{marginTop: 18}} className="row">
              <input
                className="input"
                placeholder="Provider name"
                value={name}
                onChange={e => setName(e.target.value)}
              />
              <button className="btn" onClick={generate} disabled={loading || !name}>
                Generate Vega provider
              </button>
            </div>

            <div className="panel" style={{marginTop: 16}}>
              <h3>What you get</h3>
              <p className="muted">
                The ZIP is already a standalone Vega source repository. It contains
                <b> manifest.json</b>, the provider TypeScript source, and pre-built
                <b> dist/</b> JavaScript. No npm install or build is required for a
                standalone generated repository.
              </p>
            </div>
          </>
        )}

        {error && <div className="error">{error}</div>}

        {zip && (
          <div className="panel" style={{marginTop: 16}}>
            <h3 className="success">Provider generated successfully</h3>
            <p className="muted">
              Generator {zip.version} created a Vega-ready package with{' '}
              {zip.files.length} files.
            </p>
            <button className="btn" style={{height: 44}} onClick={download}>
              Download Vega-ready ZIP
            </button>
            <p className="muted" style={{marginTop: 12}}>
              <b>Next:</b> extract the ZIP, then upload the extracted files to the
              root of a GitHub repository. Do not upload the ZIP as a single file.
            </p>
            <p className="muted">
              In Vega, tap <b>Settings → Provider Manager → +</b> and enter the
              GitHub repository URL. If the repository is named <b>vega-providers</b>,
              you can enter the GitHub owner name instead.
            </p>
            <p className="muted">
              For an existing multi-provider repository, copy the generated
              <b> providers/</b> and <b>dist/</b> folders and merge
              <b> manifest-entry.json</b> into the existing <b>manifest.json</b>.
              Do not replace the existing manifest.
            </p>
          </div>
        )}
      </div>

      <div className="footer">
        Only use sources you are authorized to access. This tool does not bypass
        DRM, authentication, paywalls, CAPTCHA, or anti-bot protections.
        Generated providers should be reviewed and tested before use.
      </div>
    </main>
  );
}
