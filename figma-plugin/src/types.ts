// Shape of messages exchanged between the sandbox (code.ts) and the UI iframe (ui.ts).

export type ChildOrigin = 'top-level' | 'slot-preferred' | 'slot-default-child';

// Mirrors Figma's `InstanceNode.componentProperties` shape exactly: every property the
// placed instance exposes, keyed by clean property name (the `#…` suffix is stripped),
// with the type-discriminated value as captured from Figma. `VARIANT` entries are one
// per variant axis (e.g. `{ size: { type: 'VARIANT', value: 'small' } }`).
//
// Distinct from the legacy value-only `propertyDefinitions.slots[].defaultChildren[].
// contextualOverrides` field elsewhere in `_base.json`. This shape is typed because the
// renderer needs to know how to format each value (boolean / instance-id / string /
// variant) without cross-referencing remote child component definitions.
export type ComponentPropertySnapshot = Record<
  string,
  { type: 'BOOLEAN' | 'INSTANCE_SWAP' | 'TEXT' | 'VARIANT' | 'SLOT'; value: unknown }
>;

export type PreviewChild = {
  name: string;
  nodeType: string;
  mainComponentName: string | null;
  parentSetName: string | null;
  subCompSetId: string | null;
  topLevelInstanceId: string | null;
  booleanOverrides: Record<string, boolean>;
  // Typed snapshot of every component property on the placed instance. Populated for
  // INSTANCE entries (top-level and slot-default-child); `null` for non-INSTANCE entries
  // (FRAMEs, vectors, slot-preferred entries which describe a referenced component but
  // not a placed instance). Source of truth for the renderer's referenced-component
  // override table.
  componentProperties: ComponentPropertySnapshot | null;
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
  // Cross-variant placement coverage. Top-level component identities are deduplicated
  // across the whole component set; slot-origin entries may omit these fields.
  presentInVariants?: string[];
  defaultVariantPresent?: boolean;
  placementsByVariant?: Record<
    string,
    { variantId: string; nodeIds: string[]; placementIndices: number[] }
  >;
};

export type Preview = {
  componentName: string;
  nodeId: string;
  isComponentSet: boolean;
  defaultVariantName: string;
  variantCount: number;
  children: PreviewChild[];
  // Previously-entered Figma file link persisted on the document (setPluginData), so
  // the UI can prefill the required link field on later runs in the same file.
  savedFileLink: string | null;
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
  // Forwarded from PreviewChild so the `extract` merge path can attach this to
  // slot-origin entries it appends to `_childComposition.children[]` (slot-origin
  // entries don't pass through buildFirstGuess where componentProperties would
  // otherwise be set). `null` when the source entry has no placed instance to
  // snapshot (e.g. slot-preferred entries — they describe a referenced component
  // but no concrete fill).
  componentProperties: ComponentPropertySnapshot | null;
};

export type BaseJsonMeta = {
  schemaVersion: '1';
  extractedAt: string;
  fileKey: string;
  nodeId: string;
  componentSlug: string;
  optionalContext: string | null;
  // Canonical Figma deep link to the extracted component, built from fileKey + the
  // document name + nodeId. Null when no file key could be resolved.
  figmaUrl: string | null;
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
  | {
      type: 'extract';
      classifications: UserClassification[];
      optionalContext: string | null;
      fileLink: string | null;
    }
  | { type: 'close' };
