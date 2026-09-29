# Publication security verification — 2026-09-30

Scope: source publication, ignored private files, secret scanning and release gates; not a complete runtime security audit.

- Official Gitleaks 8.30.1 archive verified against the release SHA-256.
- Public local Git history, preserved private development history, candidate working files and the prepared npm tarball: no leaks detected.
- Repository regression tests reject force-added ignored files and personal machine paths while preserving plugin manifests and synthetic fixtures.
- Actual-scanner self-tests reject uncommitted secrets, staged secrets hidden by clean working edits, and deleted historical secrets. Synthetic credential values are generated temporarily and output is checked for redaction.
- Review found the staged-only gap; a failing reproduction preceded the dedicated staged scan fix.
- CI checks full fetched history and candidate files. Release artifact creation depends on the reusable secret gate. The local pre-push hook provides an additional check before upload.
- Raw reports, credentials and local paths are excluded from this record. Pattern scans are not proof of absence; publication still requires diff and tarball review.
