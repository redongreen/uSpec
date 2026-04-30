---
name: firstrun
description: Configure uSpec's Figma template library. Verifies your MCP connection, then extracts template component keys from your Figma library and writes them to uspecs.config.json. Run after `npx uspec-skills init` has set up the platform and config file. Use when the user mentions "firstrun", "first run", "setup library", "configure templates", or "link templates".
---

# First Run

Configure your Figma template library for uSpec. This skill verifies your MCP connection, navigates your Figma template library, extracts template component keys, detects the font family, and writes everything to `uspecs.config.json`.

## Prerequisite

`uspecs.config.json` must already exist with `mcpProvider` and `environment` set. These are written by `npx uspec-skills init`. If the config is missing, abort with:

> Run `npx uspec-skills init` first to install uSpec and choose your platform. Then run this skill to configure your Figma template library.

Read `mcpProvider` and `environment` from `uspecs.config.json` and use those values throughout this skill instead of asking the user.

## Inputs Expected

This skill collects inputs interactively — do not require them up front.

## Workflow

Copy this checklist and update as you progress:

```
Task Progress:
- [ ] Step 1: Read MCP provider from uspecs.config.json
- [ ] Step 1b: Verify MCP connection
- [ ] Step 4: Ask "Uber employee?" — Yes (use internal library) or No (paste link)
- [ ] Step 4a (Yes only): Write Uber template keys + fontFamily to config, then jump to Step 9
- [ ] Step 5 (No only): Navigate to the library file / extract fileKey
- [ ] Step 6 (No only): Search for template components
- [ ] Step 7 (No only): Extract component keys
- [ ] Step 7b (No only): Detect font family from template
- [ ] Step 8 (No only): Write config to uspecs.config.json
- [ ] Step 9: Display success message
```

### Step 1: Read MCP Provider from Config

Read `mcpProvider` from `uspecs.config.json`. It will be one of `figma-console` or `figma-mcp`. Save this value as `MCP_PROVIDER` for use in later steps.

If `mcpProvider` is missing, abort and tell the user to re-run `npx uspec-skills init`.

### Step 1b: Verify MCP Connection

Verify the selected MCP is connected before continuing — catching a broken connection early avoids wasting time on setup that will fail later.

**If `MCP_PROVIDER` = `figma-console`:**
- Call `figma_get_status` — Confirm Desktop Bridge plugin is active

If connection fails:
> Please open Figma Desktop and run the Desktop Bridge plugin. Then try again.

**If `MCP_PROVIDER` = `figma-mcp`:**
- Make a lightweight `use_figma` call to verify connectivity:
  - `fileKey`: any valid fileKey (you can use `"test"` — the call will fail with a clear error if the MCP itself is not connected, vs. a file-not-found error which confirms the MCP works)
  - `code`: `return "ok";`
  - `description`: `Verify MCP connection`

If the MCP itself is not reachable (tool not found, server error):
> The native Figma MCP is not responding. Please check your MCP configuration and ensure the Figma MCP server is running.

If the call returns a file-not-found error, that's fine — it means the MCP is connected. Proceed.

### Step 4: Ask Whether the User Is a Uber Employee

Ask the user exactly this:

> **Are you a Uber employee?**
> - **Yes** — uSpec will use the built-in Uber template library (no link needed).
> - **No** — paste the link to your Figma template library file.

Wait for the user's answer.

- If the answer is **Yes** (or any clear affirmative such as "yes", "y", "skip", "uber"), proceed to **Step 4a** and skip Steps 5, 6, 7, and 7b entirely.
- If the answer is **No** or the user pastes a Figma URL, save the URL as `LIBRARY_URL` and continue with Step 5. **For `figma-mcp` only:** extract `FILE_KEY` from the URL. Figma URLs follow the pattern `figma.com/design/:fileKey/:fileName`. For branch URLs (`figma.com/design/:fileKey/branch/:branchKey/:fileName`), use `:branchKey` as the `FILE_KEY`. Save this for all subsequent `use_figma` / `search_design_system` / `get_screenshot` calls.

### Step 4a: Write Built-in Uber Template Config (Yes branch only)

When the user answers Yes in Step 4, the agent already has the correct template keys and font family for the Uber-internal library. Write them to `uspecs.config.json`, preserving every existing field (`mcpProvider`, `environment`, `cliVersion`, and any other unknown fields). The merged file should look like:

```json
{
  "mcpProvider": "...preserved...",
  "environment": "...preserved...",
  "cliVersion": "...preserved...",
  "fontFamily": "Uber Move",
  "templateKeys": {
    "screenReader": "6351e6a91a6785702ffa57f7e7ae085fe9f83f57",
    "colorAnnotation": "0b939a05e7b403b481d5221b08f33c97dc4acd39",
    "anatomyOverview": "a552bd211756add2661ed757a5aeafba24bd59a9",
    "apiOverview": "a182560cbe538de07f49f0aed5fadeea7d418e1c",
    "propertyOverview": "401fa98128d882dc93c3d5987ed094b1ec66b9f3",
    "structureSpec": "9f5f7bdc834004ea47e59bb1502aab66348f1c99",
    "motionSpec": "31bc00ff1f47b602cb7129b24b1f3271e7c7b5dd"
  }
}
```

Then **jump directly to Step 9** (Success Message). Do not run Steps 5, 6, 7, 7b, or 8 — no MCP calls or library navigation are needed for Uber employees.

### Step 5: Navigate to the Library File (No branch only)

**If `MCP_PROVIDER` = `figma-console`:**
- `figma_navigate` — Open the template library URL

**If `MCP_PROVIDER` = `figma-mcp`:**
- No navigation call needed — `use_figma` takes `fileKey` directly. The `FILE_KEY` extracted in Step 4 is used for all subsequent calls. Optionally, verify the file is accessible:
  - `use_figma` with `fileKey = FILE_KEY`, `code = "return figma.root.children.map(p => p.name);"`, `description = "List pages in template library"`

### Step 6: Search for Template Components (No branch only)

Required template names (case-insensitive search):
1. "Screen reader"
2. "Color Annotation"
3. "Anatomy"
4. "API"
5. "Property"
6. "Structure"
7. "Motion"

**If `MCP_PROVIDER` = `figma-console`:**
- `figma_search_components` with query for each template name

**If `MCP_PROVIDER` = `figma-mcp`:**
- `search_design_system` with `query` for each template name, `fileKey = FILE_KEY`, and `includeComponents: true`

### Step 7: Extract Component Keys (No branch only)

For each found component, extract its component key. The search results include the `componentKey` (Console MCP) or `key` (native MCP) field.

Build a mapping of template type to key:
- screenReader: key from "Screen reader" component
- colorAnnotation: key from "Color Annotation" component
- anatomyOverview: key from "Anatomy" component
- apiOverview: key from "API" component
- propertyOverview: key from "Property" component
- structureSpec: key from "Structure" component
- motionSpec: key from "Motion" component

If any template is not found, report which ones are missing:
> Could not find the following templates: [list]. Please ensure your library file contains components with these exact names.

### Step 7b: Detect Font Family from Template (No branch only)

Using the node ID of one of the found template components (e.g., the Overview or API component):

**If `MCP_PROVIDER` = `figma-console`:**
- Use `figma_execute` to run the font detection script below.

**If `MCP_PROVIDER` = `figma-mcp`:**
- Use `use_figma` with `fileKey = FILE_KEY`, `description = "Detect font family from template"`, and the same script below as `code`.

```javascript
const node = await figma.getNodeByIdAsync('NODE_ID_FROM_STEP_6');
let _p = node; while (_p.parent && _p.parent.type !== 'DOCUMENT') _p = _p.parent;
if (_p.type === 'PAGE') await figma.setCurrentPageAsync(_p);
const textNode = node.findOne(n => n.type === 'TEXT');
if (textNode) {
  try {
    const fn = textNode.fontName;
    if (fn && fn !== figma.mixed && fn.family) return fn.family;
  } catch {}
}
return 'Inter';
```

Save the result as `DETECTED_FONT_FAMILY`. If the script returns an error or no text node is found, it defaults to `Inter`.

### Step 8: Write Config to uspecs.config.json (No branch only)

Read the existing `uspecs.config.json` (which already has `mcpProvider`, `environment`, and `cliVersion` from `npx uspec-skills init`), then add `fontFamily` and `templateKeys` while preserving every existing field. The merged file should look like:

```json
{
  "mcpProvider": "...preserved from init...",
  "environment": "...preserved from init...",
  "cliVersion": "...preserved from init...",
  "fontFamily": "DETECTED_FONT_FAMILY",
  "templateKeys": {
    "screenReader": "KEY_FROM_STEP_7",
    "colorAnnotation": "KEY_FROM_STEP_7",
    "anatomyOverview": "KEY_FROM_STEP_7",
    "apiOverview": "KEY_FROM_STEP_7",
    "propertyOverview": "KEY_FROM_STEP_7",
    "structureSpec": "KEY_FROM_STEP_7",
    "motionSpec": "KEY_FROM_STEP_7"
  }
}
```

Replace `DETECTED_FONT_FAMILY` with the font detected in Step 7b, and each template key with the actual component key from Step 7. Do NOT overwrite or remove `mcpProvider`, `environment`, `cliVersion`, or any other field already in the file.

### Step 9: Success Message

Display:

> **Setup complete!**
>
> You are now ready to use uSpec. For instructions, go to [docs.uspec.design](https://docs.uspec.design).
