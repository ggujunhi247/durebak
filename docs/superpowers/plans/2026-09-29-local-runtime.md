# Durebak local runtime implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, test-driven-development, and one final fresh review.

**Goal:** Executable cooperative local session bus with CLI/MCP, durable results, bounded reads, reproducible records and public repository hygiene.

**Architecture:** TypeScript, Node >=24, SQLite WAL; authenticated loopback HTTP daemon per data directory. User CLI issues session credentials. MCP has fixed identity. No provider processes started.

**Spec:** ../specs/2026-09-29-durebak-design.md. This alpha is an independently usable milestone, not completion of the entire product vision.

## Global constraints

- Never publish, push or overwrite host MCP configuration automatically.
- Server-derived sender identity, workspace isolation, durable idempotency and acknowledgement distinct from completion.
- Immutable artifact hashes; stale task revisions rejected.
- Bounded queries, explicit cursors, no hidden model calls or claimed provider cache savings.
- Credentials, runtime files and local ledgers excluded from both Git and npm.
- No existing Git repository: build on a feature branch in an isolated temporary directory, copy reviewed source back to project.

## Review focus

1. Cross-workspace access or sender impersonation.
2. Duplicate/conflicting messages and restart data loss.
3. Double task claims or stale revision completion.
4. Unbounded output, cache mistaken for evidence, manually edited exports overwritten.
5. Secrets packed for distribution or unsupported host claims.

## Tasks

- [x] Scaffold strict TypeScript package, lockfile, ignore rules, package allowlist and CI.
- [x] RED/GREEN: SQLite store registry, token hashes, messages/replies/ack, tasks and immutable artifacts (src/store.ts, tests/store.test.ts).
- [x] RED/GREEN: loopback authenticated HTTP runtime/client with body limits and fixed identity (src/runtime.ts, src/client.ts, tests/runtime.test.ts).
- [x] RED/GREEN: administrative CLI and session-scoped MCP tools; real SDK subprocess integration (src/cli.ts, src/mcp.ts, tests/cli-mcp.test.ts).
- [x] RED/GREEN: bounded artifact reads, derived content-hash cache, deterministic records and conflict-safe export (tests/records.test.ts).
- [x] Document usage and actual support; run check, tests, build, actual package inspection and installed-package smoke. Fresh review, fix substantive findings.

## Verification

npm ci; npm run check; npm test; npm run build; npm run package:check. Integration tests use temporary private data directories, no paid model calls.

## Deferred contracts

Managed/Attached provider adapters, auto-wake, automatic workflow DAG and review gates, per-turn context epoch/delta accounting, provider usage normalization and remote hosts. Task completion records submitted results; it does not certify independent verification. Keep these limits visible in documentation.
