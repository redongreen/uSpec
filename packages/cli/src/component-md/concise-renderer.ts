import { basename } from 'node:path';
import type { CanonicalComponentContract } from './types.js';

type JsonObject = Record<string, any>;

function escapeCell(value: unknown): string {
  return String(value ?? '')
    .replaceAll('|', '\\|')
    .replace(/\n+/gu, ' ')
    .trim();
}

function table(headers: unknown[], rows: unknown[][]): string {
  return [
    `| ${headers.map(escapeCell).join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`),
  ].join('\n');
}

function propertyType(values: string): string {
  if (values === 'true, false') return 'boolean';
  if (['string', 'number', 'IconName', '(instance)', '(slot)'].includes(values)) {
    return values;
  }
  return 'enum';
}

function propertyValues(values: string): string {
  if (['string', 'number', 'IconName'].includes(values) || values.startsWith('(')) {
    return '—';
  }
  return values
    .split(',')
    .map((value) => value.trim())
    .join(' | ');
}

function renderApi(api: JsonObject): string {
  const output: string[] = [];
  if (api.generalNotes) output.push(`> ${api.generalNotes}`, '');
  const renderProperties = (title: string, properties: JsonObject[]) => {
    if (!properties.length) return;
    output.push(
      `### ${title}`,
      '',
      table(
        ['Property', 'Type', 'Values', 'Default', 'Notes'],
        properties.map((property) => [
          property.property,
          property.type ?? propertyType(String(property.values ?? '—')),
          propertyValues(String(property.values ?? '—')),
          property.default ?? '—',
          property.notes ?? '',
        ]),
      ),
      '',
    );
  };
  renderProperties('Component API', api.mainTable?.properties ?? []);
  for (const subcomponent of api.subComponentTables ?? []) {
    renderProperties(subcomponent.name ?? 'Sub-component', subcomponent.properties ?? []);
  }
  for (const example of api.configurationExamples ?? []) {
    output.push(
      `### ${example.title}`,
      '',
      (example.properties ?? []).length
        ? table(
            ['Property', 'Value', 'Notes'],
            example.properties.map((property: JsonObject) => [
              property.property,
              property.value,
              property.notes ?? '—',
            ]),
          )
        : '_Uses component defaults._',
      '',
    );
  }
  return output.join('\n').trimEnd();
}

function displayName(child: JsonObject): string {
  return child.parentSetName && child.parentSetName !== child.mainComponentName
    ? child.parentSetName
    : child.mainComponentName || child.name;
}

function renderComposition(contract: CanonicalComponentContract): string {
  const composition = contract.anatomy.composition as JsonObject | null;
  if (!composition) return 'No composed children were detected.';
  const output: string[] = [];
  for (const child of composition.children ?? []) {
    if (child.classification === 'decorative') continue;
    const identity = child.subCompSetId ? ` · ${child.subCompSetId}` : '';
    output.push(
      `- **${displayName(child)}** — ${child.classification}${identity}. ${child.classificationReason ?? ''}`.trim(),
    );
  }
  const decorative = (composition.children ?? []).filter(
    (child: JsonObject) => child.classification === 'decorative',
  ).length;
  if (decorative) {
    output.push(`- **Decorative children:** ${decorative}; documented through Structure and Color.`);
  }
  return output.length ? output.join('\n') : 'No composed children were detected.';
}

function renderAnatomy(tree: JsonObject | null): string {
  if (!tree) return 'No anatomy tree was emitted.';
  const lines: string[] = [];
  const walk = (node: JsonObject, prefix: string, isLast: boolean, showBranch: boolean) => {
    const branch = showBranch ? (isLast ? '└─ ' : '├─ ') : '';
    lines.push(`${prefix}${branch}${node.name} (${String(node.type ?? 'node').toLowerCase()})`);
    const children = node.children ?? [];
    const childPrefix = showBranch ? `${prefix}${isLast ? '   ' : '│  '}` : prefix;
    children.forEach((child: JsonObject, index: number) =>
      walk(child, childPrefix, index === children.length - 1, true),
    );
  };
  walk(tree, '', true, false);
  return ['```text', ...lines, '```'].join('\n');
}

function renderInvariants(contract: CanonicalComponentContract): string {
  const output: string[] = [];
  const required = (contract.api.mainTable?.properties ?? [])
    .filter((property: JsonObject) => property.required === true)
    .map((property: JsonObject) => property.property);
  if (required.length) output.push(`- Always present: ${required.map((value: string) => `\`${value}\``).join(', ')}.`);
  const optional = (contract.api.mainTable?.properties ?? []).filter(
    (property: JsonObject) => property.required !== true && property.isSubProperty !== true,
  );
  if (optional.length) {
    const defaults = optional.map(
      (property: JsonObject) => `\`${property.property}\`=${String(property.default ?? '–')}`,
    );
    output.push(`- Optional-property defaults: ${defaults.join(', ')}.`);
  }
  if (contract.structure.generalNotes) output.push(`- ${contract.structure.generalNotes}`);
  const focusStops = contract.accessibility?._extractionArtifacts?.focusStopsCount;
  if (typeof focusStops === 'number') {
    output.push(`- Accessibility focus stops: ${focusStops}; visual variants must not alter reading order.`);
  }
  return output.join('\n');
}

const conciseStructureSpecs = new Set(
  [
    'minHeight',
    'minWidth',
    'maxHeight',
    'maxWidth',
    'verticalPadding',
    'horizontalPadding',
    'padding',
    'paddingTop',
    'paddingBottom',
    'paddingStart',
    'paddingEnd',
    'itemSpacing',
    'counterAxisSpacing',
    'contentSpacing',
    'layoutDirection',
    'layoutWrap',
    'primaryAxisAlignItems',
    'counterAxisAlignItems',
    'width',
    'height',
    'fixedWidth',
    'fixedHeight',
    'cornerRadius',
    'strokeWeight',
    'widthMode',
    'heightMode',
    'clipsContent',
    'textStyle',
    'fontFamily',
    'fontSize',
    'fontWeight',
    'lineHeight',
    'letterSpacing',
    'iconName',
    'iconSize',
    'slotWidth',
    'slotHeight',
    'contentType',
    'nestedSize',
    'nestedTheme',
    'borderWidth',
    'strokeAlign',
  ].map((value) => value.toLowerCase()),
);

function includeStructureRow(row: JsonObject): boolean {
  if (row.isSubProperty !== true) return true;
  return conciseStructureSpecs.has(String(row.spec ?? '').toLowerCase());
}

export function droppedStructureSpecs(structure: JsonObject): string[] {
  const dropped = new Set<string>();
  for (const section of structure?.sections ?? []) {
    for (const row of section.rows ?? []) {
      if (includeStructureRow(row)) continue;
      dropped.add(String(row.spec ?? ''));
    }
  }
  return [...dropped].sort();
}

function renderStructure(structure: JsonObject): string {
  const output: string[] = [];
  for (const section of structure.sections ?? []) {
    const rows = (section.rows ?? []).filter(includeStructureRow);
    if (!rows.length) continue;
    output.push(
      `### ${section.sectionName}`,
      '',
      section.sectionDescription ?? '',
      '',
      table(
        section.columns ?? ['Spec', 'Value', 'Notes'],
        rows.map((row: JsonObject) => [
          row.isSubProperty === true ? `↳ ${row.spec}` : row.spec,
          ...(row.values ?? []),
          row.notes ?? '',
        ]),
      ),
      '',
    );
  }
  return output.join('\n').trimEnd();
}

function colorValue(element: JsonObject | undefined, hex: string | null | undefined): string {
  if (!element) return '—';
  const token = String(element.token ?? element.value ?? '—');
  const visual = element.compositeChildren?.[0]?.value;
  const details = [token];
  if (visual && visual !== token) details.push(String(visual));
  if (hex && !details.some((detail) => detail.includes(hex))) details.push(hex);
  const opacity = /at (\d+)% opacity/iu.exec(String(element.notes ?? ''))?.[1];
  if (opacity && opacity !== '100') details.push(`${opacity}% opacity`);
  return details.join(' · ');
}

function renderColor(color: JsonObject): string {
  const strategy = color?._extractionArtifacts?.strategy ?? color.renderingStrategy;
  const notes = color.generalNotes ? `> ${color.generalNotes}\n\n` : '';
  const blocks: string[] = [];

  if (strategy === 'B') {
    for (const section of color.sections ?? []) {
      for (const colorTable of section.tables ?? []) {
        const elements = colorTable.elements ?? [];
        if (elements.length === 0) continue;
        const states: string[] =
          colorTable.states ?? Object.keys(elements[0]?.tokensByState ?? {});
        const rows = elements.map((element: JsonObject, index: number) => {
          const hexByState = colorTable.elementHexesByState?.[index]?.hexByState ?? {};
          return [
            element.element,
            ...states.map((state) =>
              colorValue(
                { ...element, token: (element.tokensByState as JsonObject)?.[state] },
                hexByState[state],
              ),
            ),
            element.notes || '—',
          ];
        });
        blocks.push(
          `### ${section.name ?? section.sectionName ?? colorTable.name}`,
          '',
          table(['Element', ...states, 'Notes'], rows),
          '',
        );
      }
    }
  } else {
    const rows: unknown[][] = [];
    for (const group of color.variants ?? []) {
      for (const colorTable of group.tables ?? []) {
        const hexes = colorTable.elementHexes ?? [];
        (colorTable.elements ?? []).forEach((element: JsonObject, index: number) => {
          rows.push([
            group.name ?? group.sectionName ?? colorTable.name ?? 'default',
            element.element,
            colorValue(element, hexes[index]?.hex),
            element.notes || '—',
          ]);
        });
      }
    }
    if (rows.length) blocks.push(table(['Context', 'Element', 'Token', 'Notes'], rows));
  }

  const body = blocks.join('\n').trimEnd();
  return body ? `${notes}${body}` : `${notes}No color mappings were emitted.`;
}

function matchingPropertyValues(tableEntry: JsonObject, pattern: RegExp): string[] {
  return (tableEntry.properties ?? [])
    .filter((candidate: JsonObject) => pattern.test(String(candidate.property ?? '')))
    .map((candidate: JsonObject) => String(candidate.value ?? '—'));
}

function renderAccessibility(accessibility: JsonObject): string {
  const output: string[] = [];
  if (accessibility.guidelines) output.push(accessibility.guidelines, '');
  for (const state of accessibility.states ?? []) {
    const rows: unknown[][] = [];
    for (const section of state.sections ?? []) {
      for (const entry of section.tables ?? []) {
        rows.push([
          section.title,
          matchingPropertyValues(entry, /^element$/iu)[0] ?? '—',
          entry.announcement ?? '—',
          [
            ...matchingPropertyValues(entry, /^(accessibilityTraits|role)$/iu),
            ...matchingPropertyValues(entry, /^(keyboard \/ focus|tabindex)$/iu),
          ].join('; ') || '—',
          matchingPropertyValues(entry, /^(icon|decorative slot content)/iu).join('; ') || '—',
          matchingPropertyValues(entry, /^do not$/iu)
            .map((value) => `Do not: ${value}`)
            .join('; ') || '—',
          entry.focusOrderIndex ?? '—',
        ]);
      }
    }
    output.push(
      `### ${state.state}`,
      '',
      state.description ?? '',
      '',
      rows.length
        ? table(
            [
              'Platform',
              'Native implementation',
              'Announcement',
              'Role and focus',
              'Nested content',
              'Guardrails',
              'Order',
            ],
            rows,
          )
        : 'No platform mappings were emitted.',
      '',
    );
  }
  return output.length ? output.join('\n').trimEnd() : 'No accessibility records were emitted.';
}

function renderKnownGaps(contract: CanonicalComponentContract): string {
  const gaps: string[] = [];
  for (const section of contract.structure.sections ?? []) {
    if (section._anchor && section._anchor.layerId === null) {
      gaps.push(`${section.sectionName}: section target is unresolved`);
    }
    for (const row of section.rows ?? []) {
      if (row.isSubProperty !== true && '_layerName' in row && row._layerId === null) {
        gaps.push(`${section.sectionName} / ${row.spec}: source target is unresolved`);
      }
    }
  }
  for (const unresolved of contract.reconciliations.unresolved ?? []) {
    gaps.push(`${unresolved.specialist}: ${unresolved.detail}`);
  }
  return gaps.length ? gaps.map((gap) => `- ${gap}`).join('\n') : 'No known gaps.';
}

function renderCoverage(contract: CanonicalComponentContract): string {
  return table(
    ['Domain', 'Total', 'Emitted', 'Merged', 'Omitted', 'Unresolved'],
    (['api', 'structure', 'color', 'voice'] as const).map((domain) => {
      const coverage = contract.provenance.obligationCoverage[domain];
      return [
        domain,
        coverage.total,
        coverage.emitted,
        coverage.merged,
        coverage.omitted,
        coverage.unresolved,
      ];
    }),
  );
}

export function renderConciseMarkdown(
  contract: CanonicalComponentContract,
  opts: { contractPath: string; auditPath?: string },
): string {
  const axes = contract.variants.axes
    .map((axis: any) => `${axis.name}: ${(axis.options ?? []).join(' | ')}`)
    .join('; ');
  const references = [
    `Canonical JSON: \`${basename(opts.contractPath)}\``,
    ...(opts.auditPath ? [`Full audit: \`${basename(opts.auditPath)}\``] : []),
  ].join(' · ');

  return [
    `# ${contract.component.name}`,
    '',
    '## Overview',
    '',
    contract.summary.overview,
    '',
    `**Source:** [Figma](${contract.source.figmaUrl}) · **Variants:** ${axes || 'none'}`,
    '',
    '## Composition',
    '',
    renderComposition(contract),
    '',
    '## Anatomy',
    '',
    renderAnatomy(contract.anatomy.defaultTree as JsonObject | null),
    '',
    '## Implementation invariants',
    '',
    renderInvariants(contract),
    '',
    '## API',
    '',
    renderApi(contract.api),
    '',
    '## Structure',
    '',
    renderStructure(contract.structure),
    '',
    '## Color',
    '',
    renderColor(contract.color),
    '',
    '## Accessibility',
    '',
    renderAccessibility(contract.accessibility),
    '',
    '## Known gaps',
    '',
    renderKnownGaps(contract),
    '',
    '## Evidence coverage',
    '',
    renderCoverage(contract),
    '',
    '---',
    '',
    references,
    '',
  ].join('\n');
}
