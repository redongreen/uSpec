import { createHash } from 'node:crypto';
import type {
  BaseJson,
  EvidenceDomain,
  EvidenceObligation,
  EvidenceRepresentation,
  TreeNode,
} from './types.js';

function stableId(domain: EvidenceDomain, kind: string, key: string): string {
  const readable = key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 10);
  return `${domain}:${kind}:${readable || 'fact'}:${hash}`;
}

function obligation(
  domain: EvidenceDomain,
  kind: string,
  key: string,
  label: string,
  policy: EvidenceObligation['policy'],
  sourcePaths: string[],
  facts: Record<string, unknown>,
  representation?: EvidenceRepresentation,
): EvidenceObligation {
  return {
    id: stableId(domain, kind, key),
    domain,
    kind,
    label,
    policy,
    sourcePaths,
    facts,
    ...(representation ? { representation } : {}),
  };
}

function recordEntries(value: unknown): Array<[string, unknown]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>);
}

function flattenLeaves(
  value: unknown,
  prefix = '',
): Array<{ path: string; value: unknown }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? [{ path: prefix, value }] : [];
  }
  const out: Array<{ path: string; value: unknown }> = [];
  for (const [key, child] of recordEntries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      out.push(...flattenLeaves(child, path));
    } else {
      out.push({ path, value: child });
    }
  }
  return out;
}

function flattenMeasurementFamilies(
  value: unknown,
  prefix = '',
): Array<{ path: string; value: unknown }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? [{ path: prefix, value }] : [];
  }
  const record = value as Record<string, unknown>;
  if ('value' in record || 'display' in record || 'token' in record) {
    return prefix ? [{ path: prefix, value: record }] : [];
  }
  const out: Array<{ path: string; value: unknown }> = [];
  for (const [key, child] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.push(...flattenMeasurementFamilies(child, path));
  }
  return out;
}

function lowerCamel(value: string): string {
  return value
    .trim()
    .replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/gu, '')
    .replace(/[^a-zA-Z0-9]+(.)/gu, (_, next: string) => next.toUpperCase())
    .replace(/^./u, (first) => first.toLowerCase());
}

function structureSpecNames(property: string, nodeType?: string): string[] {
  const leaf = property.split('.').at(-1) ?? property;
  const names: Record<string, string[]> = {
    width: nodeType === 'SLOT' ? ['slotWidth', 'fixedWidth', 'width'] : ['fixedWidth', 'width', 'iconSize'],
    height: nodeType === 'SLOT' ? ['slotHeight', 'fixedHeight', 'height'] : ['fixedHeight', 'height', 'iconSize'],
    layoutSizingHorizontal: ['widthMode'],
    layoutSizingVertical: ['heightMode'],
    layoutMode: ['layoutDirection'],
    padding: ['padding'],
    top: ['paddingTop'],
    bottom: ['paddingBottom'],
    start: ['paddingStart'],
    end: ['paddingEnd'],
    vertical: ['verticalPadding'],
    horizontal: ['horizontalPadding'],
  };
  return names[leaf] ?? [leaf];
}

export function buildApiObligations(
  base: BaseJson,
  _defaultVariantIndex: number,
): EvidenceObligation[] {
  const out: EvidenceObligation[] = [];
  for (const [rawKey, definition] of Object.entries(base.propertyDefinitions.rawDefs)) {
    out.push(obligation(
      'api',
      'raw-property',
      rawKey,
      `Raw component property "${rawKey}"`,
      'must-emit',
      [`/propertyDefinitions/rawDefs/${rawKey}`],
      { rawKey, definition },
    ));
  }
  for (const [index, child] of base._childComposition.children.entries()) {
    if (!child.classification || child.classification === 'decorative') continue;
    out.push(obligation(
      'api',
      'component-relation',
      `${child.name}|${child.subCompSetId ?? child.mainComponentName ?? index}`,
      `${child.classification} child component "${child.name}"`,
      'must-emit',
      [`/_childComposition/children/${index}`],
      { ...child },
    ));

    const componentProperties =
      (child as unknown as { componentProperties?: Record<string, unknown> })
        .componentProperties ?? {};
    for (const [propertyName, rawDefinition] of Object.entries(componentProperties)) {
      const definition = rawDefinition as { type?: string; value?: unknown };
      if (definition.type !== 'INSTANCE_SWAP') continue;
      out.push(obligation(
        'api',
        'instance-swap',
        `${child.subCompSetId ?? child.name}|${propertyName}`,
        `Named instance API for "${propertyName}"`,
        'must-emit',
        [`/_childComposition/children/${index}/componentProperties/${propertyName}`],
        {
          childName: child.name,
          subCompSetId: child.subCompSetId ?? null,
          propertyName,
          definition,
        },
        {
          targetKind: 'api-property',
          field: 'type',
          pattern: '^[A-Z][A-Za-z0-9]*Name$',
          allowMerge: true,
        },
      ));
    }
  }

  const axisGroups = new Map<string, { sourcePaths: string[]; values: Set<string> }>();
  collectVariantPropertyGroups(
    base.subComponentVariantWalks,
    '/subComponentVariantWalks',
    axisGroups,
  );
  for (const [key, group] of axisGroups) {
    const axis = key.slice(key.lastIndexOf('|') + 1);
    const property = lowerCamel(axis);
    out.push(obligation(
      'api',
      'subcomponent-axis',
      key,
      `Engineer-facing API for sub-component axis "${axis}"`,
      'must-emit',
      [...new Set(group.sourcePaths)],
      { axis, options: [...group.values].sort() },
      {
        targetKind: 'api-property',
        field: 'property',
        oneOf:
          property === 'content'
            ? ['content', 'leadingContent', 'trailingContent']
            : [property],
        allowMerge: true,
      },
    ));
  }

  const textGroups = new Map<
    string,
    {
      node: TreeNode;
      sourcePaths: string[];
      variantNames: string[];
      variantIds: string[];
      nodeIds: Array<string | null>;
    }
  >();
  for (const [variantIndex, variant] of base.variants.entries()) {
    const collectForVariant = (node: TreeNode, path: string): void => {
      if (node.type === 'TEXT') {
        const key = JSON.stringify([node.name, node.characters ?? null]);
        const group = textGroups.get(key) ?? {
          node,
          sourcePaths: [],
          variantNames: [],
          variantIds: [],
          nodeIds: [],
        };
        group.sourcePaths.push(path);
        group.variantNames.push(variant.name);
        group.variantIds.push(variant.id);
        group.nodeIds.push(node.id ?? null);
        textGroups.set(key, group);
      }
      (node.children ?? []).forEach((child, index) =>
        collectForVariant(child, `${path}/children/${index}`)
      );
    };
    collectForVariant(
      variant.treeHierarchical,
      `/variants/${variantIndex}/treeHierarchical`,
    );
  }
  for (const { node, sourcePaths, variantNames, variantIds, nodeIds } of textGroups.values()) {
    out.push(obligation(
      'api',
      'text-content',
      `${node.name}|${node.characters ?? ''}`,
      `Engineer-facing content API for text layer "${node.name}"`,
      'must-emit',
      sourcePaths,
      {
        layerName: node.name,
        nodeIds,
        characters: node.characters ?? null,
        presentInVariants: variantNames,
        sourceVariantIds: variantIds,
      },
      {
        targetKind: 'api-property',
        field: 'values',
        oneOf: ['string'],
        allowMerge: true,
      },
    ));
  }
  return out;
}

function walkTreeDimensions(
  node: TreeNode,
  sourcePath: string,
  out: EvidenceObligation[],
): void {
  for (const leaf of flattenMeasurementFamilies(node.dimensions ?? {})) {
    out.push(obligation(
      'structure',
      'node-dimension',
      `${node.id ?? sourcePath}|${leaf.path}`,
      `${node.name} ${leaf.path}`,
      'must-emit',
      [`${sourcePath}/dimensions/${leaf.path.replaceAll('.', '/')}`],
      {
        nodeId: node.id ?? null,
        nodeName: node.name,
        nodeType: node.type,
        property: leaf.path,
        value: leaf.value,
      },
    ));
  }
  for (const [index, child] of (node.children ?? []).entries()) {
    walkTreeDimensions(child, `${sourcePath}/children/${index}`, out);
  }
}

function collectVariantPropertyGroups(
  value: unknown,
  path: string,
  groups: Map<string, { sourcePaths: string[]; values: Set<string> }>,
): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => collectVariantPropertyGroups(child, `${path}/${index}`, groups));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  for (const [axis, axisValue] of recordEntries(record.variantProperties)) {
    if (typeof axisValue !== 'string') continue;
    const key = `${path.replace(/\/\d+$/u, '')}|${axis}`;
    const group = groups.get(key) ?? { sourcePaths: [], values: new Set<string>() };
    group.sourcePaths.push(`${path}/variantProperties/${axis}`);
    group.values.add(axisValue);
    groups.set(key, group);
  }
  for (const [key, child] of Object.entries(record)) {
    if (key === 'variantProperties') continue;
    collectVariantPropertyGroups(child, `${path}/${key}`, groups);
  }
}

function appendSubcomponentDimensions(
  out: EvidenceObligation[],
  setId: string,
  variantSignature: string,
  node: Record<string, unknown>,
  sourcePath: string,
  nodePath: string,
): void {
  const nodeName = String(node.name ?? nodePath.split('/').at(-1) ?? 'node');
  const nodeType = String(node.type ?? 'unknown');
  const nodeId = typeof node.id === 'string' ? node.id : null;
  for (const leaf of flattenMeasurementFamilies(node.dimensions ?? {})) {
    out.push(obligation(
      'structure',
      'subcomponent-dimension',
      `${setId}|${variantSignature}|${nodeId ?? nodePath}|${leaf.path}`,
      `${variantSignature}: ${nodeName} ${leaf.path}`,
      'must-emit',
      [`${sourcePath}/dimensions/${leaf.path.replaceAll('.', '/')}`],
      {
        sourceScope: 'subcomponent',
        subCompSetId: setId,
        variantSignature,
        nodeId,
        nodeName,
        nodeType,
        nodePath,
        property: leaf.path,
        value: leaf.value,
      },
      {
        targetKind: 'structure-row',
        field: 'spec',
        oneOf: structureSpecNames(leaf.path, nodeType),
        allowMerge: true,
      },
    ));
  }
  const children = Array.isArray(node.children) ? node.children : [];
  children.forEach((child, index) => {
    if (!child || typeof child !== 'object') return;
    const childRecord = child as Record<string, unknown>;
    const childName = String(childRecord.name ?? index);
    appendSubcomponentDimensions(
      out,
      setId,
      variantSignature,
      childRecord,
      `${sourcePath}/children/${index}`,
      `${nodePath}/${childName}`,
    );
  });
}

function appendSubcomponentGeometry(
  base: BaseJson,
  out: EvidenceObligation[],
): void {
  for (const [setId, rawWalk] of Object.entries(base.subComponentVariantWalks ?? {})) {
    if (!rawWalk || typeof rawWalk !== 'object') continue;
    const variants = (rawWalk as { variants?: unknown[] }).variants;
    if (!Array.isArray(variants)) continue;
    variants.forEach((rawVariant, variantIndex) => {
      if (!rawVariant || typeof rawVariant !== 'object') return;
      const variant = rawVariant as Record<string, unknown>;
      const variantProperties = Object.fromEntries(
        recordEntries(variant.variantProperties)
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
          .sort(([a], [b]) => a.localeCompare(b)),
      );
      const variantSignature =
        Object.entries(variantProperties)
          .map(([axis, value]) => `${axis}=${value}`)
          .join('|') || String(variant.name ?? variantIndex);
      const sourceBase = `/subComponentVariantWalks/${setId}/variants/${variantIndex}`;
      const rootNode: Record<string, unknown> = {
        id: typeof variant.id === 'string' ? variant.id : null,
        name: (variant.treeHierarchical as Record<string, unknown> | undefined)?.name ??
          String(variant.name ?? setId),
        type: (variant.treeHierarchical as Record<string, unknown> | undefined)?.type ??
          'COMPONENT',
        dimensions: variant.dimensions ?? {},
      };
      appendSubcomponentDimensions(
        out,
        setId,
        variantSignature,
        rootNode,
        sourceBase,
        String(rootNode.name),
      );
      const tree = variant.treeHierarchical;
      if (!tree || typeof tree !== 'object') return;
      const children = Array.isArray((tree as Record<string, unknown>).children)
        ? ((tree as Record<string, unknown>).children as unknown[])
        : [];
      children.forEach((child, childIndex) => {
        if (!child || typeof child !== 'object') return;
        const childRecord = child as Record<string, unknown>;
        appendSubcomponentDimensions(
          out,
          setId,
          variantSignature,
          childRecord,
          `${sourceBase}/treeHierarchical/children/${childIndex}`,
          `${String(rootNode.name)}/${String(childRecord.name ?? childIndex)}`,
        );
      });
    });
  }
}

function appendPaintConditionedDimensions(
  base: BaseJson,
  out: EvidenceObligation[],
): void {
  for (const axis of base.variantAxes) {
    const values: string[] = [];
    const facts: Array<{ option: string; strokePresent: boolean; borderWidth: string }> = [];
    let consistent = true;
    for (const option of axis.options) {
      const variants = base.variants.filter(
        (variant) => variant.variantProperties[axis.name] === option,
      );
      const samples = variants.map((variant) => {
        const strokePresent =
          variant.strokeSemantics?.painted ??
          variant.colorWalk.some(
            (entry) => !entry.path && entry.property === 'stroke' && (entry.opacity ?? 1) > 0,
          );
        const strokeWeight = (
          variant.dimensions.strokeWeight as { display?: unknown; value?: unknown } | undefined
        );
        const display = String(strokeWeight?.display ?? strokeWeight?.value ?? '—');
        return {
          strokePresent,
          borderWidth: strokePresent ? display : 'none',
        };
      });
      if (
        samples.length === 0 ||
        new Set(samples.map((sample) => JSON.stringify(sample))).size !== 1
      ) {
        consistent = false;
        break;
      }
      values.push(samples[0].borderWidth);
      facts.push({ option, ...samples[0] });
    }
    if (!consistent || new Set(values).size <= 1) continue;
    out.push(obligation(
      'structure',
      'paint-conditioned-dimension',
      `${axis.name}|root-borderWidth`,
      `Rendered root border width across "${axis.name}"`,
      'must-emit',
      [
        '/variants/*/strokeSemantics',
        '/variants/*/colorWalk',
        '/variants/*/dimensions/strokeWeight',
      ],
      {
        axis: axis.name,
        options: [...axis.options],
        property: 'borderWidth',
        values,
        samples: facts,
      },
      {
        targetKind: 'structure-row',
        field: 'spec',
        oneOf: ['borderWidth', 'strokeWeight'],
        arrayField: 'values',
        arrayEquals: values,
        allowMerge: false,
      },
    ));
  }
}

export function buildStructureObligations(
  base: BaseJson,
  _defaultVariantIndex: number,
): EvidenceObligation[] {
  const out: EvidenceObligation[] = [];
  for (const variant of base.variants) {
    const variantSignature =
      Object.entries(variant.variantProperties)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([axis, value]) => `${axis}=${value}`)
        .join('|') || variant.name;
    const dimensions = variant.dimensions;
    for (const leaf of flattenMeasurementFamilies(dimensions)) {
      out.push(obligation(
        'structure',
        'root-dimension',
        `${variant.id}|${leaf.path}`,
        `${variantSignature} root ${leaf.path}`,
        'must-emit',
        [`/variants/${base.variants.indexOf(variant)}/dimensions`],
        {
          variantId: variant.id,
          variantName: variant.name,
          variantProperties: variant.variantProperties,
          variantSignature,
          property: leaf.path,
          value: leaf.value,
        },
      ));
    }
  }

  appendPaintConditionedDimensions(base, out);

  for (const [variantIndex, variant] of base.variants.entries()) {
    walkTreeDimensions(
      variant.treeHierarchical,
      `/variants/${variantIndex}/treeHierarchical`,
      out,
    );
  }

  const textNodes: Array<{ node: TreeNode; path: string }> = [];
  const collectText = (node: TreeNode, path: string) => {
    if (node.type === 'TEXT') textNodes.push({ node, path });
    (node.children ?? []).forEach((child, index) => collectText(child, `${path}/children/${index}`));
  };
  for (const [variantIndex, variant] of base.variants.entries()) {
    collectText(variant.treeHierarchical, `/variants/${variantIndex}/treeHierarchical`);
  }
  for (const { node, path } of textNodes) {
    for (const leaf of flattenLeaves(node.typography ?? {})) {
      out.push(obligation(
        'structure',
        'typography-field',
        `${node.id ?? path}|${leaf.path}`,
        `${node.name} typography ${leaf.path}`,
        'must-emit',
        [`${path}/typography/${leaf.path.replaceAll('.', '/')}`],
        {
          nodeId: node.id ?? null,
          nodeName: node.name,
          property: leaf.path,
          value: leaf.value,
          styleId: node.styleId ?? null,
        },
        {
          targetKind: 'structure-row',
          field: 'spec',
          oneOf: leaf.path === 'styleId' ? ['textStyle'] : [leaf.path],
          allowMerge: false,
        },
      ));
    }
  }

  for (const [index, child] of base._childComposition.children.entries()) {
    if (child.classification !== 'constitutive') continue;
    out.push(obligation(
      'structure',
      'constitutive-component',
      `${child.name}|${child.subCompSetId ?? index}`,
      `Constitutive sub-component "${child.name}"`,
      'must-emit',
      [`/_childComposition/children/${index}`],
      { ...child },
    ));
  }

  appendSubcomponentGeometry(base, out);

  const groups = new Map<string, { sourcePaths: string[]; values: Set<string> }>();
  collectVariantPropertyGroups(
    base.subComponentVariantWalks,
    '/subComponentVariantWalks',
    groups,
  );
  for (const [key, group] of groups) {
    const axis = key.slice(key.lastIndexOf('|') + 1);
    out.push(obligation(
      'structure',
      'subcomponent-axis',
      key,
      `Sub-component axis "${axis}"`,
      'must-emit',
      [...new Set(group.sourcePaths)],
      { axis, options: [...group.values].sort() },
      {
        targetKind: 'structure-row',
        field: 'spec',
        oneOf:
          lowerCamel(axis) === 'content'
            ? ['content', 'contentType']
            : lowerCamel(axis) === 'size'
              ? ['size', 'nestedSize', 'iconSize']
              : lowerCamel(axis) === 'theme'
                ? ['theme', 'nestedTheme']
                : [lowerCamel(axis)],
        allowMerge: true,
      },
    ));
  }

  return out;
}

interface ResolvedColorVariant {
  name: string;
  variantProperties: Record<string, string>;
  colorEntries: Array<Record<string, unknown> & { element: string; property: string }>;
}

export function buildColorObligations(
  base: BaseJson,
  variants: ResolvedColorVariant[],
): EvidenceObligation[] {
  const dimensionAxes = new Set(
    [
      ...(((base.crossVariant as { dimensionAxes?: string[] } | null)?.dimensionAxes) ?? []),
      (base.crossVariant as { sizeAxis?: string } | null)?.sizeAxis,
    ].filter((value): value is string => Boolean(value)),
  );
  const groups = new Map<string, ResolvedColorVariant[]>();
  for (const variant of variants) {
    const signature = Object.entries(variant.variantProperties)
      .filter(([axis]) => !dimensionAxes.has(axis))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([axis, value]) => `${axis}=${value}`)
      .join('|') || 'default';
    groups.set(signature, [...(groups.get(signature) ?? []), variant]);
  }

  const paintIdentities = new Map<string, { element: string; elementPath: string; property: string }>();
  for (const variant of variants) {
    for (const entry of variant.colorEntries) {
      const rawPath = typeof entry.path === 'string' ? entry.path : '';
      const elementPath =
        rawPath
          .split('>')
          .slice(1)
          .map((part) => part.trim())
          .filter(Boolean)
          .join(' > ') || '__root__';
      const key = JSON.stringify([elementPath, entry.property]);
      paintIdentities.set(key, {
        element: elementPath === '__root__' ? 'Container' : entry.element,
        elementPath,
        property: entry.property,
      });
    }
  }

  const out: EvidenceObligation[] = [];
  for (const [signature, samples] of groups) {
    for (const [paintKey, identity] of [...paintIdentities].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const { element, elementPath, property } = identity;
      const sourcePaths: string[] = [];
      const presentBySample = samples.map((sample) => {
        const variantIndex = variants.indexOf(sample);
        const entryIndexes = sample.colorEntries
          .map((entry, index) => ({ entry, index }))
          .filter(({ entry }) => {
            const rawPath = typeof entry.path === 'string' ? entry.path : '';
            const candidatePath =
              rawPath
                .split('>')
                .slice(1)
                .map((part) => part.trim())
                .filter(Boolean)
                .join(' > ') || '__root__';
            return candidatePath === elementPath && entry.property === property;
          })
          .map(({ index }) => index);
        if (entryIndexes.length === 0) {
          sourcePaths.push(`/data/variantColorData/${variantIndex}/colorEntries`);
        } else {
          sourcePaths.push(
            ...entryIndexes.map(
              (entryIndex) =>
                `/data/variantColorData/${variantIndex}/colorEntries/${entryIndex}`,
            ),
          );
        }
        return { variantName: sample.name, present: entryIndexes.length > 0 };
      });
      out.push(obligation(
        'color',
        'paint',
        `${signature}|${paintKey}`,
        `${signature}: ${element} ${property}`,
        'must-emit',
        sourcePaths,
        {
          variantSignature: signature,
          element,
          elementPath,
          property,
          present: presentBySample.some((sample) => sample.present),
          presentBySample,
        },
      ));
    }
  }
  return out;
}

export function buildVoiceObligations(
  base: BaseJson,
  _defaultVariantIndex: number,
): EvidenceObligation[] {
  const out: EvidenceObligation[] = [];
  const visualParts = new Map<
    string,
    {
      element: BaseJson['variants'][number]['treeFlat'][number];
      sourcePaths: string[];
      variantIds: string[];
      variantNames: string[];
      variantProperties: Array<Record<string, string>>;
    }
  >();
  for (const [variantIndex, variant] of base.variants.entries()) {
    for (const [elementIndex, element] of variant.treeFlat.entries()) {
      const key = JSON.stringify([
        element.name,
        element.nodeType,
        element.slotIndex ?? null,
      ]);
      const group = visualParts.get(key) ?? {
        element,
        sourcePaths: [],
        variantIds: [],
        variantNames: [],
        variantProperties: [],
      };
      group.sourcePaths.push(`/variants/${variantIndex}/treeFlat/${elementIndex}`);
      group.variantIds.push(variant.id);
      group.variantNames.push(variant.name);
      group.variantProperties.push(variant.variantProperties);
      visualParts.set(key, group);
    }
  }
  for (const [key, group] of visualParts) {
    out.push(obligation(
      'voice',
      'visual-part',
      key,
      `Accessibility disposition for "${group.element.name}"`,
      'account',
      group.sourcePaths,
      {
        ...group.element,
        presentInVariantIds: group.variantIds,
        presentInVariants: group.variantNames,
        variantProperties: group.variantProperties,
      },
    ));
  }
  for (const [index, slot] of base.propertyDefinitions.slots.entries()) {
    out.push(obligation(
      'voice',
      'slot',
      String((slot as { name?: string }).name ?? index),
      `Slot insertion behavior for "${String((slot as { name?: string }).name ?? index)}"`,
      'must-emit',
      [`/propertyDefinitions/slots/${index}`],
      { slot },
    ));
  }
  for (const [index, definition] of base.propertyDefinitions.booleans.entries()) {
    out.push(obligation(
      'voice',
      'boolean',
      definition.rawKey,
      `Boolean accessibility effect for "${definition.name}"`,
      'account',
      [`/propertyDefinitions/booleans/${index}`],
      { ...definition },
    ));
  }
  return out;
}
