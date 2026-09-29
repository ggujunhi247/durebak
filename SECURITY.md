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

Before npm publication: confirm the package namespace, review the exact tarball, verify private reporting, pass the supported-platform CI matrix and complete the host integration checks required by the advertised support level. Public source availability does not imply production readiness or validated heterogeneous model communication. Public publish settings alone do not publish a package; the release still requires authenticated npm access and verification of the exact artifact.
