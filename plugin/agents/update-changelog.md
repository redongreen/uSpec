---
name: update-changelog
description: Add new entries directly to an existing changelog in Figma using MCP tools. No JSON copy-paste needed. Use when the user mentions "update changelog", "add to changelog", "changelog entry", "log this change", or wants to add a new entry to an existing changelog.
---

# Update Changelog (Direct Figma)

Add new changelog entries directly into an existing Figma changelog frame using the Figma Console MCP tools. No JSON output or copy-paste required — the agent writes directly to Figma.

## Prerequisites

- The Figma Desktop Bridge plugin must be running (required for `figma_execute`)
- The user must provide a link to or select the existing changelog frame in Figma

## HARD REQUIREMENT: Figma Access

This skill requires working MCP/Figma access. If any of the following fail, **STOP IMMEDIATELY** and tell the user:

> "I cannot access Figma. Please ensure the Figma Desktop Bridge plugin is running and try again."

**Do NOT:**
- Invent or guess what the changelog looks like
- Generate JSON as a fallback
- Proceed without successfully connecting to the changelog frame

**Failure conditions that trigger hard stop:**
- `figma_get_status` shows no Desktop Bridge connection
- `figma_navigate` fails or returns error
- `figma_execute` fails or returns error
- Changelog frame not found or has invalid structure
- Cannot verify the changelog template structure

**No fallback mode.** Unlike create-changelog, update-changelog has no JSON fallback. If Figma access fails, the operation cannot proceed.

## Inputs Expected

- **Change description**: What changed (token updates, new variants, renamed properties, etc.)
- **Figma link or selection**: Link to the existing changelog frame, or user confirms it's selected
- **Author** (optional): Who made the change. If not provided, use `{author}` as placeholder. Do NOT ask.
- **Date** (optional): When the change was made. If not provided, use today's date in `MM.DD.YYYY` format.

## Reference

Before generating any content, always check the latest available MCP tools at:
https://docs.figma-console-mcp.southleft.com/tools

## Workflow

Copy this checklist and update as you progress:

```
Task Progress:
- [ ] Step 1: Read instruction file for writing style
- [ ] Step 2: Verify MCP connection and Desktop Bridge
- [ ] Step 3: Gather context from user (what changed, author, date)
- [ ] Step 4: Navigate to changelog frame and verify structure
- [ ] Step 5: Compose entry content (date, author, titles, descriptions)
- [ ] Step 6: Execute figma_execute to clone and fill entry
- [ ] Step 7: Screenshot to verify result
- [ ] Step 8: Report success to user
```

### Step 1: Read Instructions

Read [agent-changelog-instruction.md](../../changelog/agent-changelog-instruction.md) for writing style guidance (titles, descriptions, formatting).

### Step 2: Verify MCP Connection

1. `figma_get_status` — Confirm Desktop Bridge plugin is connected
2. If WebSocket/Desktop Bridge is not available, **STOP** and tell the user: "I cannot access Figma. Please ensure the Figma Desktop Bridge plugin is running and try again."

### Step 3: Gather Context

**From user:**
- Description of what changed
- Any specific token names, values, before/after details
- Author name (use `{author}` if not provided — do NOT ask)
- Date (use today if not provided)

**From MCP tools (optional, for richer context):**
If the user provides a Figma link to what changed (not the changelog itself):
1. `figma_navigate` — Open the component URL
2. `figma_take_screenshot` — Capture it visually
3. `figma_get_variables` / `figma_get_token_values` — Get token details

### Step 4: Navigate to Changelog and Verify

1. If user provides a Figma link to the changelog: `figma_navigate` to it
2. If user says it's selected: `figma_get_selection` to get the node ID
3. Use `figma_execute` to verify the frame has the expected structure:

```javascript
const node = await figma.getNodeByIdAsync('NODE_ID');
if (!node) return { error: 'Node not found' };

// Walk down to find the entries container and template
const content = node.children.find(c => c.name === 'Content');
if (!content) return { error: 'Not a changelog frame — no Content found' };

const container = content.children.find(c => c.type === 'FRAME');
if (!container) return { error: 'No entries container found' };

const templateEntry = container.children.find(c => c.name === '#new-date-entry');
if (!templateEntry) return { error: 'No #new-date-entry template found' };

return {
  valid: true,
  containerId: container.id,
  templateEntryId: templateEntry.id,
  existingEntries: container.children.length
};
```

### Step 5: Compose Entry Content

**You are the writer, not a transcriber.** Do not copy the user's input verbatim. Rewrite everything to be clean, consistent, and professional.

Following the writing style from the instruction file:
- **Date**: `MM.DD.YYYY` format
- **Author**: as provided, or `{author}` if not provided
- **Title(s)**: Rewrite to be short, descriptive (3-8 words), fix grammar, use sentence case
- **Description(s)**: Rewrite for clarity, use `- ` bullets for each point, `\n` for line breaks, designer perspective, use `→` for value changes, standardize terminology

If multiple changes on the same date, they become multiple `#changes` blocks within one `#new-date-entry`.

### Step 6: Execute — Clone and Fill

Use `figma_execute` to clone the first existing entry as a template, insert the clone at position 0 (newest first), and fill all text fields.

The code should:
1. Get the entries container and first `#new-date-entry` (to clone from)
2. Clone the date entry
3. Insert it at position 0 in the container
4. Load fonts from existing text nodes
5. Set text on `#date`, `#author`
6. Handle `#changes` blocks:
   - If single change: find existing `#changes` in the clone and fill it
   - If multiple changes: clone the `#changes` frame for each additional change, then fill all
7. Return the new entry's node ID

Example `figma_execute` for a single change:

```javascript
const container = await figma.getNodeByIdAsync('CONTAINER_ID');
const sourceEntry = container.children.find(c => c.name === '#new-date-entry');

// Clone the entry
const newEntry = sourceEntry.clone();
container.insertChild(0, newEntry);

// Load fonts from all text nodes in the clone
const textNodes = newEntry.findAll(n => n.type === 'TEXT');
const fontSet = new Set();
const fonts = [];
for (const tn of textNodes) {
  if (tn.characters.length > 0) {
    for (const f of tn.getRangeAllFontNames(0, tn.characters.length)) {
      const key = f.family + '|' + f.style;
      if (!fontSet.has(key)) { fontSet.add(key); fonts.push(f); }
    }
  }
}
await Promise.all(fonts.map(f => figma.loadFontAsync(f)));

// Helper to set text in named frame
function setText(parent, frameName, text) {
  const frame = parent.findOne(n => n.name === frameName);
  if (frame) {
    const tn = frame.children.find(c => c.type === 'TEXT');
    if (tn) tn.characters = text;
  }
}

// Fill date and author
setText(newEntry, '#date', 'MM.DD.YYYY');
setText(newEntry, '#author', 'author-name');

// Fill changes (find existing #changes block)
const changesBlock = newEntry.findOne(n => n.name === '#changes');
setText(changesBlock, '#changes-title', 'Change title here');
setText(changesBlock, '#changes-description', 'Change description here');

return { success: true, entryId: newEntry.id };
```

For multiple changes, clone the `#changes` frame before filling:

```javascript
// Get all #changes blocks — there should be exactly one in the cloned template
const changesTemplate = newEntry.findOne(n => n.name === '#changes');
const changesParent = changesTemplate.parent;

// For each additional change beyond the first, clone
const allChanges = [changesTemplate];
for (let i = 1; i < CHANGE_COUNT; i++) {
  const clone = changesTemplate.clone();
  changesParent.appendChild(clone);
  allChanges.push(clone);
}

// Fill each changes block
for (let i = 0; i < allChanges.length; i++) {
  setText(allChanges[i], '#changes-title', titles[i]);
  setText(allChanges[i], '#changes-description', descriptions[i]);
}
```

### Step 7: Verify

Use `figma_capture_screenshot` (preferred, captures live state) or `figma_take_screenshot` to verify the entry was added correctly. Check:
- Date and author are visible and correct
- Title and description text are filled
- The new entry appears at the top of the changelog
- Layout looks correct (no overlaps, proper spacing)

### Step 8: Report

Tell the user the entry was added successfully. If the screenshot looks off, iterate (max 3 attempts).

## No Fallback

This skill has no fallback mode. If the Desktop Bridge is not running or `figma_execute` fails, tell the user:

> "I cannot access Figma. Please ensure the Figma Desktop Bridge plugin is running and try again."

Do NOT generate JSON or attempt any workaround. The user must fix their Figma connection before proceeding.
