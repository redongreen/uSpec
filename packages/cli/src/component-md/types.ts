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
    strokeSemantics?: {
      configured: boolean;
      painted: boolean;
      configuredWeight: unknown;
      visiblePaintCount: number;
    };
    revealedTree?: TreeNode | null;
    revealedColorWalk?: ColorWalkEntry[] | null;
    revealedTreeRepresentative?: string;
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
      topLevelInstanceId?: string | null;
      origin?: 'top-level' | 'slot-preferred' | 'slot-default-child';
      slotName?: string | null;
      componentProperties?: Record<string, unknown> | null;
      booleanOverrides?: Record<string, boolean>;
      subCompVariantAxes?: Record<string, string[]>;
      placementCount?: number;
      placementIndices?: number[];
      placementsVary?: boolean;
      presentInVariants?: string[];
      defaultVariantPresent?: boolean;
      placementsByVariant?: Record<
        string,
        { variantId: string; nodeIds: string[]; placementIndices: number[] }
      >;
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
    domain: 'api' | 'structure' | 'color' | 'voice' | 'renderer';
    baseSourceHash: string;
    defaultVariantId: string;
    defaultVariantName: string;
  };
  data: T;
}

export type EvidenceDomain = 'api' | 'structure' | 'color' | 'voice';

export interface EvidenceRepresentation {
  targetKind: 'api-property' | 'structure-row' | 'color-element' | 'voice-record';
  pathPrefix?: string;
  field?: string;
  equals?: string;
  oneOf?: string[];
  pattern?: string;
  arrayField?: string;
  arrayEquals?: Array<string | number | boolean>;
  allowMerge?: boolean;
}

export interface EvidenceObligation {
  id: string;
  domain: EvidenceDomain;
  kind: string;
  label: string;
  policy: 'must-emit' | 'account';
  sourcePaths: string[];
  facts: Record<string, unknown>;
  representation?: EvidenceRepresentation;
}

export interface EvidenceDisposition {
  obligationId: string;
  disposition: 'emitted' | 'merged' | 'omitted' | 'unresolved';
  targets: string[];
  reason: string;
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
    variantTreesComplete?: boolean;
    subComponentVariantWalksPresent: boolean;
    warnings: unknown[];
  };
  source: {
    fileKey: string;
    nodeId: string;
    figmaUrl: string;
    extractionSource: string | null;
  };
  metrics: {
    prepare: {
      baseBytes: number;
      evidenceBytes: Record<'api' | 'structure' | 'color' | 'voice' | 'renderer', number>;
      obligationCounts: Record<'api' | 'structure' | 'color' | 'voice', number>;
      obligationKindCounts: Record<
        'api' | 'structure' | 'color' | 'voice',
        Record<string, number>
      >;
      totalEvidenceBytes: number;
      estimatedInputTokens: number;
    };
    render?: {
      renderedAt: string;
      specialistCacheBytes: number;
      contractBytes?: number;
      renderPlanBytes: number;
      outputBytes: number;
      estimatedInputTokens: number;
      durationMs: number;
    };
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
    contractPath?: string;
    evidence: {
      api: string;
      structure: string;
      color: string;
      voice: string;
      renderer: string;
    };
  };
}

export interface RenderPlan {
  _meta: {
    schemaVersion: '1';
    componentSlug: string;
    baseSourceHash: string;
    generatedAt: string;
  };
  data: {
    overviewParagraph: string;
    confidence?: Partial<Record<'api' | 'structure' | 'color' | 'voice', string>>;
  };
}

export interface CanonicalComponentContract {
  $schema: 'https://uspec.design/schemas/component-contract-1.0.json';
  schemaVersion: '1.0';
  generatedAt: string;
  component: {
    slug: string;
    name: string;
  };
  source: {
    fileKey: string;
    nodeId: string;
    figmaUrl: string;
    extractionSource: string | null;
    baseSourceHash: string;
  };
  summary: {
    overview: string;
    confidence: Record<'api' | 'structure' | 'color' | 'voice', string>;
  };
  variants: {
    axes: unknown[];
    default: unknown;
  };
  anatomy: {
    defaultTree: unknown;
    composition: unknown;
    subcomponents: unknown;
  };
  api: Record<string, any>;
  structure: Record<string, any>;
  color: Record<string, any>;
  accessibility: Record<string, any>;
  dictionary: Record<string, any>;
  reconciliations: Record<string, any>;
  sourceModel: Record<string, any>;
  provenance: {
    preparedAt: string;
    obligationCoverage: Record<
      EvidenceDomain,
      {
        total: number;
        emitted: number;
        merged: number;
        omitted: number;
        unresolved: number;
      }
    >;
  };
}
