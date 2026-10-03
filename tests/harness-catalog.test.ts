import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {harnessCatalog} from '../src/harnesses/catalog.js';
import {resolveHarness} from '../src/harnesses/registry.js';
test('catalog lists eight CLI harnesses without activating candidates',()=>{
 const r=harnessCatalog(); assert.equal(r.catalogVersion,1);
 assert.deepEqual(r.harnesses.map(x=>x.id),['claude-code','codex','opencode','grok-build','antigravity-cli','gemini-cli','cursor-agent','copilot-cli']);
 for(const e of r.harnesses){assert.equal(e.surface,'cli');assert.equal(e.hostObservation,null);assert.equal(Object.keys(e.capabilities).length,11);assert.equal(e.capabilities.attach_existing.status,'unknown');assert(!Object.values(e.capabilities).flatMap(x=>x.evidence).some(x=>x.kind==='live_verified'));}
 for(const e of r.harnesses.slice(3)){assert.equal(e.stage,'research_candidate');assert.equal(e.executableAdapter,false);assert.equal(e.adapterVersion,null);assert(Object.values(e.capabilities).every(x=>!x.enabled));assert.throws(()=>resolveHarness(e.id));}
 assert.equal(resolveHarness('claude-code','claude'),'claude-code');
});
test('catalog returns independent snapshots',()=>{const a=harnessCatalog();a.harnesses[0]!.capabilities.mcp.evidence.length=0;a.harnesses.length=0;const b=harnessCatalog();assert.equal(b.harnesses.length,8);assert.equal(b.harnesses[0]!.capabilities.mcp.evidence.length,1);});
test('harnesses CLI needs no credential daemon or host executable and writes nothing',t=>{
 const root=mkdtempSync(join(tmpdir(),'durebak-catalog-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const data=join(root,'missing'),file=join(root,'credential');
 const result=execFileSync(process.execPath,[resolve('dist/cli.js'),'harnesses','--data-dir',data],{env:{...process.env,PATH:'',DUREBAK_SESSION_FILE:file},encoding:'utf8',timeout:5000});
 assert.deepEqual(JSON.parse(result),harnessCatalog());assert(!existsSync(data));assert(!existsSync(file));
 const help=execFileSync(process.execPath,[resolve('dist/cli.js'),'--help'],{encoding:'utf8'});assert(help.includes('durebak harnesses'));assert(help.includes('No provider auto-wake'));
});
