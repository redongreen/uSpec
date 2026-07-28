import { createHash } from 'node:crypto';

export function computeSourceHash(content: string | Buffer): string {
  const hash = createHash('sha256').update(content).digest('hex');
  return `sha256:${hash}`;
}
