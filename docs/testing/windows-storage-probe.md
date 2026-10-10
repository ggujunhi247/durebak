# Windows storage investigation

This probe is investigation infrastructure, not Windows product support. The runtime retains its existing POSIX storage checks and native-host platform gates. It does not alter real credentials, existing data directories or user account configuration.

Run `node --test tests/windows-probe.test.mjs` on Windows, then `node scripts/windows-storage-probe.mjs` for the sanitized report. A non-Windows invocation returns `windows_required` and exit2 rather than fabricated evidence. GitHub's Windows runner is distinct from a Windows11 desktop installation.

The probe creates a unique synthetic directory with a Win32 creation-time security descriptor. It checks private files and rejects broad allow ACLs, null DACL, foreign ownership, a directory junction and hardlink aliases. SQLite is kept open while the main file, WAL and SHM security descriptors are observed. The report records whether these sidecars satisfy the proposed owner/ACL policy; merely observing all three files is not a security pass.

Public output excludes paths and user SIDs. `cross_user_access` and `desktop_validation` remain `not_tested`; `helper_delivery` remains `undecided`. Do not use a green probe job as proof of these missing gates. This uses runtime compilation exclusively for investigation; no helper, compiler or PowerShell requirement is added to the published product.

Further gates before implementing Windows storage support: actual access denial from a second nonprivileged user, file-replacement races, privilege-free foreign-owner fixtures, Windows11 x64 desktop validation, production helper delivery/integrity and package review. UNC/network shares and non-NTFS environments are outside the first support target. Job Object lifecycle and Provider permissions need independent investigation before Managed execution.

Primary references:

- [Microsoft file security and access rights](https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights)
- [Node process.geteuid](https://nodejs.org/api/process.html#processgeteuid)
- [Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
- [PowerShell module-path inheritance through intermediate processes](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_psmodulepath)

The probe pins `PSModulePath` to its selected Windows PowerShell installation. A PowerShell7 → Node → Windows PowerShell5 chain otherwise inherits incompatible shared module paths; the initial Windows CI exposed `CouldNotAutoloadMatchingModule` while querying ACLs. This is a probe launcher fix, not a relaxation of ACL policy.
