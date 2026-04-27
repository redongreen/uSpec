import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Platform } from './render.js';

export type McpProvider = 'figma-console' | 'figma-mcp';

export interface UspecConfig {
  mcpProvider?: McpProvider;
  environment?: Platform;
  fontFamily?: string;
  extractionSource?: string;
  templateKeys?: Record<string, string>;
  reconciliation?: { autoRetry?: boolean };
  /** CLI version that wrote this config. Used by `uspec doctor` for drift warnings. */
  cliVersion?: string;
  [key: string]: unknown;
}

export const CONFIG_FILENAME = 'uspecs.config.json';

export async function readConfig(projectRoot: string): Promise<UspecConfig | null> {
  const path = join(projectRoot, CONFIG_FILENAME);
  if (!existsSync(path)) return null;
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as UspecConfig;
}

export async function writeConfig(projectRoot: string, config: UspecConfig): Promise<void> {
  const path = join(projectRoot, CONFIG_FILENAME);
  const formatted = JSON.stringify(config, null, 2) + '\n';
  await writeFile(path, formatted, 'utf8');
}

/**
 * Merges new fields into an existing config, preserving any fields the CLI
 * doesn't know about (so user customizations or fields written by the
 * firstrun skill aren't clobbered on `uspec update`).
 */
export async function upsertConfig(
  projectRoot: string,
  patch: Partial<UspecConfig>,
): Promise<UspecConfig> {
  const existing = (await readConfig(projectRoot)) ?? {};
  const next: UspecConfig = { ...existing, ...patch };
  await writeConfig(projectRoot, next);
  return next;
}
