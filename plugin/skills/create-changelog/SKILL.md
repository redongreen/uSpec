---
name: create-changelog
description: Generate a new changelog for a component or design system file. Creates the changelog template and populates it with the first entry. Use when the user mentions "create changelog", "new changelog", "start changelog", or wants to begin tracking changes for a component.
---

# Create Changelog

Generate a new changelog directly in Figma — imports the template, populates it with entries, and applies bullet formatting.

## Inputs Expected

- **Change description**: What changed (token updates, new variants, renamed properties, etc.)
- **Author** (optional): Who made the change. If not provided, use `{author}` as placeholder. Do NOT ask.
- **Date** (optional): When the change was made. If not provided, use today's date.
- **Component/file name** (optional): What component or file this changelog is for. Infer from context if possible.

## Reference

Before generating any content, always check the latest available MCP tools at:
https://docs.figma-console-mcp.southleft.com/tools

## Workflow

Copy this checklist and update as you progress:

```
Task Progress:
- [ ] Step 1: Read instruction file
- [ ] Step 2: Verify MCP connection
- [ ] Step 3: Read template key from uspecs.config.json
- [ ] Step 4: Gather context from user
- [ ] Step 5: Determine date, author, and component name
- [ ] Step 6: Rewrite and compose entry content
- [ ] Step 7: Re-read instruction file (Common Mistakes, Do NOT sections) and audit
- [ ] Step 8: Import and detach the changelog template
- [ ] Step 9: Fill entries (clone #new-date-entry per entry, clone #changes per change item, apply bullet formatting)
- [ ] Step 10: Visual validation
```

### Step 1: Read Instructions

Read [agent-changelog-instruction.md](../../changelog/agent-changelog-instruction.md)

### Step 2: Verify MCP Connection

Verify the connection before proceeding:
- `figma_get_status` — Confirm Figma Desktop is running with Desktop Bridge plugin active

If connection fails, guide user through setup before proceeding.

### Step 3: Read Template Key

Read the file `uspecs.config.json` and extract the `changelog` value from the `templateKeys` object.

Save this key as `CHANGELOG_TEMPLATE_KEY`. If the key is empty, tell the user:
> The changelog template key is not configured. Run `@setup-library` with your Figma template library link first.

### Step 4: Gather Context

**From user:**
- Description of what changed
- Any specific token names, values, before/after details
- Screenshots or Figma links (optional, for additional context)

**From MCP tools (when Figma link provided):**
If the user provides a Figma link for context about what changed, you can optionally use:
1. `figma_navigate` — Open the component URL
2. `figma_take_screenshot` — Capture the component visually
3. `figma_get_variables` — Get variable/token details if relevant
4. `figma_get_token_values` — Get specific token values

Note: MCP tools are optional for changelog — the user's description is the primary source.

### Step 5: Determine Metadata

- **Date**: Use today's date in `MM.DD.YYYY` format, or the date the user specifies
- **Author**: Use the author the user provides. If not provided, use `{author}` as placeholder. Do NOT ask.
- **Component name**: Infer from content (token changes → "Design tokens", component changes → component name). Do NOT ask.

### Step 6: Rewrite and Compose Entry Content

**You are the writer, not a transcriber.** Do not copy the user's input verbatim. Rewrite everything to be clean, consistent, and professional.

- **Rewrite titles**: Make them concise (3-8 words), fix grammar, use sentence case
- **Rewrite descriptions**: Fix grammar/spelling, standardize terminology, use `→` for value changes, add `- ` bullets for token lists
- **Consolidate**: Remove redundancy, merge related information
- **Designer perspective**: Focus on design system changes, not code implementation

Group changes by date+author. Multiple changes on the same date by the same author go as multiple change items in one entry.

Build the data as a structured object:
- `entries`: array of `{ date, author, changes: [{ title, description }] }`

### Step 7: Audit

Re-read the instruction file, focusing on:
- **Pre-Output Validation Checklist** — Walk through each row in the table
- **Common Mistakes** section — Confirm none of these errors are present
- **Do NOT** section — Verify no prohibited patterns appear
- **Edge Cases** — Check if any edge case applies and follow the prescribed action

Specifically verify:
- Date format is `MM.DD.YYYY` (not ISO 8601)
- No markdown in descriptions (except `- ` bullets which are allowed)
- Same date+author changes are grouped in one entry
- All change items have non-empty `title` and `description`
- Descriptions use `\n` for line breaks
- **Writing quality**: Titles and descriptions are rewritten, not copied verbatim from user input

Check your output against each rule. Fix any violations.

### Step 8: Import and Detach Template

Run via `figma_execute` (replace `__CHANGELOG_TEMPLATE_KEY__`):

```javascript
const TEMPLATE_KEY = '__CHANGELOG_TEMPLATE_KEY__';

const templateComponent = await figma.importComponentByKeyAsync(TEMPLATE_KEY);
const instance = templateComponent.createInstance();
const { x, y } = figma.viewport.center;
instance.x = x - instance.width / 2;
instance.y = y - instance.height / 2;
const frame = instance.detachInstance();
frame.name = 'Changelog';
figma.currentPage.selection = [frame];
figma.viewport.scrollAndZoomIntoView([frame]);
return { frameId: frame.id };
```

Save the returned `frameId` — you need it for all subsequent steps.

### Step 9: Fill Entries

For each entry in the data, clone `#new-date-entry`, fill date/author, then clone `#changes` per change item and fill title/description with bullet formatting.

Run via `figma_execute` (one call per entry to avoid timeouts). Replace placeholders:

```javascript
const FRAME_ID = '__FRAME_ID__';
const DATE_TEXT = '__DATE__';
const AUTHOR_TEXT = '__AUTHOR__';
const CHANGES = __CHANGES_JSON__; // Array of { title: string, description: string }

const frame = await figma.getNodeByIdAsync(FRAME_ID);

// Navigate to the entries container: Content > first FRAME child
const content = frame.findOne(n => n.name === 'Content');
const container = content.children.find(c => c.type === 'FRAME');
const entryTemplate = container.findOne(n => n.name === '#new-date-entry');

// Clone the date entry
const entryClone = entryTemplate.clone();
container.insertChild(0, entryClone);
entryClone.name = 'Entry ' + DATE_TEXT;
entryClone.visible = true;

// Load fonts from all text nodes
const textNodes = entryClone.findAll(n => n.type === 'TEXT');
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
  const fr = parent.findOne(n => n.name === frameName);
  if (fr) {
    const tn = fr.children.find(c => c.type === 'TEXT');
    if (tn) tn.characters = text;
  }
}

// Helper to set text with bullet formatting
async function setTextWithBullets(parent, frameName, text) {
  const fr = parent.findOne(n => n.name === frameName);
  if (!fr) return;
  const textNode = fr.children.find(c => c.type === 'TEXT');
  if (!textNode) return;

  const lines = text.split('\\n');
  const bulletIndices = [];
  const processed = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    while (line.startsWith('\\t')) line = line.substring(1);
    if (line.startsWith('- ')) {
      bulletIndices.push(i);
      processed.push(line.substring(2));
    } else {
      processed.push(line);
    }
  }
  const processedText = processed.join('\\n');
  textNode.characters = processedText;

  if (bulletIndices.length === 0) return;
  const fnts = textNode.characters.length > 0
    ? textNode.getRangeAllFontNames(0, textNode.characters.length)
    : [textNode.fontName];
  for (const f of fnts) {
    if (f && typeof f === 'object' && 'family' in f) await figma.loadFontAsync(f);
  }
  let charPos = 0;
  for (let i = 0; i < processed.length; i++) {
    const len = processed[i].length;
    if (bulletIndices.includes(i)) {
      try { textNode.setRangeListOptions(charPos, charPos + len, { type: 'UNORDERED' }); } catch {}
    }
    charPos += len + (i < processed.length - 1 ? 1 : 0);
  }
}

// Fill date and author
setText(entryClone, '#date', DATE_TEXT);
setText(entryClone, '#author', AUTHOR_TEXT);

// Handle #changes blocks
const changesTemplate = entryClone.findOne(n => n.name === '#changes');
const changesParent = changesTemplate.parent;

const allChanges = [changesTemplate];
for (let i = 1; i < CHANGES.length; i++) {
  const clone = changesTemplate.clone();
  changesParent.appendChild(clone);
  allChanges.push(clone);
}

for (let i = 0; i < allChanges.length; i++) {
  allChanges[i].visible = true;
  setText(allChanges[i], '#changes-title', CHANGES[i].title);
  await setTextWithBullets(allChanges[i], '#changes-description', CHANGES[i].description);
}

return { success: true, entryId: entryClone.id };
```

**Building the call for each entry:**
- `DATE_TEXT` = the entry's date in `MM.DD.YYYY` format
- `AUTHOR_TEXT` = the entry's author
- `CHANGES` = JSON array of `{ title, description }` objects for the entry's change items

After all entries are rendered, hide the original `#new-date-entry` template:

```javascript
const frame = await figma.getNodeByIdAsync('__FRAME_ID__');
const content = frame.findOne(n => n.name === 'Content');
const container = content.children.find(c => c.type === 'FRAME');
const template = container.findOne(n => n.name === '#new-date-entry');
if (template) template.visible = false;
return { success: true };
```

### Step 10: Visual Validation

1. `figma_take_screenshot` with the `frameId` — Capture the completed changelog
2. Verify:
   - Header says "Changelog"
   - Each entry shows the correct date and author
   - Change titles and descriptions are filled
   - Bullet formatting is applied on description lines
   - Entries are ordered newest first (top)
   - Layout looks correct (no overlaps, proper spacing)
3. If issues are found, fix via `figma_execute` and re-capture (up to 3 iterations)

## Notes

- The changelog template key is stored in `uspecs.config.json` under `templateKeys.changelog` and is configured via `@setup-library`.
- Two-level cloning: `#new-date-entry` (one per date+author) → `#changes` (one per change item within an entry). Each level is cloned from its template, filled, and the original template hidden after all clones are created.
- Bullet formatting: descriptions prefixed with `- ` have the prefix stripped and `setRangeListOptions({ type: 'UNORDERED' })` applied to render native Figma bullets.
- The instruction file (`changelog/agent-changelog-instruction.md`) contains the writing style, schema, and validation rules. The AI reasoning for rewriting and formatting is unchanged — only the delivery mechanism has changed from JSON output to direct Figma rendering.
