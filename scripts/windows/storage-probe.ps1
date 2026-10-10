param([Parameter(Mandatory=$true)][string]$NodeExecutable)
$ErrorActionPreference = 'Stop'
# Fixed synthetic probe. Never accepts an existing directory or credential path.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class DurebakProbe {
 [StructLayout(LayoutKind.Sequential)] struct SA { public int length; public IntPtr descriptor; public int inherit; }
 [StructLayout(LayoutKind.Sequential)] public struct Info {
  public uint attributes, creationLow, creationHigh, accessLow, accessHigh, writeLow, writeHigh;
  public uint volume, sizeHigh, sizeLow, links, indexHigh, indexLow;
 }
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string text,uint revision,out IntPtr descriptor,out uint size);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateDirectory(string path,ref SA attributes);
 [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr pointer);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFile(string path,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
 [DllImport("kernel32.dll",EntryPoint="CreateFileW",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreatePrivateFileNative(string path,uint access,uint share,ref SA security,uint creation,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle,out Info info);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern bool CreateHardLink(string link,string target,IntPtr security);
 public static void CreatePrivateDirectory(string path,string sddl) {
  IntPtr pointer; uint size;
  if(!ConvertStringSecurityDescriptorToSecurityDescriptor(sddl,1,out pointer,out size))throw new Win32Exception();
  try {var sa=new SA {length=Marshal.SizeOf(typeof(SA)),descriptor=pointer};if(!CreateDirectory(path,ref sa))throw new Win32Exception();}
  finally {LocalFree(pointer);}
 }
 public static Info Identity(string path) {
  using(var handle=CreateFile(path,0,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero)) {
   if(handle.IsInvalid)throw new Win32Exception();Info info;
   if(!GetFileInformationByHandle(handle,out info))throw new Win32Exception();return info;
  }
 }
 public static void CreatePrivateFile(string path,string sddl) {
  IntPtr pointer; uint size;
  if(!ConvertStringSecurityDescriptorToSecurityDescriptor(sddl,1,out pointer,out size))throw new Win32Exception();
  try {
   var sa=new SA {length=Marshal.SizeOf(typeof(SA)),descriptor=pointer};
   using(var handle=CreatePrivateFileNative(path,0x40000000,0,ref sa,1,0x80,IntPtr.Zero)) {if(handle.IsInvalid)throw new Win32Exception();}
  } finally {LocalFree(pointer);}
 }
}
'@
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$sddl="O:${sid}G:${sid}D:P(A;OICI;FA;;;${sid})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)"
$root=Join-Path ([System.IO.Path]::GetTempPath()) ('durebak-win-probe-'+[guid]::NewGuid().ToString('N'))
$cases=New-Object System.Collections.Generic.List[object]
function Record([string]$id,[bool]$passed) { $cases.Add([pscustomobject]@{id=$id;passed=$passed}) }
function IsPrivate([string]$path,[bool]$directory=$false) {
 $script:stage='identity_query'
 $identity=[DurebakProbe]::Identity($path)
 if(($identity.attributes -band 0x400) -ne 0){return $false}
 if((($identity.attributes -band 0x10) -ne 0) -ne $directory){return $false}
 if(!$directory -and $identity.links -ne 1){return $false}
 $script:stage='acl_query'; $acl=Get-Acl -LiteralPath $path
 $script:stage='owner_query'
 if($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid){return $false}
 $script:stage='descriptor_decode'; $raw=[System.Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(),0)
 $script:stage='ace_inspection'
 if($null -eq $raw.DiscretionaryAcl -or $raw.DiscretionaryAcl.Count -eq 0){return $false}
 foreach($ace in $raw.DiscretionaryAcl){
  if($ace -isnot [System.Security.AccessControl.CommonAce] -or $ace.IsCallback){return $false}
  if($ace.AceQualifier -ne [System.Security.AccessControl.AceQualifier]::AccessAllowed){return $false}
  if($ace.SecurityIdentifier.Value -notin @($sid,'S-1-5-18','S-1-5-32-544')){return $false}
 }
 return $true
}
try {
 $stage='atomic_private_directory'
 [DurebakProbe]::CreatePrivateDirectory($root,$sddl)
 $stage='inspect_private_directory'
 Record 'atomic_private_directory' (IsPrivate $root $true)
 $stage='private_file'; $private=Join-Path $root 'private.txt'
 [System.IO.File]::WriteAllText($private,'synthetic')
 $inheritedFilePrivate=IsPrivate $private
 [System.IO.File]::Delete($private)
 [DurebakProbe]::CreatePrivateFile($private,$sddl)
 [System.IO.File]::WriteAllText($private,'synthetic')
 Record 'private_file' (IsPrivate $private)
 $stage='broad_allow'; $broad=Join-Path $root 'broad'
 [DurebakProbe]::CreatePrivateDirectory($broad,"O:${sid}G:${sid}D:P(A;OICI;FA;;;${sid})(A;OICI;FR;;;WD)")
 Record 'broad_allow_rejected' (!(IsPrivate $broad $true))
 $stage='null_dacl'; $nullDacl=Join-Path $root 'null-dacl'
 [DurebakProbe]::CreatePrivateDirectory($nullDacl,"O:${sid}G:${sid}D:NO_ACCESS_CONTROL")
 Record 'null_dacl_rejected' (!(IsPrivate $nullDacl $true))
 $stage='foreign_owner'; $foreign=Join-Path $root 'foreign'
 # Administrators ownership is distinct from the actual token user SID.
 [DurebakProbe]::CreatePrivateDirectory($foreign,"O:BAG:${sid}D:P(A;OICI;FA;;;${sid})(A;OICI;FA;;;BA)")
 Record 'foreign_owner_rejected' (!(IsPrivate $foreign $true))
 $stage='junction'; $junction=Join-Path $root 'junction'
 New-Item -ItemType Junction -Path $junction -Target $broad | Out-Null
 Record 'junction_rejected' (!(IsPrivate $junction $true))
 # Remove the alias itself; never recursively traverse a junction during cleanup.
 [System.IO.Directory]::Delete($junction)
 $stage='hardlink'; $hardlink=Join-Path $root 'hardlink.txt'
 if(![DurebakProbe]::CreateHardLink($hardlink,$private,[IntPtr]::Zero)){throw 'hardlink_fixture_failed'}
 Record 'hardlink_rejected' (!(IsPrivate $hardlink) -and !(IsPrivate $private))
 [System.IO.File]::Delete($hardlink)
 $stage='sqlite'; $nodeScript=Join-Path $root 'sqlite-probe.cjs'
 $observerScript=Join-Path $root 'observe-sidecars.ps1'
 [System.IO.File]::WriteAllText($observerScript,@'
param([string]$DatabaseFile)
$ErrorActionPreference='Stop'
$rows=@(foreach($p in @($DatabaseFile,($DatabaseFile+'-wal'),($DatabaseFile+'-shm'))){
 $acl=Get-Acl -LiteralPath $p
 [pscustomobject]@{exists=(Test-Path -LiteralPath $p);sddl=$acl.Sddl}
})
ConvertTo-Json -Compress -InputObject $rows
'@)
 $javascript=@'
const {DatabaseSync}=require('node:sqlite');
const {join}=require('node:path');
const {spawnSync}=require('node:child_process');
const file=join(process.argv[2],'probe.sqlite');
const db=new DatabaseSync(file);
try {
 db.exec('PRAGMA journal_mode=WAL;CREATE TABLE probe(id INTEGER);INSERT INTO probe VALUES(1)');
 const result=spawnSync(process.argv[3],['-NoLogo','-NoProfile','-NonInteractive','-File',process.argv[4],'-DatabaseFile',file],{encoding:'utf8',timeout:10000});
 if(result.status!==0)process.exitCode=1;else process.stdout.write(result.stdout);
} finally {db.close();}
'@
 [System.IO.File]::WriteAllText($nodeScript,$javascript)
 $powershell=Join-Path $PSHOME 'powershell.exe'
 $stage='sqlite_child'
 $rowsText=& $NodeExecutable --no-warnings $nodeScript $root $powershell $observerScript
 if($LASTEXITCODE -ne 0){throw 'sqlite_fixture_failed'}
 # Windows PowerShell5 emits a JSON array as one pipeline item. Assign the
 # decoded value directly so foreach sees the three descriptors individually.
 $stage='sqlite_json'; $rows=ConvertFrom-Json -InputObject ($rowsText -join '')
 Record 'sqlite_sidecars_observed' ($rows.Count -eq 3 -and @($rows | Where-Object {!$_.exists}).Count -eq 0)
 $sidecarsPrivate=$true
 foreach($row in $rows){
  $stage='sqlite_descriptor_decode'
  $raw=[System.Security.AccessControl.RawSecurityDescriptor]::new($row.sddl)
  if($raw.Owner.Value -ne $sid -or $null -eq $raw.DiscretionaryAcl){$sidecarsPrivate=$false;continue}
  foreach($ace in $raw.DiscretionaryAcl){if($ace -isnot [System.Security.AccessControl.CommonAce] -or $ace.IsCallback -or $ace.AceQualifier -ne [System.Security.AccessControl.AceQualifier]::AccessAllowed -or $ace.SecurityIdentifier.Value -notin @($sid,'S-1-5-18','S-1-5-32-544')){$sidecarsPrivate=$false}}
 }
 $stage='filesystem_query'
 $report=[pscustomobject]@{status='probe_only';cases=@($cases.ToArray());inherited_file_private=$inheritedFilePrivate;sqlite_sidecars_private=$sidecarsPrivate;helper_delivery='undecided';filesystem=([System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($root))).DriveFormat}
 ConvertTo-Json -Depth 5 -Compress -InputObject $report
} catch { $cause=$_.Exception;while($null -ne $cause.InnerException){$cause=$cause.InnerException};$code=$cause.HResult;if($cause -is [System.ComponentModel.Win32Exception]){$code=$cause.NativeErrorCode};$category=$_.CategoryInfo.Category.ToString().ToLowerInvariant();$errorId=$_.FullyQualifiedErrorId;if($errorId -notmatch '^[a-zA-Z0-9_.,]+$'){$errorId='redacted'};ConvertTo-Json -Compress -InputObject @{status='failed';stage=$stage;error_code=$code;error_type=$cause.GetType().Name.ToLowerInvariant();error_category=$category;error_id=$errorId};exit 1 }
finally {if(Test-Path -LiteralPath $root){if(Test-Path -LiteralPath (Join-Path $root 'junction')){[System.IO.Directory]::Delete((Join-Path $root 'junction'))};Remove-Item -LiteralPath $root -Recurse -Force}}
