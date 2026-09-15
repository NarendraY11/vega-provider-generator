import {NextResponse} from 'next/server';
import JSZip from 'jszip';
import {transform} from 'sucrase';
import {generateProvider} from '../../../lib/generator';

function buildCommonJs(source: string): string {
  try {
    return transform(source, {
      transforms: ['typescript', 'imports'],
      enableLegacyTypeScriptModuleInterop: false,
      disableESTransforms: true,
    }).code.replace(/require\(['"]node:.*?['"]\)/g, '{}');
  } catch (error) {
    throw new Error(
      `Generated provider compilation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const analysis = body?.analysis;
    const name = String(body?.name || analysis?.title || 'Website Provider')
      .trim()
      .slice(0, 80);

    if (!analysis?.url) {
      return NextResponse.json({error: 'Analysis is required'}, {status: 400});
    }
    if (!/^https?:\/\//i.test(analysis.url)) {
      return NextResponse.json({error: 'Analysis URL is invalid.'}, {status: 400});
    }
    if (!name) {
      return NextResponse.json({error: 'Provider name is required.'}, {status: 400});
    }

    const result = generateProvider(analysis, name);
    const zip = new JSZip();
    const providerId = result.id;
    const distFiles: Record<string, string> = {};

    for (const [path, content] of Object.entries(result.files)) {
      zip.file(path, content);
      if (path.startsWith(`providers/${providerId}/`) && path.endsWith('.ts')) {
        const moduleName = path.split('/').pop()!.replace(/\.ts$/, '');
        distFiles[`dist/${providerId}/${moduleName}.js`] = buildCommonJs(content);
      }
    }

    // Vega's Provider Manager treats a GitHub repository as the provider source root.
    // It fetches /manifest.json first, then loads the compiled modules from /dist/<id>/.
    const manifestEntry = result.files['manifest-entry.json'];
    const entry = manifestEntry
      ? JSON.parse(manifestEntry)
      : {
          display_name: name,
          value: providerId,
          version: '1.0',
          icon: analysis.images?.[0] || '',
          type: 'global',
          hasSettings: false,
          disabled: false,
        };
    entry.hasSettings = Boolean(distFiles[`dist/${providerId}/settings.js`]);
    zip.file('manifest.json', JSON.stringify([entry], null, 2));

    for (const [path, content] of Object.entries(distFiles)) {
      zip.file(path, content);
    }

    zip.file(
      'GENERATOR-NOTES.md',
      `# Vega Provider Generator 2.3\n\nSource website: ${analysis.url}\nCrawled pages: ${analysis.crawledPages || 1}\n\n## Publish this ZIP to GitHub\n\nThis archive is already a standalone Vega provider source. Do **not** upload the ZIP file itself to Vega. Extract the ZIP and publish all of its contents at the root of a GitHub repository.\n\nThe repository must expose these paths:\n\n- /manifest.json\n- /dist/${providerId}/catalog.js\n- /dist/${providerId}/posts.js\n- /dist/${providerId}/meta.js\n- /dist/${providerId}/stream.js\n- /dist/${providerId}/episodes.js (when generated)\n\nIn Vega: Settings > Provider Manager > + > enter the GitHub repository URL. For example:\n\nhttps://github.com/YOUR-USERNAME/YOUR-REPOSITORY\n\nVega reads manifest.json and then loads the built JavaScript modules from dist/${providerId}/. You do not need to run npm install or npm run build for a generated standalone package.\n\n## Existing multi-provider repository\n\nIf you are adding this provider to an existing repository such as a shared `vega-providers` repository, do **not** replace the existing manifest.json. Copy `providers/${providerId}/` and `dist/${providerId}/`, then merge the generated entry from `manifest-entry.json` into the existing manifest array. Commit and push the changes.\n\n## Important\n\nGenerated code is heuristic and should be tested in Vega. Sites using custom APIs, authentication, DRM, CAPTCHA, aggressive anti-bot systems, or frequently changing layouts may require manual provider code changes.\n`,
    );

    const blob = await zip.generateAsync({type: 'base64'});
    return NextResponse.json({
      filename: `${result.id}-vega-provider.zip`,
      base64: blob,
      files: [...Object.keys(result.files), 'manifest.json', ...Object.keys(distFiles)],
      version: '2.3',
      providerId,
      readyToPublish: true,
    });
  } catch (e) {
    return NextResponse.json(
      {error: String(e instanceof Error ? e.message : e)},
      {status: 500},
    );
  }
}
