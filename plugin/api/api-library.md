# Component API Reference

Canonical property names, types, values, and defaults for common UI components. Use this as a lookup when documenting component APIs.

All property names are camelCase and platform-agnostic. Alternative names in parentheses are common synonyms across systems.

---

## Rules

### Naming

| Pattern | Convention | Examples |
|---------|-----------|----------|
| Boolean states | `is` prefix | `isDisabled`, `isSelected`, `isRequired`, `isExpanded` |
| Boolean features | `has` or `show` prefix | `hasIcon`, `showLabel`, `showDivider` |
| Event handlers | `on` prefix + verb | `onPress`, `onChange`, `onClose`, `onSelectionChange` |
| Content slots | Position + `Content` or `Icon` | `leadingIcon`, `trailingContent` |
| Style variants | `variant` or `type` | `variant: "primary"` |
| Size | `size` | `size: "medium"` consistent enum across components |
| Color variants | `colorVariant` | Often mode-controlled via design tokens |

### Universal Booleans

These appear on nearly every interactive component. Do not reinvent them.

| Property | ARIA | Used on |
|----------|------|---------|
| `isDisabled` | `aria-disabled` | All interactive components |
| `isSelected` | `aria-selected` or `aria-pressed` | Toggles, tabs, list items, chips |
| `isRequired` | `aria-required` | Form fields |
| `isInvalid` | `aria-invalid` | Form fields |
| `isReadOnly` | `aria-readonly` | Form fields |
| `isLoading` (isPending) | `aria-busy` | Buttons, fields, containers |
| `isExpanded` | `aria-expanded` | Accordions, dropdowns, menus |

### Transient States (NOT Properties)

Never expose these as API properties. They are handled by platform runtime.

| State | Handled by |
|-------|------------|
| `hover` | CSS `:hover`, platform gesture recognizer |
| `pressed` | CSS `:active`, `GestureDetector`, `Pressable` |
| `focused` | CSS `:focus-visible`, platform focus system |

### Event Handlers (Code-Level Only)

Event handlers are listed in this library for cross-reference but should **NOT** be included in API spec output. They are code-level implementation details not visible in Figma.

| Handler | Used on |
|---------|---------|
| `onPress` (onClick) | Buttons, list items, interactive elements |
| `onChange` | Form fields, switches, checkboxes |
| `onSelectionChange` | Tabs, select, list |
| `onClose` (onDismiss) | Dialogs, snackbars, drawers |
| `onExpandedChange` | Accordions, trees |

### Array Item Identity

When items are in an array, the array index implies order and identity. A separate `key` property is generally unnecessary in design specs — the `label` serves as a sufficient identifier. Only include `key` if the component requires stable identifiers that differ from labels (e.g., localized labels with stable keys for state management).

### Common Array Properties

Properties that are typically arrays. Figma models these as numbered slots (`tab1`-`tab8`) or repeated instances. Collapse into a single array property.

| Property | Item shape | Found on |
|----------|-----------|----------|
| `items` (children, options) | Component-specific item type | Tabs, List, Select, Menu, Breadcrumb, Navigation |
| `actions` (buttons) | Button-like | Dialog footer, Snackbar, Card, Banner |
| `expandedKeys` (value) | string keys | Accordion, Tree |
| `selectedKeys` | string keys | List, Table, Select (multi-select) |
| `columns` | Column definition | Table, Data Grid |
| `rows` (data) | Row object | Table, Data Grid |
| `breadcrumbs` (items) | Link-like | Breadcrumb |
| `segments` (items) | Segment item | Segmented Control |

When Figma uses numbered slots with the same sub-component type, always collapse to a single array property with `minItems`/`maxItems` in notes.

### Figma Boolean + Sub-Component Variant → Single Enum

Figma often models content slots as a **boolean visibility toggle** on a nested sub-component that has its own **`Type` variant** axis. For example:
- Boolean: `Leading artwork: true/false` (shows/hides the sub-component)
- Sub-component variant: `Type: Icon (active), Icon (inactive), Vector, Custom`

Do NOT mirror this as `hasLeadingArtwork: boolean` + a separate type property. Instead, merge into a **single enum** with `none`:
- `leadingArtwork: none, icon, vector, custom`
- Boolean `false` → `none`
- Boolean `true` → the selected type value

---

## Button

ARIA: `button`

| Property | Type | Values | Default |
|----------|------|--------|---------|
| `variant` | enum | `primary, secondary, tertiary, outline, ghost, danger` | `primary` |
| `size` | enum | `large, medium, small, xsmall` | `medium` |
| `isDisabled` | boolean | `true, false` | `false` |
| `isLoading` (isPending) | boolean | `true, false` | `false` |
| `isSelected` | boolean | `true, false` | `false` |
| `label` (children) | string / slot | | |
| `leadingIcon` (startIcon) | slot / icon | | |
| `trailingIcon` (endIcon) | slot / icon | | |
| `onPress` (onClick) | function | | |
| `type` | enum | `button, submit, reset` | `button` |
| `fullWidth` (widthType) | boolean / enum | `true, false` or `hug, fill` | `false` / `hug` |

---

## Text Field

ARIA: `textbox` (native `<input>`)

| Property | Type | Values | Default |
|----------|------|--------|---------|
| `label` | string | | |
| `value` | string | | |
| `defaultValue` | string | | |
| `placeholder` | string | | |
| `isDisabled` | boolean | `true, false` | `false` |
| `isReadOnly` (readOnly) | boolean | `true, false` | `false` |
| `isRequired` | boolean | `true, false` | `false` |
| `isInvalid` (validationState) | boolean | `true, false` | `false` |
| `errorMessage` | string / slot | | |
| `description` (helperText, hintText) | string / slot | | |
| `onChange` | function | | |
| `inputType` (type) | enum | `text, password, email, number, tel, url, search` | `text` |
| `maxLength` | number | | |
| `leadingIcon` (prefix) | slot / icon | | |
| `trailingIcon` (suffix) | slot / icon | | |
| `autoFocus` | boolean | `true, false` | `false` |

Sub-components (fixed): Label, Input, Hint/Helper text.

---

## Checkbox

ARIA: `checkbox`

| Property | Type | Values | Default |
|----------|------|--------|---------|
| `isSelected` (checked) | boolean | `true, false` | `false` |
| `defaultSelected` (defaultChecked) | boolean | `true, false` | `false` |
| `isIndeterminate` | boolean | `true, false` | `false` |
| `isDisabled` | boolean | `true, false` | `false` |
| `isInvalid` | boolean | `true, false` | `false` |
| `label` (children) | string / slot | | |
| `onChange` | function | | |
| `value` | string | | |
| `name` | string | | |

Label merges into the checkbox's accessible name; it is not a separate component.

---

## Switch

ARIA: `switch`

| Property | Type | Values | Default |
|----------|------|--------|---------|
| `isSelected` (checked, isOn) | boolean | `true, false` | `false` |
| `defaultSelected` | boolean | `true, false` | `false` |
| `isDisabled` | boolean | `true, false` | `false` |
| `label` (children) | string / slot | | |
| `onChange` | function | | |

Switch is for immediate effect. Checkbox is for deferred selection.

---

## Radio Group

ARIA: `radiogroup` (container), `radio` (item)

**Container:**

| Property | Type | Values | Default |
|----------|------|--------|---------|
| `value` | string | | |
| `defaultValue` | string | | |
| `onChange` | function | | |
| `label` | string | | |
| `orientation` | enum | `vertical, horizontal` | `vertical` |
| `isDisabled` | boolean | `true, false` | `false` |
| `isRequired` | boolean | `true, false` | `false` |

**Item:**

| Property | Type | Values | Default |
|----------|------|--------|---------|
| `value` | string | | |
| `isDisabled` | boolean | `true, false` | `false` |
| `label` (children) | string / slot | | |

---

## Tabs

ARIA: `tablist` (container), `tab` (item), `tabpanel` (content)

**Container:**

| Property | Type | Values | Default |
|----------|------|--------|---------|
| `size` | enum | `medium, small` | `medium` |
| `widthDistribution` | enum | `content, equal` | `content` |
| `orientation` | enum | `horizontal, vertical` | `horizontal` |
| `isDisabled` | boolean | `true, false` | `false` |
| `items` (children) | array / slot | | |

**Tab Item:**

| Property | Type | Values | Default |
|----------|------|--------|---------|
| `label` (children) | string / slot | | |
| `isSelected` | boolean | `true, false` | `false` |
| `isDisabled` | boolean | `true, false` | `false` |
| `leadingArtwork` | enum | `none, icon, vector, custom` | `icon` |
| `badge` | slot | | |

Arrow keys navigate between tabs (roving tabindex). Only the selected tab is in the Tab key order. Figma models items as numbered slots (`tab1` to `tab8`); collapse to `items: TabItem[]`. Array index provides identity — `key` is not needed.

---

## List Item

ARIA: `listitem` (within `list`), or `option` (within `listbox`)

| Property | Type | Values | Default |
|----------|------|--------|---------|
| `primaryLabel` (headline, title) | string | | |
| `secondaryLabel` (supportingText, subtitle) | string | | |
| `leadingContent` (leadingVisual) | slot / enum | `none, icon, avatar, image, checkbox, radio` | `none` |
| `trailingContent` (trailingVisual) | slot / enum | `none, chevron, icon, button, switch, text` | `none` |
| `onPress` (onClick) | function | | |
| `isDisabled` | boolean | `true, false` | `false` |
| `isSelected` | boolean | `true, false` | `false` |
| `density` | enum | `default, compact, spacious` | `default` |

Density is often controlled via variable mode at container level.

---

## Dialog

ARIA: `dialog` (or `alertdialog`)

| Property | Type | Values | Default |
|----------|------|--------|---------|
| `isOpen` (open) | boolean | `true, false` | `false` |
| `onClose` (onDismiss, onOpenChange) | function | | |
| `title` | string / slot | | |
| `size` | enum | `small, medium, large, fullscreen` | `medium` |
| `isDismissable` | boolean | `true, false` | `true` |

Sub-components (fixed): Header, Body, Footer/Actions.

---

## Tooltip

ARIA: `tooltip`

| Property | Type | Values | Default |
|----------|------|--------|---------|
| `content` (label) | string / slot | | |
| `placement` (position) | enum | `top, bottom, left, right, start, end` | `top` |
| `delay` | number | | `300` |
| `isOpen` | boolean | `true, false` | `false` |
| `trigger` (children) | slot | | |

Tooltip content is a live region, not a focus stop.

---

## Chip (Tag)

ARIA: `button` (action), `checkbox` (filter), `option` (within listbox)

| Property | Type | Values | Default |
|----------|------|--------|---------|
| `label` (children) | string / slot | | |
| `variant` (type) | enum | `assist, filter, input, suggestion` | |
| `isSelected` | boolean | `true, false` | `false` |
| `isDisabled` | boolean | `true, false` | `false` |
| `onPress` (onClick) | function | | |
| `onClose` (onDismiss, onRemove) | function | | |
| `leadingIcon` (avatar) | slot / icon | | |
| `colorVariant` | enum | `default, success, warning, error, info` | `default` |

Color variants are often mode-controlled via variable collections.

---

## Slider

ARIA: `slider`

| Property | Type | Values | Default |
|----------|------|--------|---------|
| `value` | number | | |
| `defaultValue` | number | | |
| `minValue` (min) | number | | `0` |
| `maxValue` (max) | number | | `100` |
| `step` | number | | `1` |
| `isDisabled` | boolean | `true, false` | `false` |
| `onChange` | function | | |
| `onChangeEnd` | function | | |
| `label` | string | | |
| `showValue` (hasValueLabel) | boolean | `true, false` | `false` |

Range variant uses `startValue` + `endValue` or `value: [number, number]`.

---

## Accordion

ARIA: Each trigger is a `button` with `aria-expanded`.

**Container:**

| Property | Type | Values | Default |
|----------|------|--------|---------|
| `expandedKeys` (value) | array | | |
| `defaultExpandedKeys` | array | | |
| `onExpandedChange` | function | | |
| `allowsMultipleExpanded` | boolean | `true, false` | `false` |
| `isDisabled` | boolean | `true, false` | `false` |

**Item:**

| Property | Type | Values | Default |
|----------|------|--------|---------|
| `key` (value) | string | | |
| `title` (trigger, header) | string / slot | | |
| `isDisabled` | boolean | `true, false` | `false` |
| `children` (content) | slot | | |

---

## Badge

ARIA: `status` (or none if decorative)

| Property | Type | Values | Default |
|----------|------|--------|---------|
| `content` (label, count) | string / number | | |
| `variant` (type) | enum | `default, dot, count` | `default` |
| `colorVariant` | enum | `neutral, positive, negative, info, warning` | `neutral` |
| `maxCount` | number | | `99` |
| `isHidden` | boolean | `true, false` | `false` |

---

## Avatar

ARIA: `img`

| Property | Type | Values | Default |
|----------|------|--------|---------|
| `src` (imageSource) | string | | |
| `alt` (label) | string | | |
| `size` | enum | `xsmall, small, medium, large, xlarge` | `medium` |
| `fallback` (initials) | string / slot | | |
| `shape` | enum | `circle, square, rounded` | `circle` |
| `badge` (status) | slot | | |

---

## Progress Indicator

ARIA: `progressbar`

| Property | Type | Values | Default |
|----------|------|--------|---------|
| `value` | number | | |
| `maxValue` | number | | `100` |
| `variant` (type) | enum | `linear, circular` | `linear` |
| `size` | enum | `small, medium, large` | `medium` |
| `label` | string | | |
| `showValue` (hasValueLabel) | boolean | `true, false` | `false` |
| `isIndeterminate` | boolean | `true, false` | `false` |

---

## Snackbar (Toast)

ARIA: `status` or `alert` (via `aria-live`)

| Property | Type | Values | Default |
|----------|------|--------|---------|
| `message` (children) | string / slot | | |
| `action` (actionLabel) | string / slot | | |
| `onAction` | function | | |
| `duration` (autoHideDuration) | enum / number | `short, long, indefinite` | `short` |
| `onClose` (onDismiss) | function | | |
| `variant` (severity) | enum | `default, info, success, warning, error` | `default` |
