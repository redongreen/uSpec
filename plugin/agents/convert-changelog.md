---
name: convert-changelog
description: Convert an existing Figma changelog into structured JSON format. Use when the user mentions "convert changelog", "import changelog", "migrate changelog", or provides a Figma link to an existing changelog they want converted to the standard JSON format.
---

# Convert Changelog

Extract content from an existing Figma changelog and convert it to structured JSON that can be used with uSpec.

## Inputs Expected

- **Figma link**: Required — URL to the existing changelog frame in Figma

## HARD REQUIREMENT: Figma Access

This skill requires working MCP/Figma access. If any of the following fail, **STOP IMMEDIATELY** and tell the user:

> "I cannot access Figma. Please ensure the Figma Desktop Bridge plugin is running and try again."

**Do NOT:**
- Invent or guess changelog content
- Generate placeholder JSON
- Proceed without successfully extracting data from Figma

**Failure conditions that trigger hard stop:**
- `figma_navigate` fails or returns error
- `figma_take_screenshot` fails
- `figma_execute` fails or returns error
- Node not found at the provided URL
- Cannot extract any text content from the changelog

## Reference

Before generating any content, always check the latest available MCP tools at:
https://docs.figma-console-mcp.southleft.com/tools

## Workflow

Copy this checklist and update as you progress:

```
Task Progress:
- [ ] Step 1: Read instruction file
- [ ] Step 2: Navigate to Figma link and screenshot
- [ ] Step 3: Detect changelog structure type
- [ ] Step 4: Extract content from Figma
- [ ] Step 5: Parse into changelog entries
- [ ] Step 6: Normalize dates and format descriptions
- [ ] Step 7: Generate JSON output
- [ ] Step 8: Audit against instruction file rules
- [ ] Step 9: Return final validated JSON
```

### Step 1: Read Instructions

Read [agent-changelog-instruction.md](../../changelog/agent-changelog-instruction.md) for the JSON schema and formatting rules.

### Step 2: Verify MCP Connection and Navigate

1. `figma_get_status` — Confirm Desktop Bridge plugin is connected
2. If WebSocket/Desktop Bridge is not available, **STOP** and tell the user: "I cannot access Figma. Please ensure the Figma Desktop Bridge plugin is running and try again."
3. `figma_navigate` — Open the changelog URL
4. `figma_take_screenshot` — Capture the changelog visually for context

### Step 3: Detect Structure Type

Use `figma_execute` to check if the changelog uses the uSpec template structure:

```javascript
const node = await figma.getNodeByIdAsync('NODE_ID');
if (!node) return { error: 'Node not found' };

// Check for uSpec template structure
const content = node.findOne(n => n.name === 'Content');
if (!content) return { structured: false, reason: 'No Content frame' };

const container = content.children.find(c => c.type === 'FRAME');
if (!container) return { structured: false, reason: 'No entries container' };

const hasTemplateEntry = container.children.some(c => c.name === '#new-date-entry');
return { 
  structured: hasTemplateEntry,
  containerId: container.id,
  entryCount: container.children.filter(c => c.type === 'FRAME').length
};
```

### Step 4: Extract Content

#### If Structured (uSpec template)

Use `figma_execute` to extract text from known node paths:

```javascript
const node = await figma.getNodeByIdAsync('NODE_ID');
const content = node.findOne(n => n.name === 'Content');
const container = content.children.find(c => c.type === 'FRAME');

// Get all date entry frames (they may be named #new-date-entry or just be FRAME children)
const entryFrames = container.children.filter(c => c.type === 'FRAME');

const entries = [];
for (const entry of entryFrames) {
  // Extract date
  const dateFrame = entry.findOne(n => n.name === '#date');
  const dateText = dateFrame ? dateFrame.children.find(c => c.type === 'TEXT') : null;
  const date = dateText ? dateText.characters : '';
  
  // Extract author
  const authorFrame = entry.findOne(n => n.name === '#author');
  const authorText = authorFrame ? authorFrame.children.find(c => c.type === 'TEXT') : null;
  const author = authorText ? authorText.characters : '';
  
  // Extract all changes blocks
  const changesBlocks = entry.findAll(n => n.name === '#changes');
  const changes = [];
  
  for (const changesBlock of changesBlocks) {
    const titleFrame = changesBlock.findOne(n => n.name === '#changes-title');
    const titleText = titleFrame ? titleFrame.children.find(c => c.type === 'TEXT') : null;
    
    const descFrame = changesBlock.findOne(n => n.name === '#changes-description');
    const descText = descFrame ? descFrame.children.find(c => c.type === 'TEXT') : null;
    
    changes.push({
      title: titleText ? titleText.characters : '',
      description: descText ? descText.characters : ''
    });
  }
  
  entries.push({ date, author, changes });
}

return { entries };
```

#### If Unstructured

Use `figma_execute` to get all TEXT nodes, then interpret:

```javascript
const node = await figma.getNodeByIdAsync('NODE_ID');
const textNodes = node.findAll(n => n.type === 'TEXT');

const texts = textNodes.map(t => ({
  characters: t.characters,
  fontSize: t.fontSize,
  y: t.absoluteTransform[1][2]  // vertical position for ordering
}));

// Sort by vertical position (top to bottom)
texts.sort((a, b) => a.y - b.y);

return { texts };
```

Then use the screenshot and extracted texts to identify:
- Dates (look for patterns like MM.DD.YYYY, YYYY-MM-DD, "Feb 10, 2026")
- Authors (usually appears after dates, often smaller font)
- Titles (larger/bolder text)
- Descriptions (regular text following titles)

### Step 5: Parse into Entries

Group extracted content into `ChangelogEntry` objects:
- Each unique date+author combination becomes one entry
- Multiple titles/descriptions under the same date+author become multiple `ChangeItem`s

### Step 6: Rewrite and Clean Up

**You are the writer, not a transcriber.** Do not copy extracted text verbatim. Rewrite everything to be clean, consistent, and professional.

**Dates**: Convert any date format to `MM.DD.YYYY`:
- `2026-02-10` → `02.10.2026`
- `Feb 10, 2026` → `02.10.2026`
- `10/02/2026` → `02.10.2026` (assume MM/DD/YYYY for US format)

**Authors**: If missing, use `{author}` placeholder.

**Titles**: 
- Rewrite to be concise (3-8 words)
- Use sentence case (capitalize first word only)
- Fix grammar, spelling, and punctuation
- Remove filler words

**Descriptions**: 
- **Every line must start with `- `** (hyphen + space) — this triggers Figma's native bullet formatting
- Rewrite for clarity and consistency — do NOT copy verbatim
- Fix grammar, spelling, and punctuation errors
- Standardize terminology (e.g., "light mode" not "Light Mode" or "lightmode")
- Use `→` for value changes (e.g., "96 → 98")
- Replace literal newlines with `\n`
- Remove redundancy and consolidate repetitive information
- Write from a designer's perspective (focus on design system changes, not code)

### Step 7: Generate JSON

Follow the schema from the instruction file:

```json
{
  "entries": [
    {
      "date": "MM.DD.YYYY",
      "author": "{author}",
      "changes": [
        {
          "title": "Change title",
          "description": "- First point here\n- Second point here\n- Third point here"
        }
      ]
    }
  ]
}
```

### Step 8: Audit

Re-read the instruction file, focusing on:
- **Pre-Output Validation Checklist** — Walk through each row
- **Common Mistakes** section — Confirm none present
- **Do NOT** section — Verify no prohibited patterns

Specifically verify:
- Date format is `MM.DD.YYYY`
- No markdown in descriptions (except `- ` bullets which are allowed)
- Same date+author changes are grouped
- All `ChangeItem`s have non-empty `title` and `description`
- Descriptions use `\n` for line breaks
- **Writing quality**: Titles and descriptions are rewritten, not copied verbatim

### Step 9: Output

Return only the final validated JSON code block. No explanation text before or after.

If the changelog has many entries (> 10), add a brief note before the JSON: "Extracted X entries from the changelog."
