#!/usr/bin/env node
import * as esbuild from 'esbuild';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

async function build() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  const common = {
    bundle: true,
    logLevel: 'info',
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
    console.log('watching for changes...');
  } else {
    await esbuild.build(codeOptions);
    await esbuild.build(uiOptions);
    await writeHtmlShell();
    console.log('build complete →', path.relative(root, dist));
  }
}

async function writeHtmlShell() {
  const uiHtml = await readFile(path.join(root, 'src/ui.html'), 'utf8');
  const uiJs = await readFile(path.join(dist, 'ui.js'), 'utf8');
  // Inline the bundled JS so Figma can load a single HTML doc.
  const inlined = uiHtml.replace(
    '<!-- UI_BUNDLE -->',
    `<script>${uiJs}</script>`
  );
  await writeFile(path.join(dist, 'ui.html'), inlined, 'utf8');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
