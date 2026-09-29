# opencode integration

Build/install the runtime first, start the daemon and register a unique participant as shown in [USAGE](../../docs/USAGE.md). The following uses the locally built CLI until npm is publicly released:

```sh
node dist/cli.js doctor --session /absolute/private/session.json
node dist/cli.js setup --host opencode --session /absolute/private/session.json --out /absolute/private/generated.json
```

The output is a complete minimal OpenCode JSON configuration with a local MCP command. Use `OPENCODE_CONFIG=/absolute/path/to/generated.json opencode` for the intended participant. OpenCode merges this file before project configuration: a project's `mcp.durebak` can override the participant identity. Ensure project and managed configuration do not redefine that server, and verify the effective identity before sending. See the [official precedence order](https://opencode.ai/docs/config/#precedence-order). This adapter has not been tested with an installed OpenCode CLI.

`setup` creates a new 0600 file, refuses to overwrite an existing path and contains a credential path rather than a token. It pins the current Node and CLI paths. After moving/upgrading the runtime, regenerate into a new file and restart the host. Remove only your generated file/profile to undo this setup; revoke the credential when retiring a participant. Do not commit these files.

See [compatibility](../../docs/COMPATIBILITY.md) for evidence and limits. Runtime configuration is independent of the optional [shared skill](../../plugins/durebak/skills/durebak/SKILL.md).

Harness selection and live-test limitations: see [compatibility matrix](../../docs/COMPATIBILITY.md#heterogeneous-matrix). Use `--harness opencode`; legacy flags remain compatible.
