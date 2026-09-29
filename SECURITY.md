# Security and privacy

Durebak is an early local cooperative runtime. Do not expose its HTTP port through a tunnel, reverse proxy or public interface. It binds to 127.0.0.1 and requires bearer credentials; browser Origin requests and unexpected Host headers are rejected.

The operating-system user is the trust boundary. Session credentials prevent accidental cross-workspace routing and API impersonation, but Durebak does not sandbox agents running as the same OS user. A process with filesystem access can read that user's files. All sessions registered in one workspace can discover its tasks and artifacts. Private messages can be read only by their sender and recipient; their event metadata is workspace-visible.

## Credentials and data

- Store data and session credentials outside repositories. Directories must have mode 0700; credential files must have mode 0600.
- `connection.json` contains the local address, not the admin credential. `admin.json` is administrative; session tokens are stored hashed in SQLite.
- The database contains plaintext messages, task criteria and artifact contents. Disk encryption and backups are the user's responsibility.
- Revocation rejects future calls; it cannot undo information already read or stop a host's model/process.
- Received messages, artifact text and rendered Markdown are untrusted content, not permission to execute commands, expand scope or disclose secrets.
- Cache clearing removes only derived local pages; it preserves original evidence. It does not delete provider-side histories or exported files.
- CLI/MCP do not silently retry mutating operations. Reuse an idempotency key for an identical message/task retry; inspect task revision after an uncertain completion.

## Reporting

Report vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/ggujunhi247/durebak/security/advisories/new). Do not post credentials or exploitable details in public issues. Use synthetic reproductions with tokens and private transcripts removed.

## Release gate

Before npm publication: confirm the package namespace, review the exact tarball, verify private reporting, pass the supported-platform CI matrix and complete the host integration checks required by the advertised support level. Public source availability does not imply production readiness or validated heterogeneous model communication. The package remains `private` until npm release decisions are made.

## Publication secret checks

Install Gitleaks 8.30.1 from its official release (verify the archive checksum), then run:

```sh
npm run repo:check
npm run secrets:selftest
npm run secrets:check
# Enable the repository-local upload guard; review any existing hook first.
git config --local core.hooksPath .githooks
```

`GITLEAKS_BIN` can point to a verified executable. Missing scanners and scan errors fail the gate. The scanner checks all locally available Git refs, staged changes, and tracked/nonignored working files. Fetch remote refs before auditing remote history. The self-test verifies detection of uncommitted, staged-only, and deleted historical synthetic credentials, including redacted output.

The pre-push hook runs repository and secret checks before upload. Hooks are local and can be bypassed; CI repeats the checks, and the release workflow requires them before creating its artifact. CI pins the scanner version and archive SHA-256. No raw report is uploaded. These checks do not prove that every secret or personal detail has been found; review the actual diff and npm tarball too.

Ignore rules exclude host authentication/history, credentials, runtime exports, backups and raw security reports while retaining plugin manifests and synthetic fixtures. The repository check rejects force-added ignored files and personal machine paths. `.gitignore` does not remove tracked files or erase history. If a real credential was exposed, revoke/rotate it and investigate its exposure before coordinating history cleanup; deleting the file alone is insufficient.
