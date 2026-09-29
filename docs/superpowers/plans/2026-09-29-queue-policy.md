# Queue policy implementation plan

User requested built-in delayed/priority messaging rules. Existing specification supplies cooperative scope; docs/QUEUE-POLICY.md defines this increment. Prior uncommitted baseline and host-lab fixes must be preserved; commit/merge was initially blocked on Git author identity; the current environment now supplies a valid Git identity.

1. Add failing fake-clock store tests for normal batching, urgent reasoning/quota, busy/paused states, aging, leases, stale receipts, expiry, retry bounds, persistence and schema migration.
2. Implement queue policy helpers, SQLite v2 atomic migration and durable queue lifecycle. Preserve task/artifact contracts and token isolation.
3. Expose receive, queue_status, session_state and message_status via authenticated HTTP/MCP; queued bodies must not leak through old inbox/read/ack.
4. Update all real CLI/MCP fixtures and host-lab waiting to follow the queue; no unnecessary paid-model polling. Add actual HTTP/MCP coverage for default delayed messages.
5. Update usage/support docs. Run typecheck, tests, package checks and deterministic lab. Fresh review against queue invariants, fix substantive issues.

Review focus: duplicate lease across DB connections; cursor skipping delayed messages; priority starvation/urgent abuse; stale receipts/expiry; restart migration losing old messages; bodies leaking before eligibility; busy/paused policy bypass.

## Completed verification

All five implementation steps complete. Node 24/26: 30 tests passed; typecheck, package allowlist, repository scan, installed tarball smoke, and deterministic MCP lab passed. Fresh independent review found a retry-hint index issue and TTL contract mismatch; both fixed with regression coverage. The current environment now supplies a valid Git identity, allowing the requested local integration.
