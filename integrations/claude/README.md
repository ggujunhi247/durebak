# claude integration

Build/install the runtime first, start the daemon and register a unique participant as shown in [USAGE](../../docs/USAGE.md). The following uses the locally built CLI until npm is publicly released:

```sh
node dist/cli.js doctor --session /absolute/private/session.json
node dist/cli.js setup --host claude --session /absolute/private/session.json --out /absolute/private/generated.json
```

Launch one Claude process with `claude --strict-mcp-config --mcp-config /absolute/path/to/generated.json`. Use a separate generated file for each participant. The optional skill bundle can be loaded with `claude --plugin-dir /absolute/path/to/repo/plugins/durebak`; this does not itself connect MCP. Live Claude communication is experimental until valid API authentication is tested.

`setup` creates a new 0600 file, refuses to overwrite an existing path and contains a credential path rather than a token. It pins the current Node and CLI paths. After moving/upgrading the runtime, regenerate into a new file and restart the host. Remove only your generated file/profile to undo this setup; revoke the credential when retiring a participant. Do not commit these files.

See [compatibility](../../docs/COMPATIBILITY.md) for evidence and limits. Runtime configuration is independent of the optional [shared skill](../../plugins/durebak/skills/durebak/SKILL.md).

Harness selection and live-test limitations: see [compatibility matrix](../../docs/COMPATIBILITY.md#heterogeneous-matrix). Use `--harness claude-code`; legacy `claude` remains compatible.
