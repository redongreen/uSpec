// Phase C — resolve styles referenced during Phase E.
//
// Phase C runs after Phase E has collected every styleId referenced from TEXT / paint / effect
// nodes. Inline samples (from Phase E) are the fallback for library-linked styles that
// getStyleByIdAsync cannot resolve.

export type PhaseCResult = {
  resolvedStyles: Record<string, any>;
};

export async function runPhaseC(
  styleIds: string[],
  inlineSamples: Record<string, any>
): Promise<PhaseCResult> {
  const resolvedStyles: Record<string, any> = {};
  const seen = new Set<string>();
  for (const sid of styleIds) {
    if (!sid || typeof sid !== 'string') continue;
    if (seen.has(sid)) continue;
    seen.add(sid);
    let entry: any = null;
    try {
      const s = await figma.getStyleByIdAsync(sid);
      if (s) {
        entry = { name: s.name, type: s.type, description: s.description || null };
        if (inlineSamples && inlineSamples[sid]) entry.inline = inlineSamples[sid];
      }
    } catch {}
    if (!entry && inlineSamples && inlineSamples[sid]) {
      entry = { _unresolved: true, inline: inlineSamples[sid] };
    }
    if (entry) resolvedStyles[sid] = entry;
  }
  return { resolvedStyles };
}
