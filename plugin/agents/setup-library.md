---
name: setup-library
description: Configure uSpec with your Figma template library. Use when the user mentions "setup library", "configure templates", "link templates", or provides a Figma link to their template library file.
---

# Setup Library

Configure uSpec to use your Figma template library. This skill extracts component keys from your template file and updates the configuration.

## Inputs Expected

- **Figma link**: URL to the Figma file containing your documentation templates (required)

The file must contain components with these exact names:
- Screen reader
- Color Annotation
- Overview
- API
- Property
- Structure
- Changelog
- Motion

## Workflow

Copy this checklist and update as you progress:

```
Task Progress:
- [ ] Step 1: Verify MCP connection
- [ ] Step 2: Navigate to the library file
- [ ] Step 3: Search for template components
- [ ] Step 4: Extract component keys
- [ ] Step 4b: Detect font family from template
- [ ] Step 5: Write config to uspecs.config.json
- [ ] Step 6: Display success message
```

### Step 1: Verify MCP Connection

Check that Figma Console MCP is connected:
- `figma_get_status` — Confirm Desktop Bridge plugin is active

If connection fails, guide user:
> Please open Figma Desktop and run the Desktop Bridge plugin. Then try again.

### Step 2: Navigate to the Library File

Use the Figma link provided by the user:
- `figma_navigate` — Open the template library URL

### Step 3: Search for Template Components

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

### Step 4: Extract Component Keys

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

### Step 4b: Detect Font Family from Template

Using the node ID of one of the found template components (e.g., the Overview or API component):
- Use `figma_execute` to run a script that finds the first TEXT node inside the component and reads its `fontName.family`

```javascript
const node = await figma.getNodeByIdAsync('NODE_ID_FROM_STEP_3');
const textNode = node.findOne(n => n.type === 'TEXT');
if (textNode) {
  return textNode.fontName.family;
} else {
  return 'Inter';
}
```

Save the result as `DETECTED_FONT_FAMILY`. If the script returns an error or no text node is found, default to `Inter`.

### Step 5: Write Config to uspecs.config.json

Write the extracted keys and detected font family to `uspecs.config.json` at the project root. The file structure is:

```json
{
  "fontFamily": "DETECTED_FONT_FAMILY",
  "templateKeys": {
    "screenReader": "KEY_FROM_STEP_4",
    "colorAnnotation": "KEY_FROM_STEP_4",
    "anatomyOverview": "KEY_FROM_STEP_4",
    "apiOverview": "KEY_FROM_STEP_4",
    "propertyOverview": "KEY_FROM_STEP_4",
    "structureSpec": "KEY_FROM_STEP_4",
    "changelog": "KEY_FROM_STEP_4",
    "motionSpec": "KEY_FROM_STEP_4"
  }
}
```

Replace `DETECTED_FONT_FAMILY` with the font detected in Step 4b, and each template key with the actual component key from Step 4.

### Step 6: Success Message

Display:

> **Setup complete!**
>
> You are now ready to use uSpec. For instructions, go to [docs.uspec.design](https://docs.uspec.design).
