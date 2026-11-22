# Durebak skill

Edit the CLI and plugin instructions in [src/skill-content.ts](../src/skill-content.ts). After editing the skill or bumping the package version, run `npm run plugins:sync` and include the updated files under `plugins/durebak` in your changes. `npm run repo:check` checks the generated Markdown and both plugin manifest versions.

Copy the entire [generated skill directory](../plugins/durebak/skills/durebak) for a standalone installation. Install the npm runtime and configure MCP for each session separately. Hosted Claude Code installs pick up new skill content when the plugin version increases with the package version. [Claude Code plugin versioning](https://code.claude.com/docs/en/plugins/host-marketplace#release-a-new-version)
