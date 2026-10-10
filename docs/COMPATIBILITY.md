# Compatibility

Status updated 2026-10-11. A generated configuration is not evidence of a live host integration.

| Component | Evidence | Status |
| --- | --- | --- |
| macOS runtime, Node 24 and 26 | Local tests and installed-package smoke | Locally verified |
| Linux, Node 24 | [Public CI](https://github.com/ggujunhi247/durebak/actions/runs/36610450906): full suite and installed-package smoke | CI verified |
| Codex CLI 0.146.0 | Generated-setup real Codex-to-Codex lab, separate identities, 10 MCP calls; isolated-profile TOML parser | Live communication verified; see testing reports |
| Claude Code 2.1.87 | Configuration generated; live API authentication expired | Experimental |
| OpenCode 1.18.33 | Temporary installation: effective config parser and permission/identity guard verified; not globally installed; model/API call not tested | Experimental |
| Windows | Hosted runner ACL/SQLite investigation passed; inherited file/sidecar private-access observations remain false; standard-user cross-user access and Windows 11 desktop validation pending | Unsupported for this alpha; storage refuses platforms without OS user identity before creation |
| Native resume / automatic wake | Not implemented | Unsupported |

The plugin is an optional skill bundle. MCP configuration and the runtime remain separate. Plugin marketplace installation, updates and uninstall have not been end-to-end verified. Do not present this as marketplace-published support.

Before a schema upgrade, stop the daemon and copy the entire private data directory to a private backup location. Preserve file modes. Try the new version on a copy first. To roll back, stop it and restore the pre-upgrade directory alongside the old binary; do not run an older binary against a newer schema. Each runtime rejects unsupported newer schemas. Schema 3 and later use delivery-order inbox cursors; reset old message-sequence cursors to zero.

## Heterogeneous matrix

Run `npm run lab:matrix` to probe installation and stored login evidence without calling models. Run `npm run lab:matrix -- --live --report /private/tmp/durebak-matrix.json` for sequential paid calls. Reports are created exclusively and never overwrite an existing file. Provide `--opencode-model provider/model` explicitly when testing OpenCode; optional `--codex-model` and `--claude-code-model` choose models independently of the harness.

All six directed pairs are represented. A pair passes only after the live lab verifies request identity, both acknowledgements, correlated correction, task ownership, exact nonce-bearing artifact and hash, cache reuse and zero-model record generation. Missing installations, expired authentication and unverified merged configuration remain blocked. Stored login evidence does not establish API access. Authentication failure blocks subsequent pairs using that harness.

On 2026-09-30 and again on 2026-10-01, Codex → Claude Code sent the request but Claude reported `authentication_failed`. The later attempt ran against a build advertising MCP server-wide instructions; Claude failed before any MCP tool call, so its use of those instructions was not verified. `claude auth status` reported logged in, but the model API call failed. Remaining Claude pairs were blocked without repeated API calls. OpenCode pairs were blocked because it is absent from the ordinary PATH. The isolated OpenCode binary was used for parser validation only. **No heterogeneous pair is claimed live-verified yet.**

The lab supports `--worker` and `--reviewer` for all three harnesses (`claude` remains an alias for `claude-code`). Scripted MCP mode is transport evidence only, even when harness names are passed. Each live invocation starts a new native session; the two worker invocations reuse a Durebak identity, not a native conversation.

OpenCode lab runs with `--pure`, isolated XDG directories and a verified effective MCP/permission configuration. It does not copy global OAuth credentials; configure API credentials in the process environment, never in committed files. Config mismatches block execution. Version changes require rechecking these CLI contracts. Each step has a 90-second deadline; Claude has a $1 per-invocation limit. Other hosts have no monetary limit enforced by this lab. Usage is the last reported event, not a total; missing fields are null and cache meanings differ by host. Raw conversations and local paths are excluded from reports.

## Windows investigation and alpha.23 maintenance

The [Windows storage probe](testing/windows-storage-probe.md) exercises synthetic ACL/owner/link rejection and observes SQLite descriptors. Its JSON output is validated and sanitized. A passing investigation job does not enable Windows runtime support. Production ACL handling, helper delivery, file replacement races and desktop validation remain outstanding. WSL is a separate Linux environment; no Windows-native support follows from Linux CI.

Alpha.23 updates the pinned MCP SDK from 1.30.1 to 1.32.1 to resolve [GHSA-6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h). The advisory concerns HTTP OAuth clients and excludes stdio clients/servers; Durebak currently uses stdio. This dependency update is not evidence of credential exposure. Database schema and protocol versions are unchanged.
