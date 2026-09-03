#!/usr/bin/env node
import * as esbuild from 'esbuild';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');
const editionArg = process.argv.find((arg) => arg.startsWith('--edition='));
const editionName = editionArg ? editionArg.slice('--edition='.length) : 'external';

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return {};
    throw err;
  }
}

function mergeEdition(base = {}, local = {}) {
  return { ...base, ...local };
}

const editions = await readJsonIfPresent(path.join(root, 'editions.json'));
const localEditions = await readJsonIfPresent(path.join(root, 'editions.local.json'));

if (!editions[editionName]) {
  console.error(`Unknown edition "${editionName}". Use --edition=internal or --edition=external.`);
  process.exit(1);
}

const edition = mergeEdition(editions[editionName], localEditions[editionName]);

if (!edition.id) {
  console.error(`Edition "${editionName}" has no plugin id.`);
  if (editionName === 'internal') {
    console.error(
      'Copy figma-plugin/editions.local.json.example to figma-plugin/editions.local.json and set your organization plugin id. That file is gitignored.',
    );
  }
  process.exit(1);
}

async function writeManifest() {
  const manifest = {
    name: edition.name,
    id: edition.id,
    api: '1.0.0',
    main: 'dist/code.js',
    ui: 'dist/ui.html',
    editorType: ['figma'],
    networkAccess: {
      allowedDomains: ['none'],
    },
    documentAccess: 'dynamic-page',
    capabilities: [],
  };
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

async function build() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  await writeManifest();

  const define = {
    __REQUIRE_FILE_LINK__: edition.requireFileLink ? 'true' : 'false',
  };

  const common = {
    bundle: true,
    logLevel: 'info',
    define,
  };

  // Figma's plugin sandbox runs a QuickJS-based interpreter that implements ES2018. It does NOT
  // support optional catch binding (`} catch {`), exponentiation (`**=`), or nullish chaining
  // short-circuit in some builds. esbuild's `es2017` target rewrites all of those down to
  // compatible ES forms. Bumping this higher will produce a runtime syntax error like:
  //   "Syntax error on line N: Unexpected token {  } catch {"
  const codeOptions = {
    ...common,
    entryPoints: [path.join(root, 'src/code.ts')],
    outfile: path.join(dist, 'code.js'),
    platform: 'browser',
    format: 'iife',
    target: 'es2017',
    supported: {
      'optional-catch-binding': false,
    },
  };

  // The UI iframe runs in a normal Chromium context, so it can use modern ES freely.
  const uiOptions = {
    ...common,
    entryPoints: [path.join(root, 'src/ui.ts')],
    outfile: path.join(dist, 'ui.js'),
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
  };

  if (watch) {
    const codeCtx = await esbuild.context(codeOptions);
    const uiCtx = await esbuild.context(uiOptions);
    await Promise.all([codeCtx.watch(), uiCtx.watch()]);
    await writeHtmlShell();
    console.log(`watching ${editionName} (${edition.name} · ${edition.id})...`);
  } else {
    await esbuild.build(codeOptions);
    await esbuild.build(uiOptions);
    await writeHtmlShell();
    console.log(
      `build complete → ${path.relative(root, dist)} [${editionName}] ${edition.name} (${edition.id})`,
    );
  }
}

async function writeHtmlShell() {
  const uiHtml = await readFile(path.join(root, 'src/ui.html'), 'utf8');
  const uiJs = await readFile(path.join(dist, 'ui.js'), 'utf8');
  const inlined = uiHtml
    .replace('__EDITION__', editionName)
    .replace(
      '<!-- UI_BUNDLE -->',
      `<script>${uiJs}</script>`,
    );
  await writeFile(path.join(dist, 'ui.html'), inlined, 'utf8');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
