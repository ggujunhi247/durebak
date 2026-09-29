# Release runbook

The source repository is `ggujunhi247/durebak`. The npm package is prepared for its first public `alpha` publication. `publishConfig` fixes the public registry, access and default alpha channel; the private flag has been removed for this release candidate. Registry publication still requires authenticated npm access. Configuration readiness is not proof of a completed npm release.

## One-time setup

1. Confirm the GitHub owner, npm account/package name, public author identity and security reporting route. An npm 404 does not reserve the name. Use `gh auth login` and `npm login` locally; never send tokens in chat or commit them.
2. Review Git history and `npm run repo:check`, create the public repository, set its real remote, and add matching `repository.url`, `homepage`, `bugs` metadata. Enable private vulnerability reporting and branch protection after the first successful CI. Point SECURITY.md to the confirmed reporting route.
3. Configure the GitHub `npm` environment with required reviewers and deployment restrictions. Protect release tags against changes. Configure the npm trusted publisher for the exact owner/repo, workflow `release.yml`, environment `npm`. GitHub-hosted runners use Node 24 and npm 11.19.0; only the publish job receives `id-token: write`.
4. If npm requires an initial package before trusted publisher configuration, a maintainer must bootstrap with login/2FA using the reviewed exact tarball and `npm publish FILE.tgz --access public --tag alpha`. Do not rerun the workflow to publish that same version. After configuring OIDC, use a new version for the first automated publication. Never commit a long-lived npm token as a workaround.

## Each release

1. Create a release change with version, changelog, matching plugin versions, and public repository metadata. Remove `private` and set `publishConfig.access` to `public` only when publication is intended. Update the lockfile and run tests. Merge to main, then create the matching `vVERSION` tag.
2. Dispatch Release with that tag, matching channel (`alpha`, `beta`, `rc`, or stable `latest`), and **publish=false** first. Prereleases cannot use latest. The tagged commit must be on `origin/main`.
3. Inspect the run's `release` artifact, SHA256SUMS and smoke report. The workflow resolves one commit, tests it on macOS/Linux, packs once, verifies the same tarball on both platforms, and passes that exact artifact to publishing.
4. Dispatch with **publish=true** after the rehearsal. Each run produces its own verified artifact; inspect/approve the publishing run in the `npm` environment. Publishing rechecks tag/commit, main ancestry, private flag, repository, manifest and checksum before OIDC publication. GitHub release uses the same tag and includes the tarball and checksums.
5. Install the exact registry version in a fresh directory and repeat doctor/setup/send/receive. Confirm npm provenance and the GitHub prerelease. Record links and verification results. If npm succeeded but GitHub release creation failed, create the GitHub release with the retained artifact; do not republish npm or change the existing tag.

## Local rehearsal before accounts are available

```sh
npm ci
npm run check
npm test
npm run repo:check
npm run build
```

Create a temporary output directory, run `npm pack --ignore-scripts --pack-destination DIR`, then run both `node scripts/check-package.mjs --tarball DIR/FILE.tgz` and `node scripts/smoke-package.mjs --tarball DIR/FILE.tgz`. Their SHA-256 values must match. This tests packaging/installability, not registry ownership, OIDC, remote CI or Linux support.

For rollback, deprecate an affected version with a clear replacement rather than silently republishing. Restore a stopped runtime from its pre-upgrade private backup; see COMPATIBILITY.md. Exact published versions are immutable.

Official references: [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/), [npm distribution tags](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag/).

Workflow changes must also pass `actionlint` (CI pins 1.7.12 and verifies its archive checksum). YAML parsing alone does not validate GitHub event/input/job placement.
