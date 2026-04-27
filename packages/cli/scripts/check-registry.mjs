#!/usr/bin/env node
/**
 * Registry safety guard. Runs as `prepublishOnly` so npm aborts the publish
 * before any upload happens if the effective registry is not the public npm
 * registry.
 *
 * This is layer 3 of defense-in-depth (see plan: "Registry safety"):
 *   1. publishConfig in package.json
 *   2. packages/cli/.npmrc pinning the project registry
 *   3. THIS guard, which catches env vars, corrupt config, scoped registry
 *      precedence bugs, and anything else the first two layers miss.
 */
import { execSync } from 'node:child_process';

const REQUIRED = 'https://registry.npmjs.org/';

function getEffectiveRegistry() {
  const out = execSync('npm config get registry', { encoding: 'utf8' }).trim();
  return out.endsWith('/') ? out : out + '/';
}

const effective = getEffectiveRegistry();

if (effective !== REQUIRED) {
  console.error('');
  console.error('ABORTED: npm publish would target the wrong registry.');
  console.error('');
  console.error(`  effective registry: ${effective}`);
  console.error(`  required registry:  ${REQUIRED}`);
  console.error('');
  console.error('To fix, run from packages/cli:');
  console.error('  npm publish --registry=https://registry.npmjs.org/');
  console.error('');
  console.error('Or check that packages/cli/.npmrc is committed and that no');
  console.error('environment variable (NPM_CONFIG_REGISTRY) is overriding it.');
  console.error('');
  process.exit(1);
}

console.log(`registry check: OK (${effective})`);
