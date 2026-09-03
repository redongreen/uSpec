import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { resolveSourceDirs } from '../paths.js';
import {
  buildCanonicalComponentContract,
  loadCanonicalComponentContract,
} from './component-contract.js';
import { droppedStructureSpecs, renderConciseMarkdown } from './concise-renderer.js';
import { auditHumanView } from './human-view-audit.js';
import { auditMarkdown, type MarkdownAudit } from './markdown-audit.js';
import type { PrepareManifest, RenderPlan } from './types.js';

type AnyObject = Record<string, any>;

export interface RenderOptions {
  manifestPath: string;
  planPath: string;
  outputPath?: string;
  templatePath?: string;
  normalizeCaches?: boolean;
  contractOutputPath?: string;
  contractPath?: string;
  view?: 'audit' | 'concise';
  auditOutputPath?: string;
}

export interface RenderResult {
  outputPath: string;
  contractPath: string;
  view: 'audit' | 'concise';
  bytes: number;
  tables: number;
  sectionTargets: { resolved: number; total: number };
  groupTargets: { resolved: number; total: number };
  targetResolutionByVariant: Record<string, { resolved: number; total: number }>;
  droppedStructureSpecs: string[];
  sourceCoverage: {
    apiProperties: number;
    structureSections: number;
    structureRows: number;
    colorGroups: number;
    colorElements: number;
    voiceStates: number;
    voicePlatforms: number;
  };
  metrics: {
    specialistCacheBytes: number;
    contractBytes: number;
    renderPlanBytes: number;
    estimatedInputTokens: number;
    durationMs: number;
  };
  audit: MarkdownAudit;
}

function escapeCell(value: unknown): string {
  return String(value ?? '')
    .replaceAll('|', '\\|')
    .replace(/\n+/g, ' ')
    .trim();
}

function table(headers: unknown[], rows: unknown[][]): string {
  return [
    `| ${headers.map(escapeCell).join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`),
  ].join('\n');
}

function sorted(value: any): any {
  if (Array.isArray(value)) return value.map(sorted);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function titleCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

async function readJson<T = AnyObject>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

function displayName(child: AnyObject): string {
  return child.parentSetName && child.parentSetName !== child.mainComponentName
    ? child.parentSetName
    : child.mainComponentName || child.name;
}

function canonicalMap(dictionary: AnyObject, reconciliations: AnyObject): Record<string, string> {
  const result: Record<string, string> = {};
  for (const axis of dictionary.axes ?? []) {
    for (const value of axis.values ?? []) {
      if (value.figmaValue) result[value.figmaValue] = value.name;
    }
  }
  for (const entry of reconciliations.autoReconciled ?? []) {
    if (
      entry.class === 'vocabulary-drift' &&
      typeof entry.before === 'string' &&
      typeof entry.after === 'string'
    ) {
      result[entry.before] = entry.after;
    }
  }
  return result;
}

function reconciliationTail(reconciliations: AnyObject, specialist: string): string {
  const auto = (reconciliations.autoReconciled ?? []).filter(
    (entry: AnyObject) => entry.specialist === specialist,
  ).length;
  const retries = (reconciliations.retries ?? []).filter(
    (entry: AnyObject) => entry.specialist === specialist,
  ).length;
  const unresolved = (reconciliations.unresolved ?? []).filter(
    (entry: AnyObject) => entry.specialist === specialist,
  ).length;
  return auto + retries + unresolved === 0
    ? ''
    : ` _Reconciliation: ${auto} auto-fixed, ${retries} retried, ${unresolved} unresolved._`;
}

function renderComposition(renderer: AnyObject): string {
  const composition = renderer.childComposition;
  if (!(composition?.children?.length || composition?.ambiguousChildren?.length)) return '';
  const output = ['### Composition', ''];
  let decorative = 0;

  for (const child of composition.children ?? []) {
    if (child.classification === 'decorative') {
      if (!child.origin || child.origin === 'top-level') decorative++;
      continue;
    }
    const name = displayName(child);
    if (child.classification === 'constitutive') {
      output.push(
        child.subCompSetId
          ? `- **${name}** (constitutive sub-component) — documented inline; also has its own spec at \`./${slugify(name)}.md\` (when present).`
          : `- **${child.name}** (constitutive part) — documented inline in the API and Structure sections.`,
      );
    } else {
      output.push(
        `- **${name}** (referenced — ${child.mainComponentName ?? name}) — configured inline below; full spec at \`./${slugify(name)}.md\` (when present).`,
      );
    }
  }
  for (const child of composition.ambiguousChildren ?? []) {
    output.push(
      `- **${displayName(child)}** (classification ambiguous — defaulted to referenced) — review and resolve in a follow-up run.`,
    );
  }
  if (decorative) {
    output.push(`- _Decorative children: ${decorative} — documented inline in Structure and Color._`);
  }
  output.push(
    '',
    '_Classification produced by the uSpec Extract Figma plugin and reviewed by create-component-md. Constitutive children are part-of this component; referenced children are used-by it and own their own specs._',
  );
  return output.join('\n');
}

function renderAnatomy(renderer: AnyObject, voice: AnyObject): string {
  const doNotText: string[] = [];
  for (const state of voice.states ?? []) {
    for (const section of state.sections ?? []) {
      for (const voiceTable of section.tables ?? []) {
        for (const property of voiceTable.properties ?? []) {
          if (property.property === 'Do NOT') {
            doNotText.push(`${property.value ?? ''} ${property.notes ?? ''}`.toLowerCase());
          }
        }
      }
    }
  }

  const classByIndex: Record<number, string> = {};
  for (const child of renderer.childComposition?.children ?? []) {
    const match = /^idx:(\d+)$/.exec(child.topLevelInstanceId ?? '');
    if (match) classByIndex[Number(match[1])] = child.classification;
  }

  const component = renderer.component;
  const lines = [
    `${component.componentName} (${component.isComponentSet ? 'component set' : 'component'} · ${component.compSetNodeId})`,
  ];
  const countNodes = (nodes: AnyObject[]): number =>
    nodes.reduce(
      (sum, node) => sum + 1 + countNodes(node.children ?? []),
      0,
    );
  const totalNodes = 1 + countNodes(renderer.defaultTree?.children ?? []);
  const depthCap = totalNodes > 40 ? 4 : Number.POSITIVE_INFINITY;
  const walk = (
    nodes: AnyObject[],
    prefix: string,
    topLevel: boolean,
    depth = 1,
  ): void => {
    nodes.forEach((node, index) => {
      const last = index === nodes.length - 1;
      const type = String(node.type ?? 'unknown').toLowerCase();
      const label =
        type === 'text' && node.characters === node.name ? `"${node.characters}"` : node.name;
      const tags: string[] = [];
      if (topLevel && classByIndex[index]) tags.push(classByIndex[index]);
      if (
        String(node.name).toLowerCase() !== 'label' &&
        doNotText.some((text) => text.includes(String(node.name).toLowerCase()))
      ) {
        tags.push('a11y-hidden');
      }
      const showId = type !== 'text' && type !== 'vector';
      lines.push(
        `${prefix}${last ? '└─ ' : '├─ '}${label} (${type}${showId && node.id ? ` · ${node.id}` : ''})${tags.length ? ` · ${tags.join(' · ')}` : ''}`,
      );
      if (node.children?.length) {
        const childPrefix = prefix + (last ? '   ' : '│  ');
        if (depth >= depthCap) {
          lines.push(`${childPrefix}└─ … (${countNodes(node.children)} more nodes)`);
        } else {
          walk(node.children, childPrefix, false, depth + 1);
        }
      }
    });
  };
  walk(renderer.defaultTree?.children ?? [], '', true);
  return ['### Anatomy', '', '```text', ...lines, '```'].join('\n');
}

function propertyType(values: string): string {
  if (values === 'true, false') return 'boolean';
  if (['string', 'number', 'IconName', '(instance)', '(slot)'].includes(values)) return values;
  return 'enum';
}

function propertyValueCell(values: string): string {
  if (['string', 'number', 'IconName'].includes(values) || values.startsWith('(')) return '—';
  return values
    .split(',')
    .map((value) => value.trim())
    .join(' | ');
}

function propertyRows(properties: AnyObject[]): unknown[][] {
  let parent: string | null = null;
  return properties.map((property) => {
    let notes = property.notes || '–';
    if (property.isSubProperty && parent) {
      const enablingValue = /leadingIcon|trailingIcon/.test(property.property)
        ? 'icon'
        : 'its enabling value';
      if (!notes.includes(`Only meaningful when ${parent}`)) {
        notes = `Only meaningful when ${parent} = ${enablingValue}. ${notes}`;
      }
    } else {
      parent = property.property;
    }
    return [
      property.property,
      propertyType(property.values),
      propertyValueCell(property.values),
      property.default || '–',
      notes,
    ];
  });
}

function referencedPropertyValue(property: AnyObject): { value: string; notes: string } {
  if (property.type === 'BOOLEAN') return { value: String(Boolean(property.value)), notes: '—' };
  if (property.type === 'INSTANCE_SWAP') {
    return { value: `(instance \`${property.value}\`)`, notes: '—' };
  }
  if (property.type === 'TEXT') return { value: `\`${property.value}\``, notes: '—' };
  if (property.type === 'VARIANT') {
    return { value: String(property.value), notes: 'Variant axis on the placed instance.' };
  }
  return { value: String(property.value ?? '—'), notes: '—' };
}

function renderApi(
  api: AnyObject,
  reconciliations: AnyObject,
  confidence: string,
  renderer: AnyObject,
): string {
  const output = [`_Confidence: ${confidence}._${reconciliationTail(reconciliations, 'api')}`, ''];
  if (api.generalNotes) output.push(`> ${api.generalNotes}`, '');
  output.push(
    table(
      ['Property', 'Type', 'Values', 'Default', 'Notes'],
      propertyRows(api.mainTable?.properties ?? []),
    ),
    '',
  );
  for (const subcomponent of api.subComponentTables ?? []) {
    output.push(
      `### ${subcomponent.name}${subcomponent._identityResolved === false ? ' [identity unresolved]' : ''}`,
      '',
    );
    if (subcomponent.description) output.push(subcomponent.description, '');
    if (subcomponent._identityResolved === false) {
      output.push(
        "_The concrete component backing this role could not be resolved. The role is known, but the underlying component identity was not captured — see Known gaps._",
        '',
      );
    }
    output.push(
      table(
        ['Property', 'Type', 'Values', 'Default', 'Notes'],
        propertyRows(subcomponent.properties ?? []),
      ),
      '',
    );
  }
  for (const example of api.configurationExamples ?? []) {
    output.push(`### ${example.title}`, '');
    output.push(
      example.properties?.length
        ? table(
            ['Property', 'Value', 'Notes'],
            example.properties.map((property: AnyObject) => [
              property.property,
              property.value,
              property.notes || '–',
            ]),
          )
        : '_No property-level overrides for this example._',
      '',
    );
  }
  const referenced = (renderer.childComposition?.children ?? []).filter(
    (child: AnyObject) => child.classification === 'referenced',
  );
  if (referenced.length) {
    output.push('### Referenced components', '');
    if (
      referenced.some((child: AnyObject) =>
        (child.classificationEvidence ?? []).includes('instance-swap-fill'),
      )
    ) {
      output.push(
        "_Some entries below describe slot contracts: the parent declares the slot's required shape but does not own the concrete instance — each consumer passes a different one._",
        '',
      );
    }
    for (const child of referenced) {
      const name = displayName(child);
      const childSlug = slugify(name);
      output.push(`#### ${name}`, '');
      const node = child.subCompSetId ?? child.mainComponentId ?? 'unresolved';
      output.push(
        child.origin?.startsWith('slot-') && child.slotName
          ? `This component embeds an instance of **${name}** (node \`${node}\`, spec: \`./${childSlug}.md\`) as the default fill of the **${child.slotName}** slot. It is configured with:`
          : `This component embeds an instance of **${name}** (node \`${node}\`, spec: \`./${childSlug}.md\`). It is configured with:`,
        '',
      );
      const properties = Object.entries(child.componentProperties ?? {}) as Array<
        [string, AnyObject]
      >;
      const rows = properties.length
        ? properties.map(([propertyName, property]) => {
            const formatted = referencedPropertyValue(property);
            return [propertyName, formatted.value, formatted.notes];
          })
        : [['—', 'defaults', 'No overrides captured']];
      output.push(
        table([`Prop passed to ${name}`, 'Value in this context', 'Notes'], rows),
        '',
        `The full property surface of ${name} is documented in its own spec and is not repeated here.`,
        '',
      );
    }
  }
  return output.join('\n').trimEnd();
}

function renderStructure(
  structure: AnyObject,
  reconciliations: AnyObject,
  confidence: string,
  canonical: (value: string) => string,
): string {
  const output = [
    `_Confidence: ${confidence}._${reconciliationTail(reconciliations, 'structure')}`,
    '',
  ];
  if (structure.generalNotes) output.push(`> ${structure.generalNotes}`, '');

  const typography = structure._extractionArtifacts?.typographyTable ?? [];
  if (typography.length) {
    output.push(
      '### Typography',
      '',
      '_Per-element typography for every text element in the component. Per-section typography rows below remain authoritative when they differ._',
      '',
      table(
        ['Element', 'Family', 'Weight', 'Size', 'Line height', 'Letter spacing', 'Style', 'Notes'],
        typography.map((entry: AnyObject) => [
          entry.element,
          entry.fontFamily,
          entry.fontWeight,
          entry.fontSize,
          entry.lineHeight,
          entry.letterSpacing,
          entry.styleName || (entry.styleId ? 'inline (unresolved style)' : 'inline'),
          entry.notes || '—',
        ]),
      ),
      '',
    );
  }

  for (const delta of structure._extractionArtifacts?.visualOnlyAxisDeltas ?? []) {
    if (!delta.rows?.length) continue;
    output.push(
      `### ${delta.axis === 'state' ? 'State' : titleCase(delta.axis)} deltas`,
      '',
      `_Non-dimensional properties that change across the ${delta.axis} axis. Dimensional values are documented below._`,
      '',
      table(
        ['Element', ...(delta.columns ?? []).map(canonical), 'Notes'],
        delta.rows.map((row: AnyObject) => [
          row.element,
          ...(row.values ?? []),
          row.notes || '—',
        ]),
      ),
      '',
    );
  }

  for (const section of structure.sections ?? []) {
    output.push(`### ${section.sectionName}`, '');
    if (section.sectionDescription) output.push(section.sectionDescription, '');
    const rows = (section.rows ?? []).map((row: AnyObject, index: number) => {
      let spec = row.spec;
      if (row.isSubProperty === true) {
        const next = section.rows[index + 1];
        spec = `${!next || next.isSubProperty !== true ? '└' : '├'} ${spec}`;
      }
      if (row.provenance === 'inferred') {
        const token = /`([^`]+)`/.exec(row.notes ?? '')?.[1];
        spec = `[inferred${token ? ` via ${token}` : ''}] ${spec}`;
      } else if (row.provenance === 'not-measured') {
        spec = `[unmeasured] ${spec}`;
      }
      return [spec, ...(row.values ?? []), row.notes || '—'];
    });
    output.push(table(section.columns ?? [], rows), '');
  }
  return output.join('\n').trimEnd();
}

function tokenWithHex(token: unknown, hex: unknown): string {
  const normalized = token == null || token === 'none' ? null : String(token);
  if (normalized && hex) return `${normalized} (${hex})`;
  if (normalized) return normalized;
  if (hex) return String(hex);
  return 'none';
}

function renderColor(color: AnyObject, reconciliations: AnyObject, confidence: string): string {
  const output = [
    `_Confidence: ${confidence}._${reconciliationTail(reconciliations, 'color')}`,
    '',
  ];
  if (color.generalNotes) output.push(`> ${color.generalNotes}`, '');
  const strategy = color._extractionArtifacts?.strategy ?? color.renderingStrategy;

  if (strategy === 'B') {
    for (const section of color.sections ?? []) {
      output.push(`### ${section.name ?? section.sectionName}`, '');
      for (const colorTable of section.tables ?? []) {
        if ((section.tables ?? []).length > 1) output.push(`#### ${colorTable.name}`, '');
        const states =
          colorTable.states ??
          Object.keys(colorTable.elements?.[0]?.tokensByState ?? {});
        const rows = (colorTable.elements ?? []).map((element: AnyObject, index: number) => {
          const hexes = colorTable.elementHexesByState?.[index]?.hexByState ?? {};
          return [
            element.element,
            ...states.map((state: string) =>
              tokenWithHex(element.tokensByState?.[state], hexes[state]),
            ),
            element.notes || '—',
          ];
        });
        output.push(table(['Element', ...states, 'Notes'], rows), '');
      }
    }
  } else {
    for (const variant of color.variants ?? []) {
      output.push(`### ${variant.name}`, '');
      for (const colorTable of variant.tables ?? []) {
        if ((variant.tables ?? []).length > 1) output.push(`#### ${colorTable.name}`, '');
        const rows: unknown[][] = [];
        (colorTable.elements ?? []).forEach((element: AnyObject, index: number) => {
          rows.push([
            element.element,
            tokenWithHex(element.token, colorTable.elementHexes?.[index]?.hex),
            element.notes || '—',
          ]);
          (element.compositeChildren ?? []).forEach(
            (child: AnyObject, childIndex: number, children: AnyObject[]) => {
              rows.push([
                `${childIndex === children.length - 1 ? '└' : '├'} ${child.element}`,
                child.value,
                child.notes || '—',
              ]);
            },
          );
        });
        output.push(table(['Element', 'Token', 'Notes'], rows), '');
      }
    }
  }
  return output.join('\n').trimEnd();
}

function renderVoice(voice: AnyObject, reconciliations: AnyObject, confidence: string): string {
  const output = [
    `_Confidence: ${confidence}._${reconciliationTail(reconciliations, 'voice')}`,
    '',
  ];
  if (voice.guidelines) output.push(`> ${voice.guidelines}`, '');
  const platforms = ['VoiceOver (iOS)', 'TalkBack (Android)', 'ARIA (Web)'];
  for (const state of voice.states ?? []) {
    output.push(`### State: ${state.state}`, '');
    if (state.description) output.push(state.description, '');
    for (const platform of platforms) {
      output.push(`#### ${platform}`, '');
      const section = (state.sections ?? []).find((entry: AnyObject) => entry.title === platform);
      if (!section) {
        output.push('> Missing from extraction — re-run extract-voice.', '');
        continue;
      }
      for (const voiceTable of section.tables ?? []) {
        if ((section.tables ?? []).length > 1) output.push(`##### ${voiceTable.name}`, '');
        output.push(
          table(
            ['Property', 'Value', 'Notes'],
            [
              ['Announcement', voiceTable.announcement, '—'],
              ...(voiceTable.properties ?? []).map((property: AnyObject) => [
                property.property,
                property.value,
                property.notes || '—',
              ]),
            ],
          ),
          '',
        );
      }
    }
  }

  const slotInsertions: AnyObject[] = [
    ...(voice.focusOrder?.slotInsertions ?? []),
    ...(voice.states ?? []).flatMap((state: AnyObject) => state.slotInsertions ?? []),
  ];
  const uniqueInsertions = [
    ...new Map(
      slotInsertions.map((insertion) => [JSON.stringify(sorted(insertion)), insertion]),
    ).values(),
  ];
  if (uniqueInsertions.length) {
    output.push('### Slot insertions', '');
    for (const insertion of uniqueInsertions) {
      const overrides =
        Object.keys(insertion.nestedOverrides ?? {}).length > 0
          ? JSON.stringify(sorted(insertion.nestedOverrides))
          : Object.keys(insertion.textOverrides ?? {}).length > 0
            ? `text ${JSON.stringify(sorted(insertion.textOverrides))}`
            : '—';
      output.push(
        `- In focus order preview: slot **${insertion.slotName}** populated with **${insertion.componentNodeId}**. Overrides: ${overrides}.`,
      );
    }
    output.push('');
  }

  const focusStops = new Map<string, AnyObject>();
  const collect = (entry: AnyObject): void => {
    if (!entry?.name || focusStops.has(entry.name)) return;
    focusStops.set(entry.name, {
      name: entry.name,
      focusOrderIndex: entry.focusOrderIndex ?? null,
      layerName: entry.layerName ?? null,
      slotIndex: entry.slotIndex ?? null,
    });
  };
  for (const entry of voice.focusOrder?.tables ?? []) collect(entry);
  for (const state of voice.states ?? []) {
    for (const section of state.sections ?? []) {
      for (const entry of section.tables ?? []) collect(entry);
    }
  }
  output.push(`<!-- voice-render-meta v=1\n${JSON.stringify({ focusStops: [...focusStops.values()] })}\n-->`);
  return output.join('\n').trimEnd();
}

function renderKnownGaps(
  renderer: AnyObject,
  api: AnyObject,
  structure: AnyObject,
  color: AnyObject,
  voice: AnyObject,
  reconciliations: AnyObject,
): string {
  const high: string[] = [];
  const medium: string[] = [];
  const low: string[] = [];

  for (const warning of renderer.extractionNotes?.warnings ?? []) {
    const text = `${warning.code ?? 'warning'}: ${warning.message ?? String(warning)}`;
    (['HIERWALK_MISSING_CHILDREN', 'SAMPLING_DEVIATION'].includes(warning.code)
      ? high
      : medium
    ).push(text);
  }
  for (const variant of renderer.variantSelfChecks ?? []) {
    for (const missing of variant.selfCheck?.missingChildren ?? []) {
      high.push(`self-check missing child in "${variant.name}": ${String(missing)}`);
    }
  }
  for (const subcomponent of api.subComponentTables ?? []) {
    if (subcomponent._identityResolved === false) {
      medium.push(`identity unresolved: "${subcomponent.name}"`);
    }
  }
  for (const child of renderer.childComposition?.children ?? []) {
    if (child.classification === 'constitutive' && !child.subCompSetId) {
      high.push(`composition identity missing for constitutive child "${child.name}"`);
    }
    if (child.classification === 'referenced' && !child.subCompSetId) {
      medium.push(`referenced component identity unresolved: "${displayName(child)}"`);
    }
  }
  for (const child of renderer.childComposition?.ambiguousChildren ?? []) {
    high.push(`composition classification remains ambiguous: "${displayName(child)}"`);
  }
  for (const section of structure.sections ?? []) {
    if (section._anchor?.layerId === null) {
      medium.push(
        `render-meta: could not resolve nodeId for sectionTargets["${section.sectionName}"] in parent variant "${
          section._anchor?.variantName ?? section._anchor?.variantId ?? 'unspecified'
        }" — ${section._anchor?._targetReason ?? 'no source-accurate layer was supplied'}`,
      );
    }
    for (const row of section.rows ?? []) {
      if (row.isSubProperty !== true && '_layerName' in row && row._layerId === null) {
        const scope =
          row._targetScope === 'subcomponent'
            ? `sub-component set "${row._targetSubCompSetId}"`
            : `parent variant "${row._targetVariantName ?? row._targetVariantId ?? 'unspecified'}"`;
        medium.push(
          `render-meta: could not resolve nodeId for groupTargets["${section.sectionName}"]["${row.spec}"] — layer name "${row._layerName}" has no source-accurate node in ${scope} tree`,
        );
      }
    }
  }
  for (const [name, data] of [
    ['structure', structure],
    ['color', color],
    ['voice', voice],
  ] as const) {
    if (data._dictionaryUnavailable === true) {
      medium.push(`${name} ran without api-dictionary.json; vocabulary is unchecked`);
    }
  }
  for (const [name, data] of [
    ['api', api],
    ['structure', structure],
    ['color', color],
    ['voice', voice],
  ] as const) {
    for (const delta of data._deltaExtractions ?? []) {
      low.push(
        `delta (${name}, ${delta.unavailable || 'ran'}): ${String(delta.purpose).slice(0, 110)}…`,
      );
    }
  }
  for (const unresolved of reconciliations.unresolved ?? []) {
    high.push(`reconciliation (${unresolved.class}): ${unresolved.specialist} · ${unresolved.detail}`);
  }

  const bucket = (label: string, items: string[]): string | null => {
    if (!items.length) return null;
    const shown = items.slice(0, 6).join('; ');
    return `- **${label}** — ${items.length} item${items.length === 1 ? '' : 's'}. ${shown}${items.length > 6 ? `; … and ${items.length - 6} more` : ''}.`;
  };
  const unresolved = [
    bucket('High', high),
    bucket('Medium', medium),
    bucket('Low', low),
  ].filter(Boolean) as string[];

  const auto: string[] = [];
  const drift = (reconciliations.autoReconciled ?? []).filter(
    (entry: AnyObject) => entry.class === 'vocabulary-drift',
  );
  for (const specialist of [...new Set(drift.map((entry: AnyObject) => entry.specialist))]) {
    const group = drift.filter((entry: AnyObject) => entry.specialist === specialist);
    auto.push(
      `- **${specialist}** — ${group.length} vocabulary drift auto-rewritten: ${group
        .slice(0, 6)
        .map((entry: AnyObject) => `${entry.before} → ${entry.after}`)
        .join(', ')}${group.length > 6 ? `, … and ${group.length - 6} more` : ''}.`,
    );
  }
  for (const retry of reconciliations.retries ?? []) {
    const progress =
      retry.gapCountBefore != null && retry.gapCountAfter != null
        ? ` (${retry.gapCountBefore}→${retry.gapCountAfter} gaps)`
        : '';
    auto.push(
      `- **${retry.specialist}** — ${retry.retryCount} retry: missing ${(retry.missingItems ?? []).join(', ')}; outcome: ${retry.outcome}${progress}.`,
    );
  }
  if (auto.length) {
    auto.push(
      '',
      '_Auto-reconciliations are safe renames or bounded retries, not semantic changes. See the reconciliation cache for the full action log._',
    );
  }
  if (!unresolved.length && !auto.length) return '_No gaps detected._';
  return [
    '### Unresolved',
    '',
    ...(unresolved.length ? unresolved : ['_None._']),
    '',
    '### Auto-reconciled',
    '',
    ...(auto.length ? auto : ['_None._']),
  ].join('\n');
}

function renderFollowups(renderer: AnyObject, color: AnyObject): string {
  const output: string[] = [];
  if (color._containerRerunHint) {
    const names = (color._containerRerunHint.subCompSetNames ?? []).join(', ');
    output.push(
      `- **Per-child canonical specs (optional).** This component embeds constitutive sub-components: \`${names}\`. The parent surfaces above remain authoritative. Run \`create-component-md\` on each child to produce its canonical spec.`,
    );
  }
  const constitutive = (renderer.childComposition?.children ?? []).filter(
    (child: AnyObject) => child.classification === 'constitutive' && child.subCompSetId,
  );
  if (constitutive.length) {
    output.push(
      `- **Constitutive children:** \`${constitutive
        .map((child: AnyObject) => `${slugify(displayName(child))} (${child.subCompSetId})`)
        .join(', ')}\`. See the recursion manifest in the orchestrator output.`,
    );
  }
  return output.length ? output.join('\n') : '_None._';
}

function axisNames(value: unknown): string[] {
  return (Array.isArray(value)
    ? value.map((axis: AnyObject) => axis.name)
    : Object.keys((value ?? {}) as AnyObject)
  ).sort();
}

function renderInvariants(structure: AnyObject, color: AnyObject, voice: AnyObject): string {
  const output: string[] = [];
  const structureAxes = axisNames(structure._extractionArtifacts?.variantAxes);
  const colorAxes = axisNames(color._extractionArtifacts?.variantAxes);
  const voiceAxes = axisNames(voice._extractionArtifacts?.variantAxes);
  output.push(
    JSON.stringify(structureAxes) === JSON.stringify(colorAxes) &&
      JSON.stringify(colorAxes) === JSON.stringify(voiceAxes)
      ? `- Variant axes: ${structureAxes.join(', ')} — identical across Structure, Color, and Voice.`
      : `- ⚠ Variant axes disagree: structure=[${structureAxes}], color=[${colorAxes}], voice=[${voiceAxes}].`,
  );
  const structureBooleans = Object.keys(structure._extractionArtifacts?.booleanDefs ?? {}).sort();
  const voiceBooleans = Object.keys(voice._extractionArtifacts?.booleanDefs ?? {}).sort();
  const allBooleansDefaultFalse =
    structureBooleans.length > 0 &&
    structureBooleans.every(
      (key) => structure._extractionArtifacts.booleanDefs[key] === false,
    );
  output.push(
    JSON.stringify(structureBooleans) === JSON.stringify(voiceBooleans)
      ? `- Boolean properties: ${structureBooleans.length} — identical across Structure and Voice${allBooleansDefaultFalse ? '; all default to \`false\`' : ''}.`
      : `- ⚠ Boolean properties disagree: structure=[${structureBooleans}], voice=[${voiceBooleans}].`,
  );
  const colorSubcomponents = new Set(
    color._extractionArtifacts?.subComponentsReferenced ?? [],
  );
  const sharedSubcomponents = (structure._extractionArtifacts?.subComponentsSummary ?? [])
    .map((entry: AnyObject) => entry.name)
    .filter((name: string) => colorSubcomponents.has(name));
  if (sharedSubcomponents.length) {
    output.push(
      `- Shared sub-components across Structure and Color: ${sharedSubcomponents.join(', ')}.`,
    );
  }
  const mode = color._extractionArtifacts?.modeDetection;
  output.push(
    mode?.hasModeCollection
      ? `- Color is mode-controlled by "${mode.collectionName}" with modes: ${(mode.modes ?? []).join(', ')}.`
      : '- No variable-mode collection controls this component; measurements without tokens are literals.',
  );
  return output.join('\n');
}

function renderCrossReferences(
  dictionary: AnyObject,
  structure: AnyObject,
  color: AnyObject,
  voice: AnyObject,
  canonical: (value: string) => string,
): string {
  const output: string[] = [];
  const structureColumns = new Set<string>();
  for (const section of structure.sections ?? []) {
    for (const column of (section.columns ?? []).slice(1, -1)) {
      structureColumns.add(String(column).toLowerCase());
    }
  }
  for (const delta of structure._extractionArtifacts?.visualOnlyAxisDeltas ?? []) {
    for (const column of delta.columns ?? []) structureColumns.add(canonical(column).toLowerCase());
  }
  const colorGroups = color.variants ?? color.sections ?? [];
  for (const axis of dictionary.axes ?? []) {
    const inStructure = (axis.values ?? []).some((value: AnyObject) =>
      structureColumns.has(String(value.name).toLowerCase()),
    );
    const inColor = colorGroups.some((group: AnyObject) =>
      (axis.values ?? []).some((value: AnyObject) =>
        String(group.name ?? group.sectionName)
          .toLowerCase()
          .includes(String(value.name).toLowerCase()),
      ),
    );
    const parts = ['API: see Properties table'];
    if (inStructure) parts.push(`Structure: see sections/deltas grouped by ${axis.name}`);
    if (inColor) parts.push(`Color: see variants grouped by ${axis.name}`);
    if (parts.length > 1) output.push(`- Axis **${axis.name}** — ${parts.join(' · ')}`);
  }

  const structureSpecs = new Map<string, string>();
  for (const section of structure.sections ?? []) {
    for (const row of section.rows ?? []) {
      structureSpecs.set(String(row.spec).toLowerCase(), section.sectionName);
    }
  }
  const tokenElements = new Map<string, string>();
  const colorTables = (color.variants ?? color.sections ?? []).flatMap(
    (group: AnyObject) => group.tables ?? [],
  );
  for (const colorTable of colorTables) {
    for (const element of colorTable.elements ?? []) {
      const tokens = element.token
        ? [element.token]
        : Object.values(element.tokensByState ?? {});
      for (const token of tokens) {
        if (
          token &&
          token !== 'none' &&
          structureSpecs.has(String(element.element).toLowerCase()) &&
          !tokenElements.has(String(token))
        ) {
          tokenElements.set(String(token), element.element);
        }
      }
    }
  }
  let tokenCount = 0;
  for (const [token, element] of tokenElements) {
    if (tokenCount === 10) {
      output.push(`… and ${tokenElements.size - 10} more token references.`);
      break;
    }
    const sectionName = structureSpecs.get(String(element).toLowerCase());
    output.push(
      `- Token \`${token}\` is applied to **${element}** — see Structure section "${sectionName}" and Color.`,
    );
    tokenCount++;
  }
  for (const element of voice._extractionArtifacts?.elementsSummary ?? []) {
    const sectionName = structureSpecs.get(String(element.name).toLowerCase());
    if (sectionName) {
      output.push(
        `- Accessibility element **${element.name}** is documented in Structure section "${sectionName}".`,
      );
    }
  }
  return output.length ? output.join('\n') : 'No cross-references detected between sections.';
}

function buildRenderMeta(
  renderer: AnyObject,
  structure: AnyObject,
  baseSourceHash: string,
): { markdown: string; value: AnyObject } {
  const propertyDefs: AnyObject = {};
  for (const [key, definition] of Object.entries(
    renderer.propertyDefinitions?.rawDefs ?? {},
  ) as Array<[string, AnyObject]>) {
    const entry: AnyObject = { type: definition.type };
    if (definition.defaultValue != null) entry.default = definition.defaultValue;
    if (definition.variantOptions) entry.values = definition.variantOptions;
    const boolean = (renderer.propertyDefinitions?.booleans ?? []).find(
      (candidate: AnyObject) => candidate.rawKey === key,
    );
    if (boolean) {
      entry.associatedLayerName = boolean.associatedLayerName;
      entry.associatedLayerId = boolean.associatedLayerId;
    }
    propertyDefs[key] = entry;
  }

  const sectionTargets: AnyObject = {};
  const groupTargets: AnyObject = {};
  for (const section of structure.sections ?? []) {
    sectionTargets[section.sectionName] = {
      name: section._anchor?.layerName ?? null,
      nodeId: section._anchor?.layerId ?? null,
      sourceScope: section._anchor?.sourceScope ?? 'parent',
      variantId: section._anchor?.variantId ?? null,
      variantName: section._anchor?.variantName ?? null,
      variantProperties: section._anchor?.variantProperties ?? {},
      disposition: section._anchor?._targetDisposition ?? null,
      reason: section._anchor?._targetReason ?? null,
      ...(section._anchor?.subCompSetId
        ? { subCompSetId: section._anchor.subCompSetId }
        : {}),
    };
    groupTargets[section.sectionName] = {};
    for (const row of section.rows ?? []) {
      if (row.isSubProperty !== true && '_layerName' in row) {
        groupTargets[section.sectionName][row.spec] = {
          name: row._layerName,
          nodeId: row._layerId,
          sourceScope: row._targetScope ?? 'parent',
          variantId: row._targetVariantId ?? null,
          variantName: row._targetVariantName ?? null,
          variantProperties: row._targetVariantProperties ?? {},
          disposition: row._targetDisposition ?? null,
          reason: row._targetReason ?? null,
          ...(row._targetSubCompSetId
            ? { subCompSetId: row._targetSubCompSetId }
            : {}),
        };
      }
    }
  }

  const rawSwapResults = renderer.slotHostGeometry?.swapResults;
  const swapResults = Array.isArray(rawSwapResults)
    ? rawSwapResults
    : Object.values(rawSwapResults ?? {});

  const value = {
    schemaVersion: '1.0',
    extractedAt: renderer.source.extractedAt,
    sourceHash: baseSourceHash,
    fileKey: renderer.source.fileKey,
    nodeId: renderer.source.nodeId,
    component: renderer.component,
    variantAxes: Object.fromEntries(
      (renderer.variantAxes ?? []).map((axis: AnyObject) => [axis.name, axis.options]),
    ),
    variantAxesDefaults: Object.fromEntries(
      (renderer.variantAxes ?? []).map((axis: AnyObject) => [axis.name, axis.defaultValue]),
    ),
    propertyDefs,
    booleanDefs: (renderer.propertyDefinitions?.booleans ?? []).map((boolean: AnyObject) => ({
      key: boolean.rawKey,
      default: boolean.defaultValue,
      associatedLayerName: boolean.associatedLayerName,
      associatedLayerId: boolean.associatedLayerId,
    })),
    subComponents: (renderer.childComposition?.children ?? [])
      .filter(
        (child: AnyObject) => child.classification === 'constitutive' && child.subCompSetId,
      )
      .map((child: AnyObject) => ({
        name: child.name,
        mainComponentName: child.mainComponentName,
        subCompSetId: child.subCompSetId,
        subCompVariantAxes: child.subCompVariantAxes ?? {},
        subCompVariantAxesDefaults:
          renderer.subComponentVariantWalks?.[child.subCompSetId]?.variants?.[0]
            ?.variantProperties ?? {},
        booleanOverrides: child.booleanOverrides ?? {},
      })),
    slotContents: (renderer.propertyDefinitions?.slots ?? []).map((slot: AnyObject) => {
      const swap = swapResults.find(
        (result: AnyObject) =>
          result.slotName === slot.name ||
          (slot.nodeId && result.slotNodeId === slot.nodeId),
      );
      return {
        slotName: slot.name,
        slotNodeType: slot.nodeType ?? null,
        preferredComponents:
          swap?.preferredComponents ??
          swap?.preferredInstances ??
          slot.preferredComponents ??
          [],
      };
    }),
    sectionTargets,
    groupTargets,
  };
  return {
    value,
    markdown: `\`\`\`json\n${JSON.stringify(sorted(value), null, 2)}\n\`\`\``,
  };
}

function counts(targets: AnyObject): { resolved: number; total: number } {
  const values = Object.values(targets) as AnyObject[];
  return { resolved: values.filter((target) => target.nodeId).length, total: values.length };
}

function countsByVariant(targets: AnyObject[]): Record<string, { resolved: number; total: number }> {
  const out: Record<string, { resolved: number; total: number }> = {};
  for (const target of targets) {
    const key = `${target.sourceScope ?? 'parent'}:${target.variantId ?? 'unspecified'}`;
    const count = out[key] ?? { resolved: 0, total: 0 };
    count.total += 1;
    if (target.nodeId) count.resolved += 1;
    out[key] = count;
  }
  return out;
}

export async function renderComponentMarkdown(opts: RenderOptions): Promise<RenderResult> {
  const startedAt = performance.now();
  const manifest = await readJson<PrepareManifest>(opts.manifestPath);
  const plan = await readJson<RenderPlan>(opts.planPath);
  const renderPlanBytes = Buffer.byteLength(await readFile(opts.planPath, 'utf8'));
  const slug = manifest._meta.componentSlug;

  if (plan._meta.componentSlug !== slug) {
    throw new Error(`Render plan slug mismatch: ${plan._meta.componentSlug} !== ${slug}`);
  }
  if (plan._meta.baseSourceHash !== manifest._meta.baseSourceHash) {
    throw new Error('Render plan baseSourceHash does not match prepare manifest');
  }
  if (!plan.data.overviewParagraph?.trim()) {
    throw new Error('Render plan data.overviewParagraph is required (AI semantic synthesis)');
  }

  const contractBuild = opts.contractPath
    ? await loadCanonicalComponentContract(opts.contractPath)
    : await buildCanonicalComponentContract({
        manifestPath: opts.manifestPath,
        planPath: opts.planPath,
        outputPath: opts.contractOutputPath,
        normalizeCaches: opts.normalizeCaches,
      });
  const contract = contractBuild.contract;
  if (
    contract.component.slug !== slug ||
    contract.source.baseSourceHash !== manifest._meta.baseSourceHash ||
    contract.generatedAt !== plan._meta.generatedAt
  ) {
    throw new Error('Canonical contract does not match the manifest and render plan');
  }
  const validations = contractBuild.cacheValidations;
  const renderer = contract.sourceModel;
  const api = contract.api;
  const dictionary = contract.dictionary;
  const structure = contract.structure;
  const color = contract.color;
  const voice = contract.accessibility;
  const reconciliations = contract.reconciliations;
  const map = canonicalMap(dictionary, reconciliations);
  const canonical = (value: string): string => map[value] ?? value;
  const confidence = contract.summary.confidence;

  const renderMeta = buildRenderMeta(renderer, structure, manifest._meta.baseSourceHash);
  const axesSummary =
    (renderer.variantAxes ?? [])
      .map(
        (axis: AnyObject) =>
          `**${axis.name}** (${axis.options.map(canonical).join(' \\| ')}; default \`${canonical(axis.defaultValue)}\`)`,
      )
      .join(', ') + `. ${manifest._meta.variantsWalked} variants in the set.`;

  const view = opts.view ?? 'concise';
  let markdown: string;
  if (view === 'concise') {
    markdown = renderConciseMarkdown(contract, {
      contractPath: contractBuild.outputPath,
      auditPath: opts.auditOutputPath,
    });
  } else {
    const { referencesSrc } = resolveSourceDirs();
    const templatePath =
      opts.templatePath ?? join(referencesSrc, 'component-md', 'component-md-template.md');
    markdown = await readFile(templatePath, 'utf8');
    const substitutions: Record<string, string> = {
      COMPONENT_NAME: api.componentName,
      FIGMA_URL: renderer.source.figmaUrl,
      GENERATED_AT: plan._meta.generatedAt,
      OPTIONAL_CONTEXT: renderer.source.optionalContext ?? 'none',
      NODE_ID: renderer.source.nodeId,
      FILE_KEY: renderer.source.fileKey,
      CACHE_PATH: `.uspec-cache/${slug}/`,
      OVERVIEW_PARAGRAPH: plan.data.overviewParagraph.trim(),
      VARIANT_AXES_SUMMARY: axesSummary,
      COMPOSITION_SUBSECTION: renderComposition(renderer),
      KNOWN_GAPS: renderKnownGaps(
        renderer,
        api,
        structure,
        color,
        voice,
        reconciliations,
      ),
      FOLLOWUPS: renderFollowups(renderer, color),
      CROSS_SECTION_INVARIANTS: `\n\n${renderInvariants(structure, color, voice)}`,
      API_BODY: renderApi(api, reconciliations, confidence.api, renderer),
      ANATOMY_SCAFFOLD: renderAnatomy(renderer, voice),
      STRUCTURE_BODY: renderStructure(
        structure,
        reconciliations,
        confidence.structure,
        canonical,
      ),
      COLOR_BODY: renderColor(color, reconciliations, confidence.color),
      VOICE_BODY: renderVoice(voice, reconciliations, confidence.voice),
      CROSS_REFERENCES: renderCrossReferences(
        dictionary,
        structure,
        color,
        voice,
        canonical,
      ),
      RENDER_META_JSON: renderMeta.markdown,
    };
    for (const [key, value] of Object.entries(substitutions)) {
      markdown = markdown.split(`{{${key}}}`).join(value);
    }
  }
  markdown =
    markdown
      .split('\n')
      .map((line) => line.replace(/[ \t]+$/, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n';

  const audit = auditMarkdown(markdown, { requireMetadata: view === 'audit' });
  if (view === 'concise') {
    audit.errors.push(...auditHumanView(markdown, contract));
    audit.ok = audit.errors.length === 0;
  }
  if (!audit.ok) {
    throw new Error(`Rendered Markdown audit failed:\n${audit.errors.map((e) => `  ${e}`).join('\n')}`);
  }

  const outputPath = opts.outputPath ?? manifest.paths.outputPath;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, markdown, 'utf8');

  const sectionTargetCounts = counts(renderMeta.value.sectionTargets);
  const flattenedGroups = Object.fromEntries(
    Object.entries(renderMeta.value.groupTargets).flatMap(([section, groups]: [string, any]) =>
      Object.entries(groups).map(([group, target]) => [`${section}/${group}`, target]),
    ),
  );
  const specialistCacheBytes =
    validations.length > 0
      ? validations.reduce((sum, result) => sum + result.bytes, 0)
      : manifest.metrics?.render?.specialistCacheBytes ?? 0;
  const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
  const renderMetrics = {
    renderedAt: plan._meta.generatedAt,
    specialistCacheBytes,
    contractBytes: contractBuild.bytes,
    renderPlanBytes,
    outputBytes: audit.bytes,
    estimatedInputTokens: Math.ceil((contractBuild.bytes + renderPlanBytes) / 4),
    durationMs,
  };
  manifest.metrics ??= {
    prepare: {
      baseBytes: manifest._meta.baseBytes,
      evidenceBytes: { api: 0, structure: 0, color: 0, voice: 0, renderer: 0 },
      obligationCounts: { api: 0, structure: 0, color: 0, voice: 0 },
      obligationKindCounts: { api: {}, structure: {}, color: {}, voice: {} },
      totalEvidenceBytes: 0,
      estimatedInputTokens: Math.ceil(manifest._meta.baseBytes / 4),
    },
  };
  manifest.metrics.render = renderMetrics;
  await writeFile(opts.manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  return {
    outputPath,
    contractPath: contractBuild.outputPath,
    view,
    bytes: audit.bytes,
    tables: audit.tables,
    sectionTargets: sectionTargetCounts,
    groupTargets: counts(flattenedGroups),
    targetResolutionByVariant: countsByVariant([
      ...Object.values(renderMeta.value.sectionTargets),
      ...Object.values(flattenedGroups),
    ] as AnyObject[]),
    droppedStructureSpecs: view === 'concise' ? droppedStructureSpecs(structure) : [],
    sourceCoverage: {
      apiProperties:
        (api.mainTable?.properties?.length ?? 0) +
        (api.subComponentTables ?? []).reduce(
          (sum: number, component: AnyObject) => sum + (component.properties?.length ?? 0),
          0,
        ),
      structureSections: structure.sections?.length ?? 0,
      structureRows: (structure.sections ?? []).reduce(
        (sum: number, section: AnyObject) => sum + (section.rows?.length ?? 0),
        0,
      ),
      colorGroups: (color.variants ?? color.sections ?? []).length,
      colorElements: (color.variants ?? color.sections ?? []).reduce(
        (groupSum: number, group: AnyObject) =>
          groupSum +
          (group.tables ?? []).reduce(
            (tableSum: number, colorTable: AnyObject) =>
              tableSum + (colorTable.elements?.length ?? 0),
            0,
          ),
        0,
      ),
      voiceStates: voice.states?.length ?? 0,
      voicePlatforms: (voice.states ?? []).reduce(
        (sum: number, state: AnyObject) => sum + (state.sections?.length ?? 0),
        0,
      ),
    },
    metrics: {
      specialistCacheBytes,
      contractBytes: contractBuild.bytes,
      renderPlanBytes,
      estimatedInputTokens: renderMetrics.estimatedInputTokens,
      durationMs,
    },
    audit,
  };
}
