/** Minimal shapes for plugin-produced _base.json consumed by prepare. */

export interface BaseMeta {
  schemaVersion: string;
  extractedAt: string;
  fileKey: string;
  nodeId: string;
  componentSlug: string;
  optionalContext?: string | null;
  figmaUrl?: string | null;
  extractionSource?: string;
  pluginVersion?: string;
}

export interface BaseJson {
  _meta: BaseMeta;
  component: {
    componentName: string;
    compSetNodeId: string;
    isComponentSet: boolean;
  };
  variantAxes: Array<{ name: string; options: string[]; defaultValue: string }>;
  defaultVariant: {
    id: string;
    name: string;
    variantProperties: Record<string, string>;
  };
  propertyDefinitions: {
    rawDefs: Record<string, unknown>;
    booleans: Array<{
      name: string;
      rawKey: string;
      defaultValue: boolean;
      associatedLayerId?: string | null;
      associatedLayerName?: string | null;
    }>;
    instanceSwaps: unknown[];
    slots: unknown[];
  };
  variables: {
    localCollections: Array<{
      id: string;
      name: string;
      modes: Array<{ modeId: string; name: string }>;
      variableIds?: string[];
    }>;
    resolvedVariables: Record<
      string,
      {
        name: string;
        codeSyntax?: string | null;
        collectionId?: string;
        valuesByMode?: Record<string, unknown>;
      }
    >;
  };
  styles: {
    resolvedStyles: Record<string, { name: string; type?: string; description?: string | null }>;
  };
  variants: Array<{
    id: string;
    name: string;
    variantProperties: Record<string, string>;
    dimensions: Record<string, unknown>;
    treeHierarchical: TreeNode;
    treeFlat: Array<{
      index: number;
      name: string;
      nodeType: string;
      visible: boolean;
      bbox?: unknown;
      slotIndex?: number | null;
    }>;
    colorWalk: ColorWalkEntry[];
    layoutTree: Record<string, unknown>;
    revealedTree?: TreeNode | null;
    revealedColorWalk?: ColorWalkEntry[] | null;
    _selfCheck?: { missingChildren?: unknown[] };
  }>;
  crossVariant?: Record<string, unknown> | null;
  slotHostGeometry?: Record<string, unknown> | null;
  ownershipHints: Array<Record<string, unknown>>;
  subComponentVariantWalks?: Record<string, unknown>;
  _childComposition: {
    children: Array<{
      name: string;
      nodeType: string;
      classification: 'constitutive' | 'referenced' | 'decorative' | null;
      classificationEvidence?: string[];
      subCompSetId?: string | null;
      parentSetName?: string | null;
      mainComponentName?: string | null;
    }>;
    ambiguousChildren: unknown[];
    guessConfidence?: string;
  };
  _extractionNotes: {
    warnings?: unknown[];
    mutationsPerformed?: unknown[];
  };
}

export interface TreeNode {
  id?: string;
  name: string;
  type: string;
  visible?: boolean;
  mainComponentName?: string | null;
  parentSetName?: string | null;
  subCompSetId?: string | null;
  dimensions?: Record<string, unknown>;
  typography?: Record<string, unknown>;
  styleId?: string | null;
  characters?: string;
  children?: TreeNode[];
  [key: string]: unknown;
}

export interface ColorWalkEntry {
  element: string;
  path?: string;
  property: string;
  hex?: string | null;
  styleId?: string | null;
  boundVariableId?: string | null;
  opacity?: number | null;
  subComponentName?: string | null;
  layers?: unknown[];
  stops?: unknown[];
  angleDegrees?: number | null;
}

export interface EvidenceEnvelope<T> {
  _meta: {
    schemaVersion: '1';
    preparedAt: string;
    componentSlug: string;
    domain: 'api' | 'structure' | 'color' | 'voice';
    baseSourceHash: string;
    defaultVariantId: string;
    defaultVariantName: string;
  };
  data: T;
}

export interface PrepareManifest {
  _meta: {
    schemaVersion: '1';
    preparedAt: string;
    componentSlug: string;
    baseJsonPath: string;
    baseBytes: number;
    baseSourceHash: string;
    pluginVersion: string | null;
    variantsWalked: number;
    validation: { ok: boolean; errors: unknown[] };
  };
  readiness: {
    layoutTreeHasNodeIds: boolean;
    childCompositionUserSelected: boolean;
    revealedTreeHasChildren: boolean;
    subComponentVariantWalksPresent: boolean;
    warnings: unknown[];
  };
  summaries: {
    componentName: string;
    defaultVariant: BaseJson['defaultVariant'];
    variantAxes: Record<string, string[]>;
    composition: {
      constitutive: number;
      referenced: number;
      decorative: number;
      ambiguous: number;
    };
    crossVariant: {
      sizeAxis: string | null;
      stateAxis: string | null;
      dimensionAxes: string[];
    };
  };
  paths: {
    cachePath: string;
    stagedBasePath: string;
    outputPath: string;
    evidence: {
      api: string;
      structure: string;
      color: string;
      voice: string;
    };
  };
}
