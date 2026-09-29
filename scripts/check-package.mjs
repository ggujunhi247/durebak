import {execFileSync} from 'node:child_process';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {inspectTarball} from './lib/package-check.mjs';
const {values}=parseArgs({options:{tarball:{type:'string'}}});
const directory=mkdtempSync(join(tmpdir(),'durebak-pack-'));
try{
 const manifest=JSON.parse(readFileSync('package.json','utf8'));
 let file=values.tarball?resolve(values.tarball):null;
 if(!file){const [pack]=JSON.parse(execFileSync('npm',['pack','--json','--ignore-scripts','--pack-destination',directory,'--cache',join(directory,'npm-cache')],{encoding:'utf8'}));file=join(directory,pack.filename);}
 console.log(JSON.stringify(inspectTarball(file,manifest)));
}finally{rmSync(directory,{recursive:true,force:true});}
