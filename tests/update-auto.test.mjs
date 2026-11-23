import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {chmodSync,copyFileSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import test from 'node:test';
import {signUpdateRelease} from '../scripts/sign-update-release.mjs';
import {acquireMaintenanceGate} from '../dist/database.js';
import {schemaVersion} from '../dist/migrations.js';
import {applyAutomaticUpdate} from '../dist/update-auto.js';
import {acquireNpmRuntime} from '../dist/update-inventory.js';
import {protocolVersion} from '../dist/version.js';

test('a signed candidate is staged by npm, swapped and verified using the existing launcher',{
 skip:!['linux','darwin'].includes(process.platform)||!process.geteuid?.()
},async t=>{
 const home=realpathSync(mkdtempSync(join(tmpdir(),'durebak-auto-e2e-')));
 t.after(()=>rmSync(home,{recursive:true,force:true}));
 const npm=(...args)=>execFileSync('npm',args,{cwd:home,encoding:'utf8',timeout:10000,env:{...process.env,npm_config_cache:join(home,'pack-cache')}}).trim();
 const old='0.1.0-alpha.28',target='0.1.0-alpha.29';
 const prefix=join(home,'install'),npmRoot=join(prefix,'lib','node_modules');
 const makeTarball=version=>{
  const source=join(home,version),dist=join(source,'dist');
  mkdirSync(dist,{recursive:true});
  writeFileSync(join(source,'package.json'),JSON.stringify({name:'durebak',version,bin:{durebak:'dist/cli.js'}}));
  writeFileSync(join(dist,'cli.js'),`#!/usr/bin/env node\nconsole.log(process.argv[2]==='--help'?'durebak dashboard':${JSON.stringify(version)});\n`);
  return join(home,npm('pack',source,'--ignore-scripts','--offline'));
 };
 npm('install','--global','--prefix',prefix,'--ignore-scripts','--offline','--no-audit','--no-fund',makeTarball(old));
 const bytes=readFileSync(makeTarball(target));
 const node=join(home,'node','bin','node'),npmCli=join(home,'node','lib','node_modules','npm','bin','npm-cli.js');
 mkdirSync(dirname(node),{recursive:true});mkdirSync(dirname(npmCli),{recursive:true});
 copyFileSync(process.execPath,node);chmodSync(node,0o700);
 const realNpm=realpathSync(process.env.npm_execpath??execFileSync('/usr/bin/env',['which','npm'],{encoding:'utf8'}).trim());
 writeFileSync(npmCli,`require(${JSON.stringify(realNpm)});\n`);
 const cli=join(npmRoot,'durebak','dist','cli.js'),data=join(home,'data');
 acquireNpmRuntime(data,cli,home)();
 acquireMaintenanceGate(data,'runtime')();
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 const envelope=signUpdateRelease(bytes,{version:target,minUpdater:old,schema:schemaVersion,protocol:protocolVersion,issuedAt:Date.now()-1000},privateKey)[`${process.platform}-${process.arch}`];
 const fetcher=async url=>{
  if(url.endsWith('.json'))return Response.json(envelope);
  if(url===`https://registry.npmjs.org/durebak/${target}`)return Response.json({name:'durebak',version:target,dist:{tarball:`https://registry.npmjs.org/durebak/-/durebak-${target}.tgz`,integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64')}});
  assert.equal(url,`https://github.com/ggujunhi247/durebak/releases/download/v${target}/durebak-${target}.tgz`);
  return new Response(bytes);
 };
 const launcher=join(prefix,'bin','durebak');
 const live=()=>execFileSync(node,[launcher,'--version'],{encoding:'utf8',timeout:5000}).trim();
 assert.equal(live(),old);
 await applyAutomaticUpdate({directory:join(home,'updates'),current:old,platform:process.platform,home,uid:process.geteuid(),node,cli},dirname(launcher),'alpha',target,install=>install(),{
  keys:{[envelope.key_id]:publicKey},fetcher,schedule:()=>0,
 });
 assert.equal(live(),target);
 assert.equal(JSON.parse(readFileSync(join(npmRoot,'.durebak-update','previous','package.json'),'utf8')).version,old);
});
