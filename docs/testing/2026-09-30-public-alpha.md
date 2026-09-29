# Public source alpha — 2026-09-30

Repository: https://github.com/ggujunhi247/durebak

- Public Apache-2.0 source alpha; npm remains unpublished and package.json private remains true.
- Initial public commit contains all 111 reviewed source files with a fresh history and GitHub noreply author identity. Prior development history remains local and was not pushed.
- Current files and historical source blobs were checked for credential and private-path patterns; this is a review aid, not a proof of absence. Credentials, generated configurations, reports and local backups were excluded.
- Local tests: 69 passed. The same 45-file tarball passed module/allowlist checks and installed-package smoke.
- [Initial remote CI](https://github.com/ggujunhi247/durebak/actions/runs/36610450906) succeeded: workflows, verify (ubuntu-latest, 24), verify (macos-latest, 24). Each platform ran installation, repository/type/test/package checks and production dependency audit.
- GitHub private vulnerability reporting is enabled; see SECURITY.md.
- Codex-to-Codex live evidence remains valid. Claude/OpenCode heterogeneous model communication is not newly verified by publishing the repository or passing CI.

Use the source installation in README.md. npm publication and a registry version are separate future work.
