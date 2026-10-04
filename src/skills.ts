import {lstatSync,realpathSync,readFileSync,mkdirSync,writeFileSync,unlinkSync,rmdirSync,openSync,closeSync} from 'node:fs';
import {join,dirname,relative,sep} from 'node:path';
import {fail} from './domain.js';
import {resolveHarness} from './harnesses/registry.js';
import {cooperationSkill,operationReference,opencodeCommand} from './skill-content.js';
export function installSkills(harness:string,workspace:string){
 const host=harness==='all'?'all':resolveHarness(harness);if(host==='other')fail('unsupported_harness');
 const root=realpathSync(workspace);if(!lstatSync(root).isDirectory())fail('invalid_workspace');
 const plans:{path:string;text:string}[]=[];
 const add=(base:string)=>{plans.push({path:join(root,base,'SKILL.md'),text:cooperationSkill},{path:join(root,base,'references/operations.md'),text:operationReference});};
 if(host==='all'||host==='codex'||host==='opencode')add('.agents/skills/durebak');
 if(host==='all'||host==='claude-code')add('.claude/skills/durebak');
 if(host==='all'||host==='opencode')plans.push({path:join(root,'.opencode/commands/durebak.md'),text:opencodeCommand});
 const stat=(path:string)=>{try{return lstatSync(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}};
 const directories=(path:string)=>{const parts=relative(root,dirname(path)).split(sep);return parts.map((_,i)=>join(root,...parts.slice(0,i+1)));};
 // Check every target before creating anything; never follow discovery symlinks.
 for(const p of plans){for(const d of directories(p.path)){const s=stat(d);if(s&&(!s.isDirectory()||s.isSymbolicLink()))fail('unsafe_skill_path');}
  const s=stat(p.path);if(s&&(!s.isFile()||s.isSymbolicLink()))fail('unsafe_skill_path');if(s&&readFileSync(p.path,'utf8')!==p.text)fail('skill_conflict');}
 const created:string[]=[],dirs:string[]=[];
 try{for(const p of plans){for(const d of directories(p.path)){const s=stat(d);if(s&&(!s.isDirectory()||s.isSymbolicLink()))fail('unsafe_skill_path');if(!s){mkdirSync(d,{mode:0o755});dirs.push(d);}}
   if(stat(p.path)){if(readFileSync(p.path,'utf8')!==p.text)fail('skill_conflict');continue;}
   const fd=openSync(p.path,'wx',0o644);created.push(p.path);
   try{writeFileSync(fd,p.text);}finally{closeSync(fd);}
  }}catch(error){for(const f of created.reverse())unlinkSync(f);for(const d of dirs.reverse()){try{rmdirSync(d);}catch{/* Preserve directories another writer populated. */}}throw error;}
 return {harness:host,scope:'project',files:plans.map(p=>p.path),created,invocation:host==='codex'?'$durebak':host==='all'?{codex:'$durebak',claude_code:'/durebak',opencode:'/durebak'}:'/durebak',mcp_connected:false,native_host_verified:false,auto_wake:false};
}
