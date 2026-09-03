export interface MarkdownAudit {
  ok: boolean;
  bytes: number;
  tables: number;
  errors: string[];
}

function columnCount(line: string): number {
  return line.replaceAll('\\|', '').split('|').length;
}

export function auditMarkdown(
  markdown: string,
  opts: { requireMetadata?: boolean } = {},
): MarkdownAudit {
  const lines = markdown.split('\n');
  const errors: string[] = [];
  let fenced = false;
  let tables = 0;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.startsWith('```')) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    const separator = lines[index + 1] ?? '';
    if (line.startsWith('|') && /^\|(\s*-{3,}\s*\|)+$/.test(separator)) {
      const columns = columnCount(line);
      tables++;
      if (columnCount(separator) !== columns) {
        errors.push(`table separator mismatch at line ${index + 2}`);
      }
      let rowIndex = index + 2;
      while ((lines[rowIndex] ?? '').startsWith('|')) {
        if (columnCount(lines[rowIndex]) !== columns) {
          errors.push(`table row mismatch at line ${rowIndex + 1}`);
        }
        rowIndex++;
      }
      index = rowIndex - 1;
    }
  }

  if (markdown.includes('{{')) errors.push('leftover template placeholder');

  if (opts.requireMetadata !== false) {
    const voiceMeta = /<!-- voice-render-meta v=1\n([\s\S]*?)\n-->/.exec(markdown);
    if (!voiceMeta) {
      errors.push('voice-render-meta block is missing');
    } else {
      try {
        JSON.parse(voiceMeta[1]);
      } catch {
        errors.push('voice-render-meta is invalid JSON');
      }
    }

    const renderMeta =
      /<!-- render-meta:start v=1 -->[\s\S]*?```json\n([\s\S]*?)\n```[\s\S]*?<!-- render-meta:end -->/.exec(
        markdown,
      );
    if (!renderMeta) {
      errors.push('render-meta block is missing');
    } else {
      try {
        const parsed = JSON.parse(renderMeta[1]) as { schemaVersion?: string };
        if (parsed.schemaVersion !== '1.0') errors.push('render-meta schemaVersion must be 1.0');
      } catch {
        errors.push('render-meta is invalid JSON');
      }
    }
  }

  return {
    ok: errors.length === 0,
    bytes: Buffer.byteLength(markdown),
    tables,
    errors,
  };
}
