import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {inspectTarball} from '../scripts/lib/package-check.mjs';

test('artifact checks reject missing emitted modules, unwanted files and altered package metadata',t=>{
 const dir=mkdtempSync(join(tmpdir(),'durebak-artifact-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const manifest=JSON.parse(readFileSync('package.json','utf8'));
 const packed=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--json','--cache',join(dir,'cache'),'--pack-destination',dir],{encoding:'utf8'}));
 const original=join(dir,packed[0].filename);assert.equal(inspectTarball(original,manifest).version,manifest.version);
 execFileSync('tar',['-xzf',original,'-C',dir]);
 const target=join(dir,'mutated.tgz');
 const repack=()=>{execFileSync('tar',['-czf',target,'-C',dir,...readdirSync(join(dir,'package'),{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>'package/'+join(e.parentPath,e.name).slice(join(dir,'package').length+1))]);};
 const module=join(dir,'package/dist/queue-policy.js');const saved=readFileSync(module);rmSync(module);repack();assert.throws(()=>inspectTarball(target,manifest),/Missing module/);writeFileSync(module,saved);
 const nested=join(dir,'package/dist/harnesses/registry.js');const savedNested=readFileSync(nested);rmSync(nested);repack();assert.throws(()=>inspectTarball(target,manifest),/Missing module/);writeFileSync(nested,savedNested);
 const unwanted=join(dir,'package/private-session.json');writeFileSync(unwanted,'{}');repack();assert.throws(()=>inspectTarball(target,manifest),/Unexpected packed file/);rmSync(unwanted);
 writeFileSync(join(dir,'package/package.json'),JSON.stringify({...manifest,private:false}));repack();assert.throws(()=>inspectTarball(target,manifest),/Packed manifest drift/);
});
