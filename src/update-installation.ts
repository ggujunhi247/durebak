import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {basename,delimiter,dirname,isAbsolute,join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fail} from './domain.js';
import {readPackageSwapPhase} from './update-package-swap.js';

interface NpmOwnerProbe {home:string;cli:string;npmRoot:string;path:string;uid:number}

export function npmRootForCli(cli=fileURLToPath(new URL('./cli.js',import.meta.url))) {
 const pkg=dirname(dirname(cli)),npmRoot=dirname(pkg);
 if(basename(pkg)==='durebak'&&basename(npmRoot)==='node_modules'&&basename(dirname(npmRoot))==='lib'&&cli===join(pkg,'dist','cli.js'))return npmRoot;
}

export function assertNoPendingNpmUpdate(cli?:string) {
 const npmRoot=npmRootForCli(cli);
 if(!npmRoot)return;
 let phase:ReturnType<typeof readPackageSwapPhase>;
 try{phase=readPackageSwapPhase(npmRoot);}catch{fail('update_recovery_required');}
 if(phase==='applying')fail('update_recovery_required');
}

export function verifyNpmUpdateOwner({home,cli,npmRoot,path,uid}:NpmOwnerProbe) {
 try{
  if(!Number.isInteger(uid)||uid<=0||!isAbsolute(home)||!isAbsolute(npmRoot)||!isAbsolute(cli))fail('installation_owner_unverified');
  const root=realpathSync(home);
  if(realpathSync(npmRoot)!==npmRoot||basename(npmRoot)!=='node_modules'||basename(dirname(npmRoot))!=='lib')fail('installation_owner_unverified');
  const prefix=dirname(dirname(npmRoot));
  const packageRoot=join(npmRoot,'durebak');
  if(cli!==join(packageRoot,'dist','cli.js')||realpathSync(cli)!==cli)fail('installation_owner_unverified');
  const subpath=relative(root,prefix);
  if(!subpath||isAbsolute(subpath)||subpath.split(sep)[0]==='..')fail('installation_owner_unverified');
  for(let directory=dirname(cli);;directory=dirname(directory)){
   assertOwned(directory,uid,true);
   if(directory===root)break;
  }
  assertOwned(cli,uid,false);
  const manifestFile=join(packageRoot,'package.json');
  assertOwned(manifestFile,uid,false);
  const manifest=JSON.parse(readFileSync(manifestFile,'utf8'));
  if(manifest?.name!=='durebak'||manifest.bin?.durebak!=='dist/cli.js')fail('installation_owner_unverified');
  const launcher=join(prefix,'bin','durebak');
  assertOwned(dirname(launcher),uid,true);
  const link=lstatSync(launcher);
  if(link.uid!==uid||!link.isSymbolicLink()||realpathSync(launcher)!==cli)fail('installation_owner_unverified');
  const candidates=new Set<string>();
  for(const directory of path.split(delimiter)){
   if(!isAbsolute(directory))fail('installation_owner_unverified');
   if(lstatSync(join(directory,'durebak'),{throwIfNoEntry:false}))candidates.add(join(realpathSync(directory),'durebak'));
  }
  if(candidates.size!==1||!candidates.has(launcher))fail('installation_owner_unverified');
  return {prefix,cli,launcher};
 }catch{fail('installation_owner_unverified');}
}

function assertOwned(path:string,uid:number,directory:boolean) {
 const stat=lstatSync(path);
 if(stat.uid!==uid||(stat.mode&0o022)!==0||(directory?!stat.isDirectory():!stat.isFile()||stat.nlink!==1||stat.size>262144))fail('installation_owner_unverified');
}
