import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {parseArgs} from 'node:util';
import {cooperationSkill,operationReference} from '../src/skill-content.ts';

const {values:{check}}=parseArgs({options:{check:{type:'boolean'}}});
const {version}=JSON.parse(readFileSync('package.json','utf8'));
const plugin='plugins/durebak';
const drift=[];

function syncFile(path,content){
 if(check){
  drift.push(path);
 }else{
  mkdirSync(dirname(path),{recursive:true});
  writeFileSync(path,content);
 }
}

const skill=`${plugin}/skills/durebak`;
for(const [path,content] of [[`${skill}/SKILL.md`,cooperationSkill],[`${skill}/references/operations.md`,operationReference]]){
 if(!existsSync(path)||readFileSync(path,'utf8').replaceAll('\r\n','\n')!==content)syncFile(path,content);
}

for(const host of ['claude','codex']){
 const path=`${plugin}/.${host}-plugin/plugin.json`;
 const manifest=JSON.parse(readFileSync(path,'utf8'));
 if(manifest.version!==version)syncFile(path,`${JSON.stringify({...manifest,version},null,2)}\n`);
}

if(drift.length){
 console.error(`Plugin files differ from their sources. Run npm run plugins:sync:\n${drift.join('\n')}`);
 process.exitCode=1;
}
