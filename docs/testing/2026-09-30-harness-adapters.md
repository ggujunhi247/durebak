# Harness adapter validation — 2026-09-30 (Asia/Seoul)

- macOS, Node 26.8.1; Codex CLI 0.146.0, Claude Code 2.1.87.
- Configuration registry: three host renderers; unicode/space paths; per-session credential identity; legacy option conflict rejection.
- Scripted MCP round trip: 11 persisted checks passed. This is not a model-provider test.
- Six-pair live matrix: blocked. Codex → Claude sent the request; Claude returned authentication_failed (stored login had been detected). The matrix skipped subsequent Claude calls. OpenCode was not installed in the ordinary PATH.
- Isolated temporary OpenCode 1.18.33: `--pure debug config` exited 0, parsed JSON matched the intended MCP identity, deny-by-default permission and explicit synthetic model; no plugins or agents. No model call was made by this parser test.
- Host adapter fixtures retain event type/status and numeric usage only. Unknown usage stays null. Event versions were checked against installed CLI help and [OpenCode 1.18.33 run source](https://github.com/anomalyco/opencode/blob/v1.18.33/packages/opencode/src/cli/cmd/run.ts).

Private raw execution files stay outside the repository. No transcript, credential, machine path, session ID or source-code prompt is included here. Public compatibility claims remain limited to verified behavior; actual six-pair success requires valid host credentials and an explicitly chosen OpenCode model.

Codex → Codex after adapter refactor: live round trip passed all 11 persisted checks across three native invocations and 10 MCP tool calls. This confirms same-harness regression behavior only.

Distribution rehearsal: Node 24.21.0 and 26.8.1 each passed 57 tests, as did a fresh local clone after `npm ci`. Type checks, repository hygiene scan and actionlint passed. The same 45-file tarball passed allowlist/module validation and installed version/daemon/register/doctor/setup/send/receive smoke checks. Codex's real TOML parser preserved a credential path containing Korean characters and spaces. Runtime reports, credentials and release archives are ignored; ADRs and plugin manifests remain tracked. Git history still needs the publication review described in PUBLICATION-POLICY.md; this is not a claim of remote CI or publication.

Final independent review found two issues, both reproduced before fixing: equal nested kill deadlines could orphan a host, and Codex expired-token events failed to suppress later matrix calls. The matrix now allows ten seconds for lab cancellation/cleanup while inner hosts retain their one-second termination grace. Authentication fixtures cover message-only Codex 0.146 errors ([upstream schema limitation](https://github.com/openai/codex/issues/36562)) and OpenCode API 401 events without retaining messages. Regression tests verify the detached host exits and subsequent affected pairs are skipped.

Execution decisions: the app retained the previous directory name, so an ignored local Git worktree replaced native worktree creation; this requires explicit cleanup. OpenCode's lab isolates XDG state and requires an explicit model; global OAuth is unavailable there. Native resume/automatic wake remains outside this P0/P1 change, so it is not a complete autonomous scheduler. Claude/OpenCode live interoperability remains unverified until authentication and model prerequisites are satisfied. Remote CI and public publication remain pending the owner/account/history review, so local verification does not establish public availability.

After the review fixes, both Node 24 and Node 26 passed all 60 tests; type and repository checks passed again. No deferred minor review findings.

Local main integration: fast-forwarded through `8f9fd86`; merged-tree suite passed 60/60. External GitHub/npm publication was not performed.
