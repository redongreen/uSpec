// Defensive property accessors. GROUP / SLOT / other non-container nodes throw synchronous
// TypeErrors on property reads that FRAME / INSTANCE / COMPONENT nodes never throw on. These
// helpers make every `node.<prop>` lookup safe so a single node type mismatch cannot kill the
// walk.

export const safeLen = (x: unknown): number => (Array.isArray(x) ? x.length : 0);

export const sg = (n: unknown, p: string): any => {
  try {
    return (n as any)[p];
  } catch {
    return undefined;
  }
};

export const sidStr = (n: unknown, p: string): string => {
  try {
    const v = (n as any)[p];
    return typeof v === 'string' ? v : '';
  } catch {
    return '';
  }
};

export const rv = (v: number): number => Math.round(v * 10) / 10;

export const md = (value: number | string, token: string | null | undefined): string =>
  token ? `${token} (${value})` : String(value);

export const rgbToHex = (c: { r: number; g: number; b: number }): string =>
  '#' +
  [c.r, c.g, c.b]
    .map((v) => Math.round(v * 255).toString(16).padStart(2, '0'))
    .join('');

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}
