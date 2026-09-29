# Public release readiness — 2026-09-29

Local preparation is implemented; external publication has not occurred.

## Evidence

- Node 24.21.0 and 26.8.1: 44/44 tests each; TypeScript checks pass.
- Clean committed checkout without dist/node_modules: npm ci, checks, build and 44 tests pass.
- Production npm audit: zero known vulnerabilities at test time.
- Exact tarball allowlist, missing module/altered manifest tests and installation smoke pass; see [rehearsal](2026-09-29-release-rehearsal.json).
- Generated settings used in real Codex CLI 0.146.0 exchange: 10 MCP calls, 11 persisted-evidence checks, no warnings; see [live report](2026-09-29-release-setup-live.json). Three native runs, two Durebak identities; no native resume or auto-wake claim.
- Generated Codex TOML parsed in an isolated CODEX_HOME, including paths containing spaces.
- Codex plugin validator, skill validator and Claude plugin validate pass.
- Fresh branch reviewer found a P1 release YAML job/input placement error. actionlint 1.7.12 reproduced it; after correction it passes for both workflows. CI now verifies the pinned actionlint archive checksum and checks workflow semantics. Entire 44-test suite rerun passes. No deferred minor findings.

## Decisions and remaining conditions

- Keep private=true and do not invent repository owner metadata while CLI login/owner confirmation is missing; publication remains blocked.
- Share one skill and dual host manifests under plugins/durebak. If host packaging requirements diverge, split the bundle then.
- Pretest builds dist so setup references a real distribution entry point; this adds a short compilation to test runs.
- Use manual per-session MCP configuration; Claude/OpenCode live tests and marketplace install/update/uninstall remain unverified. Manifests alone do not prove host communication.
- Remote macOS/Linux CI, npm namespace/bootstrap/OIDC/provenance, registry installation, public author identity/security contact and external user reproduction remain pending. Local macOS evidence does not establish Linux support.
- Migration/restart tests and documented backup steps do not constitute an end-to-end operator backup/restore drill. Keep that plan condition open before stable operation.

The release workflow is structurally validated locally, but only a real GitHub run can establish hosted behavior. [Runbook](../RELEASING.md) describes account setup and recovery from a partially successful publication.
