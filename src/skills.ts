import {fstatSync,lstatSync,realpathSync,readFileSync,mkdirSync,mkdtempSync,writeFileSync,linkSync,renameSync,unlinkSync,rmdirSync,openSync,closeSync,type BigIntStats} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,dirname,relative,sep} from 'node:path';
import {fail} from './domain.js';
import {resolveHarness} from './harnesses/registry.js';
import {cooperationSkill,operationReference,opencodeCommand} from './skill-content.js';
const releasedSkillHashes=new Set([
 '6670c86b23d5e24c1dfe5dcae9f018ebfd8a118cd8e020ab68fe7b524d919667', // alpha.24
]);
export function installSkills(harness:string,workspace:string){
 const host=harness==='all'?'all':resolveHarness(harness);if(host==='other')fail('unsupported_harness');
 const root=realpathSync(workspace);if(!lstatSync(root).isDirectory())fail('invalid_workspace');
 const plans:{path:string;text:string;previous?:string}[]=[];
 const add=(base:string)=>{plans.push({path:join(root,base,'SKILL.md'),text:cooperationSkill},{path:join(root,base,'references/operations.md'),text:operationReference});};
 if(host==='all'||host==='codex'||host==='opencode')add('.agents/skills/durebak');
 if(host==='all'||host==='claude-code')add('.claude/skills/durebak');
 if(host==='all'||host==='opencode')plans.push({path:join(root,'.opencode/commands/durebak.md'),text:opencodeCommand});
 const stat=(path:string)=>{try{return lstatSync(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}};
 const directories=(path:string)=>{const parts=relative(root,dirname(path)).split(sep);return parts.map((_,i)=>join(root,...parts.slice(0,i+1)));};
 const existing=(path:string)=>{const entry=stat(path);if(entry&&(!entry.isFile()||entry.isSymbolicLink()))fail('unsafe_skill_path');return entry;};
 const ownsFile=(path:string,identity:BigIntStats)=>{
  try{
   if(realpathSync(dirname(path))!==dirname(path))return false;
   const current=lstatSync(path,{bigint:true});
   return current.isFile()&&identity.ino!==0n&&current.dev===identity.dev&&current.ino===identity.ino;
  }catch(error){if(['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??''))return false;throw error;}
 };
 // Check every target before creating anything; never follow discovery symlinks.
 for(const p of plans){for(const d of directories(p.path)){const s=stat(d);if(s&&(!s.isDirectory()||s.isSymbolicLink()))fail('unsafe_skill_path');}
  if(!existing(p.path))continue;
  const content=readFileSync(p.path,'utf8');if(content===p.text)continue;
  if(p.text!==cooperationSkill||!releasedSkillHashes.has(createHash('sha256').update(content).digest('hex')))fail('skill_conflict');
  p.previous=content;
 }
 const created:{path:string;identity:BigIntStats;written?:string}[]=[],dirs:string[]=[];
 const staged:{path:string;text:string;previous:string;directory:string;backup:string;next:string;replacement?:BigIntStats;keepBackup:boolean}[]=[];
 try{for(const p of plans){for(const d of directories(p.path)){const s=stat(d);if(s&&(!s.isDirectory()||s.isSymbolicLink()))fail('unsafe_skill_path');if(!s){mkdirSync(d,{mode:0o755});dirs.push(d);}}
   const entry=existing(p.path);
   if(entry){
    const content=readFileSync(p.path,'utf8');if(content===p.text)continue;
    if(content!==p.previous)fail('skill_conflict');
    const directory=mkdtempSync(join(dirname(p.path),'.durebak-skill-'));
    const change={...p,previous:content,directory,backup:join(directory,'previous'),next:join(directory,'next'),keepBackup:false};
    staged.push(change);
    linkSync(p.path,change.backup);
    writeFileSync(change.next,p.text,{mode:entry.mode&0o777,flag:'wx'});
    continue;
   }
   if(p.previous!==undefined)fail('skill_conflict');
   const fd=openSync(p.path,'wx',0o644);
   try{
    const file:{path:string;identity:BigIntStats;written?:string}={path:p.path,identity:fstatSync(fd,{bigint:true})};
    created.push(file);
    writeFileSync(fd,p.text);file.written=p.text;
   }finally{closeSync(fd);}
  }
  for(const change of staged){
   if(!existing(change.path))fail('skill_conflict');
   const content=readFileSync(change.path,'utf8');if(content===change.text)continue;
   if(content!==change.previous||!existing(change.backup)||readFileSync(change.backup,'utf8')!==change.previous)fail('skill_conflict');
   const replacement=lstatSync(change.next,{bigint:true});
   renameSync(change.next,change.path);change.replacement=replacement;
  }
 }catch(error){
  for(const change of [...staged].reverse())if(change.replacement){
   change.keepBackup=true;
   if(ownsFile(change.path,change.replacement)&&readFileSync(change.path,'utf8')===change.text){renameSync(change.backup,change.path);change.keepBackup=false;}
  }
  for(const file of created.reverse()){
   if(ownsFile(file.path,file.identity)&&(file.written===undefined||readFileSync(file.path,'utf8')===file.written))unlinkSync(file.path);
  }
  for(const d of dirs.reverse()){try{rmdirSync(d);}catch{/* Preserve directories another writer populated. */}}throw error;
 }finally{
  for(const change of staged){
   if(stat(change.next))unlinkSync(change.next);
   if(!change.keepBackup){if(stat(change.backup))unlinkSync(change.backup);rmdirSync(change.directory);}
  }
 }
 return {harness:host,scope:'project',files:plans.map(p=>p.path),created:created.map(file=>file.path),updated:staged.filter(change=>change.replacement).map(change=>change.path),invocation:host==='codex'?'$durebak':host==='all'?{codex:'$durebak',claude_code:'/durebak',opencode:'/durebak'}:'/durebak',mcp_connected:false,native_host_verified:false,auto_wake:false};
}
