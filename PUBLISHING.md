# Publishing the uSpec Plugin

This guide covers options for publishing your Claude Code plugin so others can easily install and use it.

## Publishing Options

### Option 1: GitHub Repository (Recommended for Starting)

The simplest way to publish your plugin is through GitHub, where users can install it directly.

#### Steps:

1. **Push to GitHub**
   ```bash
   git remote add origin https://github.com/yourusername/uSpec
   git push -u origin main
   ```

2. **Users can install with:**
   ```bash
   claude install https://github.com/yourusername/uSpec/plugin
   # or from a specific branch/release
   claude install https://github.com/yourusername/uSpec/plugin@v1.0.0
   ```

3. **Create a release** on GitHub with version tags:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

### Option 2: NPM Package Registry

For wider distribution, publish to npm:

1. **Create package.json in plugin root** (if not already there):
   ```bash
   cd plugin
   npm init -y
   ```

2. **Update package.json:**
   ```json
   {
     "name": "@yourusername/uspec",
     "version": "1.0.0",
     "description": "Automate design system documentation in Figma",
     "main": ".claude-plugin/plugin.json",
     "repository": {
       "type": "git",
       "url": "https://github.com/yourusername/uSpec.git",
       "directory": "plugin"
     },
     "keywords": ["figma", "design-system", "documentation", "specs"],
     "author": "Your Name",
     "license": "MIT"
   }
   ```

3. **Publish to npm:**
   ```bash
   npm login
   npm publish
   ```

4. **Users install with:**
   ```bash
   claude install @yourusername/uspec
   # or specific version
   claude install @yourusername/uspec@1.0.0
   ```

### Option 3: Claude's Plugin Registry (When Available)

If Claude Code has an official plugin registry (like VS Code Marketplace), the process would be:
- Check Claude documentation at https://opencode.ai/docs for official registry
- Submit your plugin through the registry's submission process
- Include screenshots, documentation, and demo links

## Pre-Publishing Checklist

Before publishing, ensure your plugin is ready:

- [ ] `plugin.json` is valid and complete
- [ ] All `SKILL.md` files are present and properly formatted
- [ ] Support files (aria.md, voiceover.md, etc.) are included
- [ ] `plugin/README.md` has clear installation and usage instructions
- [ ] License is specified (MIT recommended)
- [ ] Version number is set (follow [semantic versioning](https://semver.org/))
- [ ] All file paths are correct and relative
- [ ] Plugin has been tested locally with `claude install /path/to/uSpec/plugin`

## Version Management Strategy

### Semantic Versioning

Use MAJOR.MINOR.PATCH format:
- **MAJOR**: Breaking changes (e.g., restructured skill format)
- **MINOR**: New features (e.g., new skill added)
- **PATCH**: Bug fixes and improvements (e.g., updated documentation)

Examples:
- `v1.0.0` - First release
- `v1.1.0` - Added structure skill
- `v1.1.1` - Fixed typo in anatomy skill
- `v2.0.0` - Restructured plugin format

### Updating plugin.json

```json
{
  "name": "uspec",
  "version": "1.0.0",  // ← Update this
  "description": "...",
  // ...
}
```

## Promotion & Discovery

Once published, promote your plugin:

1. **GitHub Discussions** - Announce in OpenCode/Claude Code communities
2. **Design System Communities** - Share in Figma/design system Discord servers
3. **Documentation Site** - Add installation instructions to uSpec.design
4. **Social Media** - Tweet/share with design/dev communities
5. **Package Managers** - List in ecosystem pages (once registered)

## Example Installation Instructions for Users

```markdown
## Installation

Install the uSpec plugin via Claude Code CLI:

### From GitHub
\`\`\`bash
claude install https://github.com/yourusername/uSpec/plugin
\`\`\`

### From npm
\`\`\`bash
claude install @yourusername/uspec
\`\`\`

### Local Development
\`\`\`bash
claude install /path/to/uSpec/plugin
\`\`\`
```

## Maintenance

After publishing:

1. **Monitor issues** - Track bug reports on GitHub
2. **Keep docs updated** - Update SKILL.md files as you improve agents
3. **Regular releases** - Push updates every 1-2 months
4. **Changelog** - Maintain CHANGELOG.md documenting all changes
5. **Version compatibility** - Test with latest Claude Code releases

## Quick Start for Publishing

```bash
# 1. Ensure git repo exists
cd /path/to/uSpec
git init
git add .
git commit -m "Initial commit: uSpec plugin"

# 2. Add GitHub remote
git remote add origin https://github.com/yourusername/uSpec
git push -u origin main

# 3. Create first release
git tag v1.0.0
git push origin v1.0.0

# 4. (Optional) Publish to npm
cd plugin
npm publish
```

## Support & Resources

- Claude Code Documentation: https://opencode.ai/docs
- Plugin API Reference: https://opencode.ai/docs/plugins
- OpenCode Discord: https://opencode.ai/discord
- GitHub Discussions: https://github.com/yourusername/uSpec/discussions

---

**Next Steps:**
1. Decide between GitHub-only or npm+GitHub publishing
2. Set up the chosen publishing platform
3. Create initial release v1.0.0
4. Update uSpec.design with installation instructions
5. Share with the design systems community
