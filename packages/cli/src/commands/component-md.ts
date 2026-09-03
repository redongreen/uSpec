import { runPrepare, manifestForStdout } from '../component-md/prepare.js';
import {
  CACHE_DOMAINS,
  type CacheDomain,
  validateCaches,
} from '../component-md/cache-validation.js';
import { renderComponentMarkdown } from '../component-md/markdown-renderer.js';
import { buildCanonicalComponentContract } from '../component-md/component-contract.js';

interface ParsedArgs {
  base?: string;
  output?: string;
  cwd?: string;
  context?: string;
  slug?: string;
  json?: boolean;
  help?: boolean;
}

function parsePrepareArgs(args: string[]): ParsedArgs | { error: string } {
  const result: ParsedArgs = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') {
      result.help = true;
    } else if (a === '--base') {
      const v = args[++i];
      if (!v) return { error: '--base requires a value' };
      result.base = v;
    } else if (a === '--output') {
      const v = args[++i];
      if (!v) return { error: '--output requires a value' };
      result.output = v;
    } else if (a === '--cwd') {
      const v = args[++i];
      if (!v) return { error: '--cwd requires a value' };
      result.cwd = v;
    } else if (a === '--context') {
      const v = args[++i];
      if (!v) return { error: '--context requires a value' };
      result.context = v;
    } else if (a === '--slug') {
      const v = args[++i];
      if (!v) return { error: '--slug requires a value' };
      result.slug = v;
    } else if (a === '--json') {
      result.json = true;
    } else {
      return { error: `unknown argument: ${a}` };
    }
  }
  return result;
}

function printPrepareHelp(): void {
  console.log(`uspec-skills component-md prepare - validate and stage _base.json

usage:
  npx uspec-skills component-md prepare --base <path/to/_base.json> [options]

options:
  --base <path>       Path to plugin-produced _base.json (required)
  --output <path>     Output .md path (default: ./components/{slug}.md)
  --cwd <dir>         Project root (default: auto-detect from cwd)
  --context <text>    Optional context when _meta.optionalContext is null
  --slug <slug>       Override component slug from _meta
  --json              Emit machine-readable manifest on stdout
  -h, --help          Show this help
`);
}

export async function runComponentMdPrepare(args: string[]): Promise<number> {
  const parsed = parsePrepareArgs(args);
  if ('error' in parsed) {
    console.error(`uspec-skills component-md prepare: ${parsed.error}`);
    return 2;
  }
  if (parsed.help) {
    printPrepareHelp();
    return 0;
  }
  if (!parsed.base) {
    console.error('uspec-skills component-md prepare: --base is required');
    printPrepareHelp();
    return 2;
  }

  try {
    const { manifest, summaryLine } = await runPrepare({
      basePath: parsed.base,
      cwd: parsed.cwd,
      output: parsed.output,
      optionalContext: parsed.context,
      slugOverride: parsed.slug,
    });

    if (parsed.json) {
      console.log(JSON.stringify(manifestForStdout(manifest, summaryLine), null, 2));
    } else {
      console.log(summaryLine);
      console.log(`manifest: ${manifest.paths.cachePath}/${manifest._meta.componentSlug}-prepare-manifest.json`);
    }
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return 1;
  }
}

interface ValidateArgs {
  cache?: string;
  slug?: string;
  domain?: string;
  normalize?: boolean;
  json?: boolean;
  help?: boolean;
}

function parseValidateArgs(args: string[]): ValidateArgs | { error: string } {
  const result: ValidateArgs = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg === '--cache') result.cache = args[++i];
    else if (arg === '--slug') result.slug = args[++i];
    else if (arg === '--domain') result.domain = args[++i];
    else if (arg === '--normalize') result.normalize = true;
    else if (arg === '--json') result.json = true;
    else return { error: `unknown argument: ${arg}` };
    if (
      ['--cache', '--slug', '--domain'].includes(arg) &&
      !args[i]
    ) {
      return { error: `${arg} requires a value` };
    }
  }
  return result;
}

function printValidateHelp(): void {
  console.log(`uspec-skills component-md validate - validate specialist caches

usage:
  npx uspec-skills component-md validate --cache <dir> --slug <slug> [options]

options:
  --domain <name>     api | api-dictionary | structure | color | voice |
                      reconciliations | all (default: all)
  --normalize         Fill canonical fields on unavailable delta records
  --json              Emit machine-readable validation results
  -h, --help          Show this help
`);
}

async function runComponentMdValidate(args: string[]): Promise<number> {
  const parsed = parseValidateArgs(args);
  if ('error' in parsed) {
    console.error(`uspec-skills component-md validate: ${parsed.error}`);
    return 2;
  }
  if (parsed.help) {
    printValidateHelp();
    return 0;
  }
  if (!parsed.cache || !parsed.slug) {
    console.error('uspec-skills component-md validate: --cache and --slug are required');
    printValidateHelp();
    return 2;
  }
  if (
    parsed.domain &&
    parsed.domain !== 'all' &&
    !CACHE_DOMAINS.includes(parsed.domain as CacheDomain)
  ) {
    console.error(`uspec-skills component-md validate: unknown domain ${parsed.domain}`);
    return 2;
  }
  const domains =
    !parsed.domain || parsed.domain === 'all'
      ? undefined
      : [parsed.domain as CacheDomain];
  const results = await validateCaches({
    cachePath: parsed.cache,
    slug: parsed.slug,
    domains,
    normalize: parsed.normalize,
  });
  if (parsed.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const result of results) {
      console.log(
        `${result.ok ? 'OK' : 'FAIL'}  ${result.domain}` +
          (result.normalized ? ` (${result.normalized} fields normalized)` : ''),
      );
      result.errors.forEach((error) => console.error(`  ${error}`));
    }
  }
  return results.every((result) => result.ok) ? 0 : 1;
}

interface RenderArgs {
  manifest?: string;
  plan?: string;
  output?: string;
  template?: string;
  contract?: string;
  contractOutput?: string;
  auditOutput?: string;
  view?: string;
  json?: boolean;
  help?: boolean;
}

function parseRenderArgs(args: string[]): RenderArgs | { error: string } {
  const result: RenderArgs = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg === '--manifest') result.manifest = args[++i];
    else if (arg === '--plan') result.plan = args[++i];
    else if (arg === '--output') result.output = args[++i];
    else if (arg === '--template') result.template = args[++i];
    else if (arg === '--contract') result.contract = args[++i];
    else if (arg === '--contract-output') result.contractOutput = args[++i];
    else if (arg === '--audit-output') result.auditOutput = args[++i];
    else if (arg === '--view') result.view = args[++i];
    else if (arg === '--json') result.json = true;
    else return { error: `unknown argument: ${arg}` };
    if (
      [
        '--manifest',
        '--plan',
        '--output',
        '--template',
        '--contract',
        '--contract-output',
        '--audit-output',
        '--view',
      ].includes(arg) &&
      !args[i]
    ) {
      return { error: `${arg} requires a value` };
    }
  }
  return result;
}

function printRenderHelp(): void {
  console.log(`uspec-skills component-md render - deterministically assemble Markdown

usage:
  npx uspec-skills component-md render --manifest <prepare-manifest.json>
    --plan <render-plan.json> [options]

The AI-authored render plan contains only semantic synthesis (especially the
overview). Cache validation, tables, known gaps, render-meta, and Markdown
assembly are deterministic.

options:
  --output <path>     Override manifest output path
  --template <path>   Override bundled component-md template
  --view <name>       concise (default) | audit
  --contract <path>   Render from an existing canonical contract
  --contract-output   Override canonical JSON contract path
  --audit-output      Audit Markdown path referenced by concise output
  --json              Emit machine-readable render result
  -h, --help          Show this help
`);
}

async function runComponentMdRender(args: string[]): Promise<number> {
  const parsed = parseRenderArgs(args);
  if ('error' in parsed) {
    console.error(`uspec-skills component-md render: ${parsed.error}`);
    return 2;
  }
  if (parsed.help) {
    printRenderHelp();
    return 0;
  }
  if (!parsed.manifest || !parsed.plan) {
    console.error('uspec-skills component-md render: --manifest and --plan are required');
    printRenderHelp();
    return 2;
  }
  if (parsed.view && !['audit', 'concise'].includes(parsed.view)) {
    console.error('uspec-skills component-md render: --view must be audit or concise');
    return 2;
  }
  try {
    const result = await renderComponentMarkdown({
      manifestPath: parsed.manifest,
      planPath: parsed.plan,
      outputPath: parsed.output,
      templatePath: parsed.template,
      contractPath: parsed.contract,
      contractOutputPath: parsed.contractOutput,
      auditOutputPath: parsed.auditOutput,
      view: parsed.view as 'audit' | 'concise' | undefined,
      normalizeCaches: true,
    });
    if (parsed.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(
        `Component Markdown written: view=${result.view}, tables=${result.tables}, ` +
          `render-meta={sectionTargets=${result.sectionTargets.resolved}/${result.sectionTargets.total}, ` +
          `groupTargets=${result.groupTargets.resolved}/${result.groupTargets.total}}, ` +
          `bytes=${result.bytes} → ${result.outputPath}`,
      );
      if (result.droppedStructureSpecs.length) {
        console.warn(
          `  warning: ${result.droppedStructureSpecs.length} structure spec name(s) omitted from the concise view: ` +
            result.droppedStructureSpecs.join(', '),
        );
      }
    }
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }
}

interface ContractArgs {
  manifest?: string;
  plan?: string;
  output?: string;
  json?: boolean;
  help?: boolean;
}

function parseContractArgs(args: string[]): ContractArgs | { error: string } {
  const result: ContractArgs = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg === '--manifest') result.manifest = args[++i];
    else if (arg === '--plan') result.plan = args[++i];
    else if (arg === '--output') result.output = args[++i];
    else if (arg === '--json') result.json = true;
    else return { error: `unknown argument: ${arg}` };
    if (['--manifest', '--plan', '--output'].includes(arg) && !args[i]) {
      return { error: `${arg} requires a value` };
    }
  }
  return result;
}

function printContractHelp(): void {
  console.log(`uspec-skills component-md contract - build canonical component JSON

usage:
  npx uspec-skills component-md contract --manifest <prepare-manifest.json>
    --plan <render-plan.json> [options]

options:
  --output <path>     Override canonical contract path
  --json              Emit machine-readable build result
  -h, --help          Show this help
`);
}

async function runComponentMdContract(args: string[]): Promise<number> {
  const parsed = parseContractArgs(args);
  if ('error' in parsed) {
    console.error(`uspec-skills component-md contract: ${parsed.error}`);
    return 2;
  }
  if (parsed.help) {
    printContractHelp();
    return 0;
  }
  if (!parsed.manifest || !parsed.plan) {
    console.error('uspec-skills component-md contract: --manifest and --plan are required');
    printContractHelp();
    return 2;
  }
  try {
    const result = await buildCanonicalComponentContract({
      manifestPath: parsed.manifest,
      planPath: parsed.plan,
      outputPath: parsed.output,
      normalizeCaches: true,
    });
    const summary = {
      outputPath: result.outputPath,
      bytes: result.bytes,
      schemaVersion: result.contract.schemaVersion,
      componentSlug: result.contract.component.slug,
      obligationCoverage: result.contract.provenance.obligationCoverage,
    };
    if (parsed.json) console.log(JSON.stringify(summary, null, 2));
    else {
      console.log(
        `Canonical component contract written: schema=${summary.schemaVersion}, ` +
          `bytes=${summary.bytes} → ${summary.outputPath}`,
      );
    }
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }
}

export async function runComponentMd(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (!sub || sub === '--help' || sub === '-h') {
    console.log(`uspec-skills component-md - component markdown pipeline

usage:
  npx uspec-skills component-md prepare --base <path> [options]
  npx uspec-skills component-md validate --cache <dir> --slug <slug> [options]
  npx uspec-skills component-md contract --manifest <path> --plan <path> [options]
  npx uspec-skills component-md render --manifest <path> --plan <path> [options]

Run a subcommand with \`--help\` for options.
`);
    return sub ? 0 : 1;
  }
  if (sub === 'prepare') {
    return runComponentMdPrepare(rest);
  }
  if (sub === 'validate') {
    return runComponentMdValidate(rest);
  }
  if (sub === 'render') {
    return runComponentMdRender(rest);
  }
  if (sub === 'contract') {
    return runComponentMdContract(rest);
  }
  console.error(`unknown component-md subcommand: ${sub}`);
  return 2;
}
