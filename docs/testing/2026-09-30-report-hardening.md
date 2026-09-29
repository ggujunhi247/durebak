# Report hardening recheck — 2026-09-30

Baseline: 60 tests passed before changes. Additional failure cases reproduced two defects:

- Authentication failures were overwritten by subsequent generic shutdown errors, losing the reason needed to block repeated calls. Authentication now remains authoritative for Codex, Claude Code and OpenCode.
- Matrix aggregation could accept contradictory checks, or throw on malformed report/check structures. A passing report now requires the expected live identities, every required check, unique check names and all reported checks strictly true. Invalid top-level evidence fails its pair without aborting the remaining matrix.

Regression cases were observed failing before implementation and passing after it. Node 24 and Node 26 each passed 69 tests including subtests. Type checks, repository hygiene and the 45-file package allowlist passed. The real two-process scripted MCP round trip passed all 11 persisted checks. The six-pair default probe remained blocked; no new model API calls were made or heterogeneous live success claimed. Existing compatibility limitations still apply.

An independent read-only review of the code and regression tests found no actionable issues. This change affects the source-repository lab/report helpers, not the runtime protocol or queue policy. The packaged artifact remains unchanged (SHA-256: 6e4c33cb5ff733cbc5ca0200f9068c027de441433c92606fd22811d82b54a9d9).
