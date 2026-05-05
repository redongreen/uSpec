// Shape of messages exchanged between the sandbox (code.ts) and the UI iframe (ui.ts).

export type ChildOrigin = 'top-level' | 'slot-preferred' | 'slot-default-child';

export type PreviewChild = {
  name: string;
  nodeType: string;
  mainComponentName: string | null;
  parentSetName: string | null;
  subCompSetId: string | null;
  topLevelInstanceId: string | null;
  booleanOverrides: Record<string, boolean>;
  subCompVariantAxes: Record<string, string[]>;
  classification: 'constitutive' | 'referenced' | 'decorative';
  classificationReason: string;
  classificationEvidence: string[];
  // Where this child comes from. Top-level children are direct kids of the variant.
  // slot-preferred children are components the designer declared as valid fills for a SLOT
  // (from `componentPropertyDefinitions[slotKey].preferredValues`). slot-default-child
  // children are instances actually placed inside a SLOT node in the default variant.
  origin: ChildOrigin;
  // Populated when origin !== 'top-level'. Identifies which slot the entry belongs to so
  // the UI can group entries and downstream consumers can trace the classification back.
  slotName: string | null;
  // Sub-component multiplicity. When the parent contains N placements of the same main
  // component (e.g. six "selection button" placements inside a button group), the
  // classification UI surfaces ONE row for the sub-component and records the multiplicity
  // here so downstream consumers can distinguish "homogeneous array of N" from "single
  // placement". 1/[<self-index>]/false for solo placements; N/[i, j, ...]/bool for
  // dedup'd placements. Always 1/[]/false for wrapper FRAME entries (`wrapper:N`) and
  // for slot-origin entries (which already dedup separately via `seenMainIds`).
  placementCount: number;
  placementIndices: number[];
  placementsVary: boolean;
};

export type Preview = {
  componentName: string;
  nodeId: string;
  isComponentSet: boolean;
  defaultVariantName: string;
  variantCount: number;
  children: PreviewChild[];
};

export type UserClassification = {
  topLevelInstanceId: string | null;
  name: string;
  classification: 'constitutive' | 'referenced';
  origin: ChildOrigin;
  slotName: string | null;
  mainComponentName: string | null;
  parentSetName: string | null;
  subCompSetId: string | null;
  nodeType: string;
};

export type BaseJsonMeta = {
  schemaVersion: '1';
  extractedAt: string;
  fileKey: string;
  nodeId: string;
  componentSlug: string;
  optionalContext: string | null;
  extractionSource: 'plugin';
  pluginVersion: string;
};

// Sandbox → UI
export type MsgFromSandbox =
  | { type: 'ready'; preview: Preview }
  | { type: 'no-selection' }
  | { type: 'invalid-selection'; reason: string }
  | { type: 'progress'; phase: string; detail?: string }
  | { type: 'extract-done'; baseJson: unknown; filename: string; warnings: string[] }
  | { type: 'extract-error'; message: string };

// UI → Sandbox
export type MsgFromUi =
  | { type: 'refresh-preview' }
  | { type: 'extract'; classifications: UserClassification[]; optionalContext: string | null }
  | { type: 'close' };
