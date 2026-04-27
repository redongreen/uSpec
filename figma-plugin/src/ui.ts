// UI iframe. Receives preview + extract-done messages from code.ts, renders the checklist,
// and handles download / copy-to-clipboard.

import type { MsgFromSandbox, MsgFromUi, Preview, PreviewChild, UserClassification } from './types';

type State = {
  preview: Preview | null;
  // Tracks user overrides keyed by topLevelInstanceId; the first-guess classification stays in
  // `preview.children[*].classification` unless the user flips it.
  overrides: Map<string, 'constitutive' | 'referenced'>;
  optionalContext: string;
  lastBaseJson: unknown | null;
  lastFilename: string | null;
  extracting: boolean;
};

const state: State = {
  preview: null,
  overrides: new Map(),
  optionalContext: '',
  lastBaseJson: null,
  lastFilename: null,
  extracting: false,
};

const main = document.getElementById('main')!;
const subtitle = document.getElementById('subtitle')!;
const refreshBtn = document.getElementById('refreshBtn') as HTMLButtonElement;
const copyBtn = document.getElementById('copyBtn') as HTMLButtonElement;
const downloadBtn = document.getElementById('downloadBtn') as HTMLButtonElement;

refreshBtn.addEventListener('click', () => post({ type: 'refresh-preview' }));
downloadBtn.addEventListener('click', () => triggerExtract('download'));
copyBtn.addEventListener('click', () => triggerExtract('copy'));

window.addEventListener('message', (ev: MessageEvent) => {
  const raw = ev.data?.pluginMessage as MsgFromSandbox | undefined;
  if (!raw) return;
  switch (raw.type) {
    case 'ready':
      state.preview = raw.preview;
      state.overrides.clear();
      render();
      break;
    case 'no-selection':
      state.preview = null;
      render();
      break;
    case 'invalid-selection':
      state.preview = null;
      renderEmpty(`Cannot extract: ${raw.reason}`);
      break;
    case 'progress':
      renderProgress(raw.phase, raw.detail);
      break;
    case 'extract-done':
      state.lastBaseJson = raw.baseJson;
      state.lastFilename = raw.filename;
      handleExtractDone(raw.warnings);
      break;
    case 'extract-error':
      handleExtractError(raw.message);
      break;
  }
});

let pendingAction: 'download' | 'copy' = 'download';

function triggerExtract(action: 'download' | 'copy'): void {
  if (!state.preview || state.extracting) return;
  pendingAction = action;
  state.extracting = true;
  downloadBtn.disabled = true;
  copyBtn.disabled = true;
  subtitle.textContent = 'Extracting…';

  const classifications: UserClassification[] = state.preview.children
    .filter((c) => c.nodeType === 'INSTANCE')
    .map((c) => ({
      topLevelInstanceId: c.topLevelInstanceId,
      name: c.name,
      classification:
        (state.overrides.get(c.topLevelInstanceId || '') as 'constitutive' | 'referenced') ||
        (c.classification === 'decorative' ? 'referenced' : c.classification),
      origin: c.origin,
      slotName: c.slotName,
      mainComponentName: c.mainComponentName,
      parentSetName: c.parentSetName,
      subCompSetId: c.subCompSetId,
      nodeType: c.nodeType,
    }));

  post({
    type: 'extract',
    classifications,
    optionalContext: state.optionalContext || null,
  });
}

async function handleExtractDone(warnings: string[]): Promise<void> {
  state.extracting = false;
  const payload = state.lastBaseJson;
  const filename = state.lastFilename || '_base.json';
  const serialized = JSON.stringify(payload, null, 2);

  try {
    if (pendingAction === 'download') {
      downloadFile(filename, serialized);
    } else {
      await copyToClipboard(serialized);
    }
    render();
    appendLog(
      `${pendingAction === 'download' ? 'Downloaded' : 'Copied'} ${filename} (${
        serialized.length
      } bytes)`,
      'ok'
    );
    if (warnings.length > 0) {
      for (const w of warnings) appendLog(w, 'err');
    }
    subtitle.textContent = `Extracted ${filename}`;
  } catch (err) {
    appendLog(
      `Delivery failed: ${err instanceof Error ? err.message : String(err)}`,
      'err'
    );
    subtitle.textContent = 'Delivery failed.';
  } finally {
    downloadBtn.disabled = !state.preview;
    copyBtn.disabled = !state.preview;
  }
}

function handleExtractError(message: string): void {
  state.extracting = false;
  subtitle.textContent = 'Extraction failed.';
  appendLog(message, 'err');
  downloadBtn.disabled = !state.preview;
  copyBtn.disabled = !state.preview;
}

function render(): void {
  if (!state.preview) {
    renderEmpty('Select a component or component set on the canvas.');
    downloadBtn.disabled = true;
    copyBtn.disabled = true;
    return;
  }

  const p = state.preview;
  subtitle.textContent = `${p.componentName} · ${p.variantCount} variant${
    p.variantCount === 1 ? '' : 's'
  } · default: ${p.defaultVariantName}`;
  downloadBtn.disabled = state.extracting;
  copyBtn.disabled = state.extracting;

  main.innerHTML = '';
  const summary = document.createElement('div');
  summary.className = 'summary';
  summary.innerHTML = `<strong>${escapeHtml(p.componentName)}</strong><br />
    <span class="filename">${escapeHtml(p.nodeId)}</span>`;
  main.appendChild(summary);

  const topLevelInstances = p.children.filter(
    (c) => c.nodeType === 'INSTANCE' && c.origin === 'top-level'
  );
  const slotInstances = p.children.filter(
    (c) => c.nodeType === 'INSTANCE' && c.origin !== 'top-level'
  );
  const decorativeChildren = p.children.filter((c) => c.nodeType !== 'INSTANCE');

  if (topLevelInstances.length > 0) {
    const label = document.createElement('div');
    label.className = 'section-label';
    label.textContent = `Sub-components (${topLevelInstances.length})`;
    main.appendChild(label);
    for (const c of topLevelInstances) main.appendChild(renderInstanceRow(c));
  } else {
    const label = document.createElement('div');
    label.className = 'section-label';
    label.textContent = 'Sub-components';
    main.appendChild(label);
    const empty = document.createElement('div');
    empty.className = 'child-meta';
    empty.textContent = 'No instance children.';
    main.appendChild(empty);
  }

  // Group slot entries by slot name so each slot gets its own section. Within a slot,
  // slot-default-child entries (components actually placed in the slot) render before
  // slot-preferred entries (components merely declared as valid fills).
  if (slotInstances.length > 0) {
    const bySlot = new Map<string, PreviewChild[]>();
    for (const c of slotInstances) {
      const key = c.slotName || '(slot)';
      if (!bySlot.has(key)) bySlot.set(key, []);
      bySlot.get(key)!.push(c);
    }
    for (const [slotName, entries] of bySlot) {
      entries.sort((a, b) => {
        const score = (o: string) => (o === 'slot-default-child' ? 0 : 1);
        return score(a.origin) - score(b.origin);
      });
      const label = document.createElement('div');
      label.className = 'section-label';
      label.textContent = `Slot: ${slotName} (${entries.length})`;
      main.appendChild(label);
      for (const c of entries) main.appendChild(renderInstanceRow(c));
    }
  }

  if (decorativeChildren.length > 0) {
    const label = document.createElement('div');
    label.className = 'section-label';
    label.textContent = `Decorative (${decorativeChildren.length})`;
    main.appendChild(label);
    for (const c of decorativeChildren) main.appendChild(renderDecorativeRow(c));
  }

  const contextLabel = document.createElement('div');
  contextLabel.className = 'section-label';
  contextLabel.textContent = 'Optional context';
  main.appendChild(contextLabel);

  const ta = document.createElement('textarea');
  ta.placeholder =
    'Any hints for the spec-generation agent (design intent, open questions, constraints)…';
  ta.value = state.optionalContext;
  ta.addEventListener('input', () => (state.optionalContext = ta.value));
  main.appendChild(ta);
}

function renderInstanceRow(c: PreviewChild): HTMLElement {
  const row = document.createElement('div');
  row.className = 'child';

  const name = document.createElement('div');
  name.className = 'child-name';
  name.textContent = c.name;
  row.appendChild(name);

  const seg = document.createElement('div');
  seg.className = 'seg';
  const current =
    state.overrides.get(c.topLevelInstanceId || '') ||
    (c.classification === 'decorative' ? 'referenced' : c.classification);

  for (const opt of ['constitutive', 'referenced'] as const) {
    const b = document.createElement('button');
    b.textContent = opt;
    if (current === opt) b.classList.add('active');
    b.addEventListener('click', () => {
      state.overrides.set(c.topLevelInstanceId || '', opt);
      render();
    });
    seg.appendChild(b);
  }
  row.appendChild(seg);

  const meta = document.createElement('div');
  meta.className = 'child-meta';
  const parent = c.parentSetName || c.mainComponentName || '(unknown)';
  const originTag =
    c.origin === 'slot-preferred'
      ? 'preferred · '
      : c.origin === 'slot-default-child'
        ? 'default fill · '
        : '';
  meta.innerHTML = `${escapeHtml(originTag)}${escapeHtml(parent)} · <span class="filename">${escapeHtml(
    c.classificationReason
  )}</span>`;
  row.appendChild(meta);
  return row;
}

function renderDecorativeRow(c: PreviewChild): HTMLElement {
  const row = document.createElement('div');
  row.className = 'child';
  const name = document.createElement('div');
  name.className = 'child-name';
  name.textContent = c.name;
  row.appendChild(name);
  const seg = document.createElement('div');
  seg.className = 'seg';
  const b = document.createElement('button');
  b.textContent = 'decorative';
  b.className = 'locked';
  seg.appendChild(b);
  row.appendChild(seg);
  const meta = document.createElement('div');
  meta.className = 'child-meta';
  meta.textContent = `${c.nodeType} · locked`;
  row.appendChild(meta);
  return row;
}

function renderEmpty(msg: string): void {
  main.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'empty';
  el.textContent = msg;
  main.appendChild(el);
  subtitle.textContent = 'Select a component or component set to begin.';
}

function renderProgress(phase: string, detail?: string): void {
  subtitle.textContent = `Phase ${phase}${detail ? ' — ' + detail : ''}`;
}

function appendLog(msg: string, cls: 'ok' | 'err'): void {
  let log = document.getElementById('log') as HTMLDivElement | null;
  if (!log) {
    log = document.createElement('div');
    log.id = 'log';
    log.className = 'log';
    main.appendChild(log);
  }
  const line = document.createElement('div');
  line.className = cls;
  line.textContent = msg;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function downloadFile(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}

async function copyToClipboard(contents: string): Promise<void> {
  // Figma's plugin iframe is sandboxed; navigator.clipboard often throws "not focused".
  // Fall back to a textarea + execCommand('copy') when needed.
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(contents);
      return;
    }
  } catch {}
  const ta = document.createElement('textarea');
  ta.value = contents;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } finally {
    ta.remove();
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function post(msg: MsgFromUi): void {
  parent.postMessage({ pluginMessage: msg }, '*');
}

post({ type: 'refresh-preview' });
