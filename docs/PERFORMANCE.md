# Queue polling performance

The alpha.22 queue maintenance and status summary queries project only the metadata needed for expiry, leases, retry hints and availability. They no longer materialize message body strings in JavaScript. SQLite may still read database record pages; this is not a claim that the storage engine never reads payload pages. Actual delivery still reads the selected message content, and auth, private-file checks, transactions, receipts, deadlines and cancellation maintenance remain unchanged.

## Reproduce

```sh
npm ci
npm run build
node scripts/benchmark-queue.mjs
```

The benchmark creates and deletes its own private synthetic SQLite directory, registers two synthetic sessions, enqueues 100 messages of 65,536 bytes, warms up with 30 status polls, then measures 300 status polls. It does not use actual conversations, host authentication or model calls. Compare revisions with the same runtime and machine; disk/cache state, background load and runtime differences affect results. Timings are observations, not CI thresholds or end-to-end/provider latency promises.

## Local observation — 2026-10-05

| Metric | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| p50 status call | 3.230666 ms | 2.442417 ms | 24.4% |
| p95 status call | 3.818875 ms | 2.971625 ms | 22.2% |

This comparison used Node26.8.1 on the same local machine, one sample set per revision. Supported-platform functional CI uses Node24. Do not generalize these timings to all queue sizes or machines.

A deterministic regression measures body bytes returned by real SQLite `all()` results during metadata polling and expiry. For three 64KiB messages, two status calls previously loaded 589,824 body bytes; optimized calls load zero body bytes into JavaScript while preserving queued counts, expiry counts and retry hints. Functional queue tests also cover availability, urgent quotas, leases, old receipts, backoff, dead letters, starvation, delayed ordering, audit cursors and restart/migration behavior.
