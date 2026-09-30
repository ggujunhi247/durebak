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

## 세션 지침

Claude Code는 프로젝트 [`CLAUDE.md` 또는 조건에 따라 `AGENTS.md`](https://code.claude.com/docs/en/memory)를 읽습니다. `AGENTS.md`를 직접 읽는 기능은 Claude Code 버전에 따라 달라지므로, 이전 버전이나 이미 `CLAUDE.md`가 있는 프로젝트에서는 `@AGENTS.md` import를 확인하세요. 두레박 MCP 연결은 별도이며, 선택적 스킬은 협업 절차를 가르칩니다. Claude의 자체 [세션 간 메시지](https://code.claude.com/docs/en/cross-session-messaging)와 두레박 큐는 별개입니다. 수신자가 직접 `durebak_receive`를 호출하며, [받은 요청 처리](../../docs/USAGE.md#받은-요청의-처리)를 따르세요.
