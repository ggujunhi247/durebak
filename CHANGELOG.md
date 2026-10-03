# Changelog

## 0.1.0-alpha.3 — 2026-10-04

- Add inactive harness research catalog and epoch-scoped MCP bridge health.
- Keep bridge contact, CLI activity and declared availability distinct.
- Add actionable doctor checks and schema 3→4 migration preserving original state.
- Handle multi-bridge, clock rollback, reconnect, revocation and EOF/signal cleanup.
- Clarify configuration fragments versus unverified native session isolation.
- Preserve MCP peer-data instructions and managed local paths from alpha.2.

Actual heterogeneous host execution and automatic native wake remain unverified.

## 0.1.0-alpha.2 — First public npm prerelease

- MCP initialization now supplies concise cross-session guidance; receive/read tool descriptions distinguish peer data from user authorization.
- Durebak skill and Codex/Claude manuals explain sender checks, refusals, acknowledgements and the native-versus-Durebak messaging boundary.

- CLI reports `unknown_command` before requesting a session for unknown commands.
- Malformed `call --json` or `--input` content reports `invalid_json` without exposing input.
- Regression coverage for three-session queue handling, runtime restart, task ownership, revocation and protected record exports.

## 0.1.0-alpha.1 — Tagged source snapshot, not published to npm

- New installations default to ~/.durebak, preserving explicit paths and legacy databases.
- Managed session credentials and immutable Markdown record snapshots when --out is omitted; paths command for discovery.

- Local authenticated runtime and per-session MCP connections.
- Durable priority queues, delivery leases, receipt acknowledgements and bounded retries.
- Tasks, content-addressed artifacts and explicit Markdown records.
- Session-specific host configuration with `setup` and connection diagnostics with `doctor`.
- Exact-tarball installation checks and guarded release workflow.

Native session resume and automatic wake are not supported. Back up a stopped runtime before upgrading; use a separate data directory for alpha trials.
