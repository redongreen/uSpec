# ARIA Properties Reference

## Roles

### Landmark Roles
| Role | Use When |
|------|----------|
| `banner` | Page header |
| `navigation` | Navigation links |
| `main` | Primary content |
| `complementary` | Sidebar content |
| `contentinfo` | Page footer |
| `search` | Search functionality |
| `form` | Form container |
| `region` | Named section (requires aria-label) |

### Widget Roles
| Role | Use When |
|------|----------|
| `button` | Triggers action |
| `link` | Navigates to location |
| `checkbox` | On/off selection |
| `radio` | One-of-many selection |
| `switch` | On/off toggle for settings |
| `textbox` | Text input |
| `searchbox` | Search input |
| `combobox` | Input with dropdown |
| `listbox` | Selectable options list |
| `option` | Item in listbox |
| `menu` | Actions list |
| `menuitem` | Item in menu |
| `menuitemcheckbox` | Checkable menu item |
| `menuitemradio` | Radio menu item |
| `tab` | Tab control |
| `tablist` | Tab container |
| `tabpanel` | Tab content |
| `slider` | Range selection |
| `spinbutton` | Numeric input with arrows |
| `progressbar` | Progress indicator |
| `meter` | Scalar measurement |
| `scrollbar` | Scroll indicator |
| `separator` | Content divider |
| `toolbar` | Control group |
| `tooltip` | Popup description |
| `dialog` | Dialog window |
| `alertdialog` | Urgent dialog |
| `alert` | Important message |
| `status` | Status update |
| `log` | Sequential content |
| `timer` | Time display |

### Structure Roles
| Role | Use When |
|------|----------|
| `grid` | Interactive data grid |
| `gridcell` | Cell in grid |
| `row` | Row in grid/table |
| `rowgroup` | Row group (thead/tbody/tfoot) |
| `columnheader` | Column header |
| `rowheader` | Row header |
| `table` | Data table |
| `cell` | Cell in table |
| `treegrid` | Expandable grid |
| `tree` | Hierarchical list |
| `treeitem` | Item in tree |
| `list` | List container |
| `listitem` | Item in list |
| `figure` | Self-contained content |
| `img` | Image |
| `article` | Independent content |
| `feed` | Article stream |
| `group` | Related elements |
| `presentation` / `none` | Remove semantics |

---

## States & Properties

### Naming
| Attribute | Use When |
|-----------|----------|
| `aria-label` | No visible label exists |
| `aria-labelledby` | Label is elsewhere (ID ref) |
| `aria-describedby` | Additional description exists (ID ref) |
| `aria-description` | Inline description |
| `aria-roledescription` | Custom role name |

### Widget States
| Attribute | Values | Use When |
|-----------|--------|----------|
| `aria-checked` | `true` / `false` / `mixed` | checkbox, radio, switch |
| `aria-selected` | `true` / `false` | option, tab, gridcell, row |
| `aria-pressed` | `true` / `false` / `mixed` | Toggle button |
| `aria-expanded` | `true` / `false` | Expandable content |
| `aria-disabled` | `true` / `false` | Not interactive |
| `aria-hidden` | `true` / `false` | Hidden from AT |
| `aria-invalid` | `true` / `false` / `grammar` / `spelling` | Validation error |
| `aria-readonly` | `true` / `false` | Not modifiable |
| `aria-required` | `true` / `false` | Required field |
| `aria-busy` | `true` / `false` | Loading |
| `aria-current` | `page` / `step` / `location` / `date` / `time` / `true` | Current item |
| `aria-haspopup` | `menu` / `listbox` / `tree` / `grid` / `dialog` / `true` | Has popup |

### Values & Ranges
| Attribute | Use When |
|-----------|----------|
| `aria-valuenow` | Current value |
| `aria-valuemin` | Minimum value |
| `aria-valuemax` | Maximum value |
| `aria-valuetext` | Human-readable value |

### Relationships
| Attribute | Use When |
|-----------|----------|
| `aria-controls` | Controls another element (ID ref) |
| `aria-owns` | Owns separate elements (ID ref) |
| `aria-activedescendant` | Focused child in composite (ID ref) |
| `aria-details` | Extended description (ID ref) |
| `aria-errormessage` | Error message element (ID ref) |
| `aria-flowto` | Override reading order (ID ref) |

### Position
| Attribute | Use When |
|-----------|----------|
| `aria-posinset` | Position in set (1-based) |
| `aria-setsize` | Total in set |
| `aria-level` | Hierarchy level |
| `aria-colcount` | Total columns |
| `aria-colindex` | Column position |
| `aria-colspan` | Columns spanned |
| `aria-rowcount` | Total rows |
| `aria-rowindex` | Row position |
| `aria-rowspan` | Rows spanned |

### Live Regions
| Attribute | Values | Use When |
|-----------|--------|----------|
| `aria-live` | `off` / `polite` / `assertive` | Dynamic content |
| `aria-atomic` | `true` / `false` | Announce all vs changes |
| `aria-relevant` | `additions` / `removals` / `text` / `all` | What to announce |

### Other
| Attribute | Use When |
|-----------|----------|
| `aria-keyshortcuts` | Keyboard shortcut exists |
| `aria-modal` | Modal dialog |
| `aria-multiline` | Multi-line textbox |
| `aria-multiselectable` | Multiple selection allowed |
| `aria-orientation` | horizontal / vertical |
| `aria-sort` | Column sort state |
| `aria-autocomplete` | Autocomplete behavior |
| `tabindex` | Keyboard focusability (0 = focusable, -1 = programmatic only) |
| `inert` | Disables element and all descendants (HTML attribute) |

### Braille (ARIA 1.3)
| Attribute | Use When |
|-----------|----------|
| `aria-braillelabel` | Braille-specific label |
| `aria-brailleroledescription` | Braille-specific role description |

### Drag & Drop (Deprecated but still used)
| Attribute | Use When |
|-----------|----------|
| `aria-grabbed` | Element is grabbed for drag |
| `aria-dropeffect` | Drop effect (copy, move, link, execute, popup) |

---

## Keyboard Patterns

| Component | Keys |
|-----------|------|
| Button | Enter, Space |
| Link | Enter |
| Checkbox | Space |
| Radio group | Arrow keys |
| Tabs | Arrow keys |
| Menu | Arrow keys, Enter, Escape |
| Dialog | Escape, trap focus |
| Slider | Arrow keys, Home/End |
| Combobox | Arrow keys, Escape, Enter |
| Tree | Arrow keys (up/down), Left/Right (collapse/expand) |
| Grid | Arrow keys |

---

## Accessible Name Priority

1. `aria-labelledby`
2. `aria-label`
3. Native label (`<label>`, `alt`, `title`)
4. Text content

---

## Rules

- Use native HTML when possible (`<button>` not `<div role="button">`)
- Don't change native semantics unless necessary
- All interactive elements must be keyboard accessible
- All interactive elements must have accessible names
