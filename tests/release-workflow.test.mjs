import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

for(const malformed of [false,true])test(malformed?'release recovery rejects malformed asset metadata':'release recovery uploads missing assets when the GitHub release has no assets',t=>{
 const root=mkdtempSync(join(tmpdir(),'durebak-release-retry-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(join(root,'release'));mkdirSync(join(root,'bin'));
 writeFileSync(join(root,'release','package.tgz'),'verified');
 const log=join(root,'commands');
 writeFileSync(join(root,'bin','gh'),`#!/bin/sh
echo "$*" >> "$MOCK_LOG"
case "$1 $2" in
 'api repos/example/durebak/releases/tags/v1.2.3') echo "$MOCK_RESPONSE" ;;
 'release download') echo 'no assets to download' >&2; exit 1 ;;
 'release upload') exit 0 ;;
 *) exit 9 ;;
esac
`,{mode:0o700});
 const workflow=readFileSync('.github/workflows/release.yml','utf8');
 const section=workflow.split('- name: Create or verify GitHub release')[1];
 const script=section.split('        run: |\n')[1].replace(/^          /gm,'');
 const result=spawnSync('bash',['-e','-o','pipefail','-c',script],{cwd:root,encoding:'utf8',env:{...process.env,PATH:`${join(root,'bin')}:${process.env.PATH}`,RUNNER_TEMP:root,RELEASE_TAG:'v1.2.3',RELEASE_CHANNEL:'latest',RELEASE_REPOSITORY:'example/durebak',MOCK_LOG:log,MOCK_RESPONSE:malformed?'{}':'{"assets":[]}'}});
 const commands=readFileSync(log,'utf8');
 if(malformed){assert.notEqual(result.status,0);assert.doesNotMatch(commands,/release upload/);}
 else{assert.equal(result.status,0,result.stderr);assert.match(commands,/release upload v1.2.3 release\/package.tgz/);}
 assert.doesNotMatch(commands,/release download/);
});
