import {createHash,randomUUID} from 'node:crypto';
import {closeSync,constants,fsyncSync,lstatSync,openSync,readdirSync,readFileSync,realpathSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {isAbsolute,join,relative,sep} from 'node:path';
import {acquireMaintenanceGate,privateDirectory} from './database.js';
import {fail} from './domain.js';
import {assertNoPendingNpmUpdate,npmRootForCli} from './update-installation.js';

const noLease=()=>{};
const fingerprint=(dataDir:string)=>createHash('sha256').update(dataDir).digest('hex');
const receiptName=/^[a-f0-9]{64}\.path$/;
const tempName=/^\.stage-[0-9a-f-]{36}$/;

function readReceipt(path:string) {
 const stat=lstatSync(path);
 if(!stat.isFile()||stat.nlink!==1||stat.uid!==process.geteuid?.()||(stat.mode&0o077)!==0||stat.size>4096)fail('unsafe_update_inventory');
 const value=readFileSync(path,'utf8');
 if(!isAbsolute(value)||Buffer.byteLength(value)!==stat.size||/[\x00-\x1f\x7f]/.test(value))fail('unsafe_update_inventory');
 return value;
}

function persistReceipt(directory:string,dataDir:string) {
 if(Buffer.byteLength(dataDir)>4096||/[\x00-\x1f\x7f]/.test(dataDir))fail('unsafe_update_inventory');
 const destination=join(directory,fingerprint(dataDir)+'.path');
 if(lstatSync(destination,{throwIfNoEntry:false})){
  if(readReceipt(destination)!==dataDir)fail('unsafe_update_inventory');
  return;
 }
 const temporary=join(directory,'.stage-'+randomUUID());
 const fd=openSync(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
 let published=false;
 try{
  try{writeFileSync(fd,dataDir);fsyncSync(fd);}finally{closeSync(fd);}
  renameSync(temporary,destination);published=true;
 }finally{if(!published)unlinkSync(temporary);}
 syncDirectory(directory);
}

function syncDirectory(directory:string){
 const parent=openSync(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{fsyncSync(parent);}finally{closeSync(parent);}
}

function controlDirectory(npmRoot:string){return join(npmRoot,'.durebak-runtime');}

export function acquireNpmRuntime(dataDir:string,cli?:string,home=homedir()) {
 const npmRoot=npmRootForCli(cli),uid=process.geteuid?.();
 if(!npmRoot||!uid)return noLease;
 const fromHome=relative(realpathSync(home),npmRoot);
 if(!fromHome||isAbsolute(fromHome)||fromHome.split(sep)[0]==='..'||realpathSync(npmRoot)!==npmRoot)return noLease;
 const owner=lstatSync(npmRoot);
 if(!owner.isDirectory()||owner.uid!==uid||(owner.mode&0o022)!==0)return noLease;
 const control=controlDirectory(npmRoot);
 const release=acquireMaintenanceGate(control,'runtime');
 try{
  assertNoPendingNpmUpdate(cli);
  privateDirectory(dataDir);
  const directory=join(control,'directories');
  privateDirectory(directory);
  persistReceipt(directory,realpathSync(dataDir));
  syncDirectory(control);
  syncDirectory(npmRoot);
  return release;
 }catch(error){release();throw error;}
}

export function acquireRuntimeMaintenance(dataDir:string) {
 const installed=acquireNpmRuntime(dataDir);
 try{
  const local=acquireMaintenanceGate(dataDir,'runtime');
  return ()=>{try{local();}finally{installed();}};
 }catch(error){installed();throw error;}
}

export function acquireNpmInventory(npmRoot:string,confirmed:readonly string[]) {
 const control=controlDirectory(npmRoot);
 const release=acquireMaintenanceGate(control,'maintenance');
 try{
  const directory=join(control,'directories');
  if(!lstatSync(directory,{throwIfNoEntry:false}))fail('unsafe_update_inventory');
  privateDirectory(directory);
  const names=readdirSync(directory).filter(name=>!tempName.test(name));
  if(names.length>64||names.some(name=>!receiptName.test(name)))fail('unsafe_update_inventory');
  const observed=names.map(name=>{
   const value=readReceipt(join(directory,name));
   if(fingerprint(value)+'.path'!==name||realpathSync(value)!==value)fail('unsafe_update_inventory');
   return value;
  });
  return {directories:[...new Set([...confirmed,...observed])],release};
 }catch(error){release();throw error;}
}
