import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,lstatSync,copyFileSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';

const root=process.cwd(),temporary=mkdtempSync(join(tmpdir(),'durebak-secrets-'));
const binary=process.env.GITLEAKS_BIN??'gitleaks';
const snapshot=join(temporary,'snapshot'),ignore=join(temporary,'empty-ignore');
mkdirSync(snapshot,{mode:0o700});mkdirSync(ignore,{mode:0o700});
const options=['--config',resolve('.gitleaks.toml'),'--redact=100','--no-banner','--ignore-gitleaks-allow','--gitleaks-ignore-path',ignore,'--timeout','300'];
function scan(args){
  const result=spawnSync(binary,[...args,...options],{stdio:'inherit'});
  if(result.error||result.status!==0)throw new Error('secret_scan_failed_or_unavailable');
}
try {
  scan(['git',root,'--log-opts=--all']);
  scan(['git',root,'--staged']);
  const files=[...new Set(execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{encoding:'utf8'}).split('\0').filter(Boolean))];
  for(const file of files){
    const source=resolve(root,file),destination=resolve(snapshot,file);
    if(!destination.startsWith(snapshot+'/')||!lstatSync(source).isFile()||lstatSync(source).isSymbolicLink())throw new Error('unsafe_scan_input');
    mkdirSync(dirname(destination),{recursive:true,mode:0o700});copyFileSync(source,destination);chmodSync(destination,0o600);
  }
  scan(['dir',snapshot]);
  console.log(`Secret scan passed: Git history, staged changes, and ${files.length} candidate files. No raw report retained.`);
} catch(error) {
  console.error(error.message);process.exitCode=1;
} finally {rmSync(temporary,{recursive:true,force:true});}
