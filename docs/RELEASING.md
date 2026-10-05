# Release runbook

The source repository is `ggujunhi247/durebak`. [durebak@0.1.0-alpha.2](https://www.npmjs.com/package/durebak/v/0.1.0-alpha.2) is the first public npm release. It was bootstrapped with account 2FA from the verified tarball in the [GitHub prerelease](https://github.com/ggujunhi247/durebak/releases/tag/v0.1.0-alpha.2); that manual publication has no OIDC provenance. Configure the npm trusted publisher before the next automated release.

## One-time setup

1. Confirm the GitHub owner, npm account/package name, public author identity and security reporting route. An npm 404 does not reserve the name. Use `gh auth login` and `npm login` locally; never send tokens in chat or commit them.
2. Review Git history and `npm run repo:check`, create the public repository, set its real remote, and add matching `repository.url`, `homepage`, `bugs` metadata. Enable private vulnerability reporting and branch protection after the first successful CI. Point SECURITY.md to the confirmed reporting route.
3. Configure the GitHub `npm` environment with required reviewers and deployment restrictions. Protect release tags against changes. In the npm package's Settings → Trusted publishing, choose GitHub Actions with owner **ggujunhi247**, repository **durebak**, workflow filename **release.yml**, environment **npm**, and allow direct `npm publish`. The trusted identity is `release.yml`, not the tag-trigger dispatcher. GitHub-hosted runners use Node 24 and npm 11.19.0; only the publish job receives `id-token: write`. Initial account login/2FA is needed to establish this trust; subsequent OIDC publications do not require local `npm login` or a saved npm token.
4. The initial package was published with login/2FA using the reviewed exact tarball and `npm publish FILE.tgz --access public --tag alpha`. Do not rerun the workflow to publish that same version. After configuring OIDC, use a new version for the first automated publication. Never commit a long-lived npm token as a workaround.

## Each release

1. Create a release change with version, changelog, matching plugin versions, and public repository metadata. Remove `private` and set `publishConfig.access` to `public` only when publication is intended. Update the lockfile and run tests. Merge to main, then create the matching `vVERSION` tag.
2. Pushing a new supported `vVERSION` tag starts **Release tag**, which dispatches **Release** on `main` with publishing enabled. Supported channels are derived from `-alpha.N`, `-beta.N`, `-rc.N`, or a stable version (`latest`); invalid tags stop. The tagged commit must be on `origin/main`. The dispatcher keeps publication on `main` so the existing environment restriction applies. Tags pushed with a workflow's ordinary `GITHUB_TOKEN` do not trigger another push workflow; in that case dispatch Release explicitly. Manual **publish=false** remains available for a rehearsal.
3. Inspect the run's `release` artifact, SHA256SUMS and smoke report. The workflow resolves one commit, tests it on macOS/Linux, packs once, verifies the same tarball on both platforms, and passes that exact artifact to publishing.
4. Inspect/approve the npm publishing job in the `npm` environment after its tests, scans and artifact smoke checks pass. This approval applies only to npm publication; automatic triggering does not bypass it. The independent GitHub release job can deliver the verified assets while npm approval is pending or npm publication fails. Manual dispatch with **publish=true** is also available. Publishing rechecks tag/commit, main ancestry, private flag, repository, manifest and checksum before OIDC publication. Registry metadata and downloaded tarball bytes must match the verified artifact. Existing matching versions skip `npm publish`; mismatches, authentication errors and registry outages stop the run. The independent GitHub job revalidates the same tag and artifact and includes the tarball and checksums. New GitHub releases use only the exact version section in CHANGELOG.md; missing, empty or duplicate sections stop note generation. Existing assets and release notes are not silently replaced on retry. Correct historical release text separately after reviewing it.
5. For OIDC releases, confirm npm provenance and inspect dist-tags; confirm the GitHub prerelease for every prerelease. Record links and verification results. Check npm and GitHub results separately: GitHub delivery does not prove registry publication. An npm retry verifies the immutable registry artifact; a GitHub retry does not depend on npm success. Existing GitHub assets must match byte-for-byte; missing assets are uploaded without replacing existing files. A different artifact requires investigation, not republishing or moving the tag.

The first tag using these helpers must include the automation changes. Existing alpha.2/alpha.3 tags remain immutable and cannot acquire new scripts. The workflow supports publishing retries, but it never silently repairs or moves a dist-tag to an older version. The local regression tests and CI cannot establish npm trust: first successful OIDC publication and provenance verification are separate deployment evidence.

## First-publication registry behavior

The alpha.2 registry tarball matched the CI artifact byte-for-byte (SHA-256 `f2819860603a80826a21edb48932a16106f0ac92656b319e2aa0f7707b493cc1`), and `npx --yes durebak@alpha --help` passed in a fresh directory. On this first publication npm assigned both `alpha` and `latest` to alpha.2 despite `--tag alpha`; removing `latest` returned HTTP 400. Do not publish a dummy stable version to work around this. Users should select `@alpha` or an exact version, and maintainers should inspect dist-tags after each release.

## Local rehearsal

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

## Recovering an interrupted publication

A successful website login is not proof of CLI authentication. Check `npm whoami --registry=https://registry.npmjs.org` before publishing. If the web login process fails, start a new `npm login --auth-type=web` and finish its CLI authorization; never copy credentials into issues or chat.

If npm rejects publication because 2FA is required, configure 2FA in the account settings and complete any subsequent publish authorization directly through npm. Do not disable 2FA or create a bypass token to work around this gate. Authentication failure does not mean a version was published: inspect `npm view durebak@VERSION version` before retrying. A network timeout is ambiguous; verify registry state first.

Retain the successful rehearsal's `release` artifact and its checksum. Revalidate the tag, main ancestry and tarball checksum before publishing that exact artifact. Never move an existing version tag to include later documentation edits. If product/package changes are needed, create a new version and rehearsal. After publication, download the registry tarball, compare it with the released artifact, and repeat the installed-package smoke test.

## Repository controls

Release tags matching `v*` are protected against updates and deletion. The GitHub `npm` environment requires repository-owner review and accepts workflow runs from `main`. Dispatch Release from `main` with the version tag supplied as its input. These GitHub controls do not configure npm trusted publishing; the npm package must separately trust this repository, `release.yml`, and environment `npm` before automated publication can work. The initial authenticated bootstrap is a separate path and does not establish OIDC provenance.
