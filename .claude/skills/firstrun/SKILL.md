---
name: firstrun
description: First-time setup for uSpec. Prompts for environment (Cursor, Claude Code, Codex), syncs skills to the chosen platform, then configures your Figma template library. Use when the user mentions "firstrun", "first run", "setup", "setup library", "configure templates", or "link templates".
---

# First Run

Set up uSpec for your environment. This skill asks which platform you're using, deploys skills to the right directory, then extracts template component keys from your Figma library and writes the configuration.

## Inputs Expected

This skill collects inputs interactively — do not require them up front.

## Workflow

Copy this checklist and update as you progress:

```
Task Progress:
- [ ] Step 1: Select environment
- [ ] Step 2: Sync skills (if needed)
- [ ] Step 3: Get library link
- [ ] Step 4: Verify MCP connection
- [ ] Step 5: Navigate to the library file
- [ ] Step 6: Search for template components
- [ ] Step 7: Extract component keys
- [ ] Step 7b: Detect font family from template
- [ ] Step 8: Write config to uspecs.config.json
- [ ] Step 9: Display success message
```

### Step 1: Select Environment

Ask the user:

> **Which tool are you configuring uSpec for?**
> 1. Cursor
> 2. Claude Code CLI
> 3. Codex CLI

Wait for the user's answer before proceeding. Save the choice as `ENVIRONMENT` (one of `cursor`, `claude-code`, `codex`).

### Step 2: Sync Skills (if needed)

Based on the environment selected in Step 1:

- **Cursor** — Skip this step. All skills are already in `.cursor/skills/`.
- **Claude Code CLI** — Run the sync script to deploy skills:
  ```bash
  ./utils/sync-skills.sh --target claude
  ```
- **Codex CLI** — Run the sync script to deploy skills:
  ```bash
  ./utils/sync-skills.sh --target codex
  ```

If the sync script fails, guide the user:
> The skill sync failed. Make sure you're running from the uSpec project root and that `utils/sync-skills.sh` is executable (`chmod +x utils/sync-skills.sh`).

### Step 3: Get Library Link

Ask the user:

> **Paste the link to your Figma template library file.**
> Uber designers can skip this — type "skip" to use the internal library.

Wait for the user's answer. Save the URL as `LIBRARY_URL`.

If the user types "skip", use the pre-configured internal library URL (if one exists in `uspecs.config.json`). If no pre-configured URL exists, tell the user:
> No internal library URL is configured. Please provide a Figma link to your template library.

### Step 4: Verify MCP Connection

Check that Figma Console MCP is connected:
- `figma_get_status` — Confirm Desktop Bridge plugin is active

If connection fails, guide user:
> Please open Figma Desktop and run the Desktop Bridge plugin. Then try again.

### Step 5: Navigate to the Library File

Use the Figma link provided by the user:
- `figma_navigate` — Open the template library URL

### Step 6: Search for Template Components

Search for each of the 8 template components by name:
- `figma_search_components` with query for each template name

Required template names (case-insensitive search):
1. "Screen reader"
2. "Color Annotation"
3. "Overview"
4. "API"
5. "Property"
6. "Structure"
7. "Changelog"
8. "Motion"

### Step 7: Extract Component Keys

For each found component, extract its component key. The search results include the `componentKey` field.

Build a mapping of template type to key:
- screenReader: key from "Screen reader" component
- colorAnnotation: key from "Color Annotation" component
- anatomyOverview: key from "Overview" component
- apiOverview: key from "API" component
- propertyOverview: key from "Property" component
- structureSpec: key from "Structure" component
- changelog: key from "Changelog" component
- motionSpec: key from "Motion" component

If any template is not found, report which ones are missing:
> Could not find the following templates: [list]. Please ensure your library file contains components with these exact names.

### Step 7b: Detect Font Family from Template

Using the node ID of one of the found template components (e.g., the Overview or API component):
- Use `figma_execute` to run a script that finds the first TEXT node inside the component and reads its `fontName.family`

```javascript
const node = await figma.getNodeByIdAsync('NODE_ID_FROM_STEP_6');
const textNode = node.findOne(n => n.type === 'TEXT');
if (textNode) {
  return textNode.fontName.family;
} else {
  return 'Inter';
}
```

Save the result as `DETECTED_FONT_FAMILY`. If the script returns an error or no text node is found, default to `Inter`.

### Step 8: Write Config to uspecs.config.json

Write the extracted keys, detected font family, and environment to `uspecs.config.json` at the project root. The file structure is:

```json
{
  "environment": "ENVIRONMENT",
  "fontFamily": "DETECTED_FONT_FAMILY",
  "templateKeys": {
    "screenReader": "KEY_FROM_STEP_7",
    "colorAnnotation": "KEY_FROM_STEP_7",
    "anatomyOverview": "KEY_FROM_STEP_7",
    "apiOverview": "KEY_FROM_STEP_7",
    "propertyOverview": "KEY_FROM_STEP_7",
    "structureSpec": "KEY_FROM_STEP_7",
    "changelog": "KEY_FROM_STEP_7",
    "motionSpec": "KEY_FROM_STEP_7"
  }
}
```

Replace `ENVIRONMENT` with the value from Step 1, `DETECTED_FONT_FAMILY` with the font detected in Step 7b, and each template key with the actual component key from Step 7.

### Step 9: Success Message

Display:

> **Setup complete!**
>
> You are now ready to use uSpec. For instructions, go to [docs.uspec.design](https://docs.uspec.design).
