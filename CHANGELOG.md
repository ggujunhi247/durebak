# Changelog

## 0.1.0-alpha.21 — 2026-10-05

- Refuse database directories owned by another effective OS user, including final symlinks with a trailing slash.
- Validate the database and existing WAL/SHM/rollback journals before SQLite opens: regular owner-private files, current effective UID and a single hardlink. Recheck generated sidecars before migration and after initialization.
- Preserve unsafe files unchanged instead of silently changing permissions or deleting recovery data. Normal private WAL reopening and concurrent connections remain supported. These checks do not isolate processes sharing an OS account.

## 0.1.0-alpha.20 — 2026-10-05

- Recheck the live OpenCode driver and owner after asynchronous observation, including cancellation; reject closure instead of reading a closed ledger or returning stale outcomes after owner loss.
- Cover cached prepared and terminal observation races without model calls or native replay. Native controller/model authority and automatic wake remain unverified.
- Reconcile the README and missing alpha.17–alpha.19 history with the delivered source and verification limits.
- Generate new GitHub release notes from the exact tagged version section; reject missing, empty or duplicate notes while preserving existing release asset retries.

## 0.1.0-alpha.19 — 2026-10-05

- Limit Codex ledger connection retirement to attempts created by that connection; closing an observer or a refused submitter preserves another driver's prepared, submitting and running attempts.
- Preserve uncertain outcomes on submitting/running driver close and reject late receipts without native replay, interrupt or resume.
- Verify 477 passing tests with two skips, Linux/macOS CI and installed GitHub artifacts. Native model execution, controller integration and automatic wake remain unverified.

## 0.1.0-alpha.18 — 2026-10-05

- Add bounded asynchronous readiness to the internal mock execution controller; recheck ownership, policy, source revision, cancellation and deadline after awaiting readiness and before submission.
- Preserve observational intent replay, prevent duplicate reservation charges and submissions, and fail closed on rejected, timed-out or late readiness.
- Wait through transient process-group inspection uncertainty in macOS cleanup tests while still requiring confirmed disappearance. Native controller authority and actual model execution remain unverified.

## 0.1.0-alpha.17 — 2026-10-05

- Retain confirmed owned-process-group disappearance in Codex and OpenCode host cleanup; never inspect or signal that numeric group again during retry or escalation because it may be reused.
- Keep ownership fenced until stdio and helper cleanup also complete; permission-denied inspection remains uncertain and requires explicit recovery.
- Cover inherited pipes, retained disappearance and reused group identifiers with regression tests. Actual model execution, native controller integration and automatic wake remain unverified.

## 0.1.0-alpha.16 — 2026-10-05

- Verify the owned child's birth identity and exact accepted loopback TCP tuple with parent-only macOS kernel inspection before sending any HTTP bytes; hand that same stream to a request-local Agent.
- Keep authentication fenced during bounded read-only acceptance checks, socket failure, deadline and close; each subsequent connection requires fresh verification and no HTTP replay occurs.
- Bound inspector concurrency and output, validate private helper staging, and confirm compiler/helper process-group disappearance plus stdio close before cleanup; uncertain cleanup retains an explicit retry handle.
- Reject a replacement listener without disclosing HTTP authentication or payload. Keep native model execution, provider auth/network, controller integration and automatic wake unverified.

## 0.1.0-alpha.15 — 2026-10-05

- Add a fresh owned OpenCode1.18.34 factory with clean private environment, pre-spawn macOS boundary and ownership fence before native bootstrap.
- Wait for the owned child to announce its fixed listener before sending Basic authentication; reject listener conflicts, bounded-output violations and a global bootstrap deadline.
- Create a selected-model build session with fixed deny-all permission and owner marker; verify exact single-session scope, empty history, idle status and no MCP connections, including readiness rechecks.
- Confirm process-group disappearance and pipe close before releasing ownership; unknown cleanup remains fenced and cannot be automatically adopted.
- Installed official host bootstrap and cleanup pass without model calls, credential copies or existing resume. Provider network/auth, model-tool authority, controller/deadline integration and heterogeneous model exchanges remain unverified; no automatic wake is enabled.

## 0.1.0-alpha.14 — 2026-10-05

- Add an internal experimental macOS command compiler that applies a deny-default OS boundary before native configuration bootstrap, with selected private input/runtime roots and a separate owner profile.
- Reject overlapping roots, unsafe staged trees and pre-existing hardlink aliases; require caller-controlled staging and immediate pre-spawn revalidation.
- Explicitly deny special process-info/sysctl operations and verify kernel process-environment denial against a clean synthetic unsigned process with a successful unsandboxed control.
- Installed OpenCode1.18.34 passed the compiled policy non-model probe and process-group cleanup. External provider network, actual model tool scope, owned-host/controller integration and automatic wake remain required gates.

## 0.1.0-alpha.13 — 2026-10-04

- Check exact OpenCode session status before submission; Durebak refuses another submission while busy/retry even after a terminal ledger result.
- Distinguish configured model, connection presence, native readiness, unknown authentication and unverified entitlement without exposing provider configuration or retry messages.
- Require matching running assistant evidence and native busy/retry state before spending a session-wide cancellation.
- Installed OpenCode1.18.34 non-model readiness checks pass. Owned-host startup isolation, controller integration and actual heterogeneous model execution remain required gates.

## 0.1.0-alpha.12 — 2026-10-04

- Add an internal private OpenCode intent/receipt ledger bound to a live owner, exact source and native session, with no automatic replay after response loss.
- Distinguish HTTP acknowledgement from exact native input acceptance and preserve immutable bounded answer snapshots for the same live owner.
- Preserve pending cancellation until a matching running assistant is observed; fence following input while a session-wide abort is in flight or its response is uncertain.
- Validate 373 regression tests and installed OpenCode1.18.34 non-model ledger contact. Actual native model cancellation, heterogeneous model execution, controller integration and automatic wake remain unverified.

## 0.1.0-alpha.11 — 2026-10-04

- Add internal OpenCode outcome observation bound to exact session, parent message and selected model; provider errors, ambiguous replies and tool-bearing candidates cannot be reported as successful answers.
- Add a bounded loopback HTTP transport with private in-memory Basic authentication, fixed input directory, wall-clock deadlines and no automatic POST retry.
- Strengthen Codex bootstrap refusal tests with explicit stage evidence and a delayed-start regression, preserving production timeout and ownership rules.
- Installed OpenCode1.18.34 non-model transport and skill discovery checks pass. The synthetic free-model attempt returned APIError403; actual heterogeneous model execution and automatic native wake remain unverified.

## 0.1.0-alpha.10 — 2026-10-04

- Preserve exact completed native Codex answers as immutable profile-local snapshots with source identity, item identity and SHA-256 evidence.
- Add bounded UTF-8 result reads and additive private ledger migration while rejecting ambiguous, conflicting or stale-owner answers.
- Validate 323 regression tests. Actual model collaboration and automatic native wake remain unverified; this release provides internal result collection foundations.

## 0.1.0-alpha.9 — 2026-10-04

- Add an internal durable native Codex turn ledger with exact receipts, stop intent and unknown reconciliation; transport fixtures cover cancellation and response loss.
- Add a fresh owned Codex host factory with private configuration checks, scoped command canaries and process-group shutdown before ownership release.
- Cover descendants retaining pipes or ignoring graceful termination, including unexpected leader exit.
- Deliver verified GitHub release assets independently of npm publisher authentication while preserving single-pack integrity and immutable retry checks.
- Installed Codex 0.146.0 non-model checks pass. Actual model collaboration, automatic wake and other native provider execution remain unverified.

## 0.1.0-alpha.8 — 2026-10-04

- Add bounded internal Codex app-server RPC framing, request limits and fail-closed transport handling.
- Add private canonical-profile ownership with an uninterrupted process lock, durable native identity and unknown state after holder loss. Existing records cannot be automatically adopted.
- Cover metadata commit races, blocked inspection, process crashes and unsafe profile paths with regression tests.
- Verify the internal RPC and ownership fence against an isolated installed Codex host without model turns, credential copying or existing-session resume. Native model collaboration and automatic wake remain unverified.

## 0.1.0-alpha.6 — 2026-10-04

- Add shared collaboration skills for Codex, Claude Code and OpenCode, with an OpenCode command and a credential-free project installer.
- Add explicit session onboarding, bounded full-source reads, sharing previews, acceptance, cancellation and revision-aware verification guidance.
- Add administrator-managed runtime-local native bindings, owner leases and disabled-by-default policies with durable expiry and clock rollback protection.
- Add internal complete work-input preparation with private attachment validation, revision evidence and queued request-prefix context.
- Preserve existing sessions and private requests through the additive schema9→10 migration.
- Validate 198 regression tests, six-direction three-session MCP exchanges, installed package skill reuse and Codex 0.146.0 skill discovery without model execution.

Managed execution, atomic work reservation and automatic native wake remain future work. Claude Code/OpenCode native skill discovery and actual heterogeneous model execution remain unverified. GitHub delivery and npm registry publication are tracked separately.

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
