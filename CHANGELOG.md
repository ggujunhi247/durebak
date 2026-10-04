# Changelog

## 0.1.0-alpha.5 — 2026-10-04

- Add request-linked protected tasks with participant/delivery ACLs and dual request/task versions.
- Add immutable owner uploads and message-scoped private attachment handles, sharing previews and public-copy disclosure.
- Add immutable private result revisions, latest-revision completion and result-reference redaction until delivery.
- Add revision-bound self-reported verification evidence, author-specific supersession, failure/conflict reporting and revalidation after changes.
- Add bounded deterministic context bundles with full-source and attachment/message pagination references.
- Add one-shot CLI collaboration dashboard and shared HTTP/MCP status, distinguishing bridge contact from unknown host readiness.
- Preserve existing credentials, requests, previews, tasks and private sources through additive schema6→7→8→9 migrations.
- Regress hidden-evidence cursor loss, completion quota exhaustion, missing input references, terminal control escaping and deadline snapshot consistency.
- Validate 168 tests, type checks, package allowlist, independently installed package smoke and Linux/macOS feature CI.

Evidence remains self-reported; native automatic wake, browser UI and actual heterogeneous host execution remain outside verified support. Source version and GitHub delivery do not imply successful npm registry publishing.

## 0.1.0-alpha.4 — 2026-10-04

- Add private two-participant request conversations, fixed deadlines and versioned acceptance/result/termination.
- Retain cancellation and timeout notices independently of inbox pressure or pause; notice acknowledgement does not assert host stopping.
- Add session-scoped consumer checkpoints with monotonic observed cursors and compare-and-swap updates.
- Add optional 60-second sender-only sharing previews, original-body range reads and send-time payload/permission checks.
- Preserve existing credentials, messages and delivery cursors through additive schema4→5→6 migrations.
- Regress deadline races, oversized pages, skipped unobserved notices and atomic storage failure rollback; test real HTTP/MCP routes.

Protected request tasks/attachments, revision evidence and native automatic wake remain future work. Actual heterogeneous host execution is unverified.

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
