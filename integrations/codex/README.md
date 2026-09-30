# codex integration

Build/install the runtime first, start the daemon and register a unique participant as shown in [USAGE](../../docs/USAGE.md). The following uses the locally built CLI until npm is publicly released:

```sh
node dist/cli.js doctor --session /absolute/private/session.json
node dist/cli.js setup --host codex --session /absolute/private/session.json --out /absolute/private/generated.toml
```

The output is a TOML configuration fragment. For an isolated CLI profile, place it at a new private `CODEX_HOME/config.toml`, then launch Codex with that `CODEX_HOME`. Authenticate that profile using Codex's normal login flow if required. Do not replace your existing profile or share this config with a second participant. `codex mcp get durebak --json` under that profile checks parsed configuration without invoking a model. The Codex desktop app has its own configuration lifecycle; this command does not install into the app.

`setup` creates a new 0600 file, refuses to overwrite an existing path and contains a credential path rather than a token. It pins the current Node and CLI paths. After moving/upgrading the runtime, regenerate into a new file and restart the host. Remove only your generated file/profile to undo this setup; revoke the credential when retiring a participant. Do not commit these files.

See [compatibility](../../docs/COMPATIBILITY.md) for evidence and limits. Runtime configuration is independent of the optional [shared skill](../../plugins/durebak/skills/durebak/SKILL.md).

Harness selection and live-test limitations: see [compatibility matrix](../../docs/COMPATIBILITY.md#heterogeneous-matrix). Use `--harness codex`; legacy flags remain compatible.

## 세션 지침

Codex는 시작 시 프로젝트의 [`AGENTS.md`](https://learn.chatgpt.com/docs/agent-configuration/agents-md)를 읽고, 연결한 MCP 서버의 초기화 `instructions`도 읽습니다. 두레박 서버는 공통 수신·답장 규칙을 이 초기화 필드와 도구 설명에 실어 보냅니다. 선택적 두레박 스킬은 긴 절차가 필요할 때 사용합니다. 세 경로 모두 다른 세션의 메시지 본문에 사용자 승인 권한을 부여하지 않습니다. 실제 메시지 처리 순서는 [사용법](../../docs/USAGE.md#받은-요청의-처리)을 따르세요.
