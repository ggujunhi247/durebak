import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

export function inspectTarball(path,manifest) {
 const files=execFileSync('tar',['-tzf',path],{encoding:'utf8'}).trim().split('\n');
 const allowed=/^package\/(dist\/(?:[a-z-]+\/)*[a-z-]+\.(js|d\.ts)|package\.json|README\.md|SECURITY\.md|LICENSE|NOTICE|docs\/USAGE\.md)$/;
 for(const file of files)assert.match(file,allowed,`Unexpected packed file: ${file}`);
 assert.equal(new Set(files).size,files.length,'Duplicate tar entries');
 const packed=JSON.parse(execFileSync('tar',['-xOf',path,'package/package.json'],{encoding:'utf8'}));
 assert.equal(packed.name,manifest.name);assert.equal(packed.version,manifest.version);assert.equal(packed.bin.durebak,'dist/cli.js');
 assert.deepEqual(packed,manifest,'Packed manifest drift');
 for(const name of readdirSync('src',{recursive:true}).filter(name=>name.endsWith('.ts'))){
  for(const ext of ['.js','.d.ts'])assert.ok(files.includes('package/dist/'+name.slice(0,-3)+ext),`Missing module ${name}${ext}`);
 }
 for(const file of ['README.md','SECURITY.md','LICENSE','docs/USAGE.md'])assert.ok(files.includes('package/'+file));
 assert.ok(execFileSync('tar',['-xOf',path,'package/dist/cli.js'],{encoding:'utf8'}).startsWith('#!/usr/bin/env node'));
 return {file:path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex'),files:files.length,name:packed.name,version:packed.version};
}
