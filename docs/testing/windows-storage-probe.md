# Windows storage investigation

This probe is investigation infrastructure, not Windows product support. The runtime retains its existing POSIX storage checks and native-host platform gates. It does not alter real credentials, existing data directories or user account configuration.

Run `node --test tests/windows-probe.test.mjs` on Windows, then `node scripts/windows-storage-probe.mjs` for the sanitized report. A non-Windows invocation returns `windows_required` and exit2 rather than fabricated evidence. GitHub's Windows runner is distinct from a Windows11 desktop installation.

The probe creates a unique synthetic directory with a Win32 creation-time security descriptor. It checks private files and rejects broad allow ACLs, null DACL, foreign ownership, a directory junction and hardlink aliases. SQLite is kept open while the main file, WAL and SHM security descriptors are observed. The report records whether these sidecars satisfy the proposed owner/ACL policy; merely observing all three files is not a security pass.

Public output excludes paths and user SIDs. `cross_user_access` and `desktop_validation` remain `not_tested`; `helper_delivery` remains `undecided`. Do not use a green probe job as proof of these missing gates. This uses runtime compilation exclusively for investigation; no helper, compiler or PowerShell requirement is added to the published product.

The launcher validates helper JSON before reporting it. It requires the complete set of unique investigation cases and boolean observations, emits only allowlisted fields, and converts malformed output into a bounded `probe_report_invalid` failure. Unexpected fields are discarded, including nested case metadata. Failure diagnostics also limit label length and omit raw exception text. These output checks run on every CI platform and alongside the real probe on Windows.

Further gates before implementing Windows storage support: actual access denial from a second nonprivileged user, file-replacement races, privilege-free foreign-owner fixtures, Windows11 x64 desktop validation, production helper delivery/integrity and package review. UNC/network shares and non-NTFS environments are outside the first support target. Job Object lifecycle and Provider permissions need independent investigation before Managed execution.

## What must change for Windows support

The first target is Windows 11 x64, Node 24 and a local NTFS data directory, running as a standard user. Cooperative CLI/HTTP/MCP support comes before Managed native execution. WSL is a separate Linux environment and does not establish Windows-native support.

| Area | Required implementation or evidence |
| --- | --- |
| Private storage | A Windows backend for creation-time DACLs, default token owner, handle-based owner/type/link checks and protected directories; retain the existing POSIX backend |
| SQLite | Check the main database and WAL/SHM/rollback journals before opening and during recovery; verify inheritance under a real standard-user token |
| Replacement | Reject unsafe aliases and validate object identity; the current controlled replacement test is not a concurrent race guarantee |
| Installation and paths | Test installed npm artifacts with spaces, Unicode, drive letters, case differences and `.cmd` launchers; explicitly refuse unsupported network/reparse storage |
| Cooperative behavior | Verify credential isolation, HTTP/MCP, replay/deduplication, deadlines, cancellation notices, restart recovery and revision validation on Windows |
| Managed execution | Separate Job Object lifecycle and process identity checks, plus provider file/tool/network restrictions; a Job Object alone is not a permission sandbox |

A packaged native helper or Node native addon can provide Win32 operations, but neither delivery mechanism is selected by this probe. A production implementation must avoid requiring end users to install a compiler, verify helper integrity, bound inputs/outputs and fail closed when inspection is unavailable. Removing the current unsupported-platform guard is the final step after these gates, not the starting point.

## Additional investigation

The synthetic root includes a space and Unicode characters. All creation, link and SQLite observations exercise that path. Exclusive creation must refuse an existing file without changing its content. A controlled rename-and-recreate must produce a different volume/file-index identity while leaving the old file intact. This only proves the identity primitive can observe a known replacement; security descriptor queries currently use paths and are not bound to the same open handle.

Four boolean observations compare the current user, default token owner, inherited file owner and SQLite owners. They disclose no SIDs. Windows assigns new object ownership from the token's default owner, while ACL inheritance comes from the parent directory. This distinction is a candidate explanation for elevated-runner observations and must be tested against actual output; it does not justify accepting a foreign owner or weakening the private-file policy. Token-owner equality is not a measurement of elevation, and this probe does not claim to run as a standard user.

Before enabling storage support, run an adapted investigation on a non-elevated Windows 11 installation and perform actual read/write denial tests from a second distinct nonprivileged account. The current foreign-owner creation fixture needs elevated rights: replace it with a privilege-free counterpart or a separately prepared second-account fixture before claiming a standard-user run. A descriptor check, a restricted token with the same user SID or an administrator runner cannot substitute for cross-user access denial. Tests here never create local accounts or change existing user data.

Primary references:

- [Microsoft file security and access rights](https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights)
- [Node process.geteuid](https://nodejs.org/api/process.html#processgeteuid)
- [Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
- [PowerShell module-path inheritance through intermediate processes](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_psmodulepath)
- [Microsoft default owner of a new object](https://learn.microsoft.com/en-us/windows/win32/secauthz/owner-of-a-new-object)
- [WindowsIdentity token owner](https://learn.microsoft.com/en-us/dotnet/api/system.security.principal.windowsidentity.owner)
- [Microsoft file identity information](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfileinformationbyhandle)
- [SQLite temporary and recovery files](https://www.sqlite.org/tempfiles.html)
- [Node Windows file-mode limitations](https://nodejs.org/docs/latest-v24.x/api/fs.html)

The probe pins `PSModulePath` to its selected Windows PowerShell installation. A PowerShell7 → Node → Windows PowerShell5 chain otherwise inherits incompatible shared module paths; the initial Windows CI exposed `CouldNotAutoloadMatchingModule` while querying ACLs. This is a probe launcher fix, not a relaxation of ACL policy.

Initial hosted-runner observations also found that an ordinary inherited file and SQLite sidecars did not satisfy the proposed current-user-owner policy (`inherited_file_private=false`, `sqlite_sidecars_private=false`). The private-file positive fixture uses creation-time explicit ownership, while inherited-file observations remain separate booleans. A protected parent DACL alone is therefore insufficient evidence for the entire production storage policy. Standard-user and elevated-token ownership must be tested separately before choosing a Windows backend.
