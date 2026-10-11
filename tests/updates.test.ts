import test from 'node:test';
import assert from 'node:assert/strict';
import {checkUpdates,compareVersions,readUpdateJson,channelForVersion} from '../src/updates.js';
const release=(v:string)=>({tag_name:`v${v}`,draft:false,prerelease:v.includes('-'),html_url:`https://github.com/ggujunhi247/durebak/releases/tag/v${v}`,assets:[{name:`durebak-${v}.tgz`,browser_download_url:`https://github.com/ggujunhi247/durebak/releases/download/v${v}/durebak-${v}.tgz`}]});
const fixture=(npm:unknown,github:unknown)=>(url:string)=>Promise.resolve(url.startsWith('https://registry.npmjs.org/')?npm:github);
test('release numbers compare numerically and channel prereleases precede stable',()=>{
 assert.equal(compareVersions('0.1.0-alpha.10','0.1.0-alpha.9'),1);
 assert.equal(compareVersions('0.1.0-rc.2','0.1.0'),-1);
 assert.equal(compareVersions('10.0.0','2.0.0'),1);
 assert.equal(channelForVersion('1.2.3-beta.1'),'beta');
 for(const v of ['01.2.3','1.2','1.2.3-alpha.01','1.2.3;echo hi','1.2.3\x1b[2J'])assert.throws(()=>channelForVersion(v),/invalid_update_version/);
});
test('registry lag never offers a downgrade and GitHub delivery stays distinct',async()=>{
 const report=await checkUpdates({current:'0.1.0-alpha.23',channel:'alpha'},fixture({name:'durebak',version:'0.1.0-alpha.22'},[release('0.1.0-alpha.23')]));
 assert.equal(report.npm.status,'installed_ahead');assert.equal(report.npm.install_command,null);
 assert.equal(report.github.status,'up_to_date');assert.equal(report.github.version,'0.1.0-alpha.23');
});
test('new GitHub-only release remains separate from unavailable npm publication',async()=>{
 const report=await checkUpdates({current:'0.1.0-alpha.23',channel:'alpha'},fixture({},[release('0.1.0-alpha.24')]));
 assert.equal(report.npm.status,'unavailable');assert.equal(report.github.status,'update_available');assert.equal(report.npm.install_command,null);
 assert.equal(report.github.release_url,'https://github.com/ggujunhi247/durebak/releases/tag/v0.1.0-alpha.24');
});
test('stable rejects prerelease latest, cross-channel candidates and forged assets',async()=>{
 const stable=await checkUpdates({current:'0.1.0',channel:'stable'},fixture({name:'durebak',version:'0.1.1-alpha.1'},[release('0.1.1-alpha.1')]));
 assert.equal(stable.npm.status,'unavailable');assert.equal(stable.github.status,'unavailable');
 const bad=release('0.1.0-alpha.24');bad.assets[0]!.browser_download_url='https://attacker.invalid/file';
 const report=await checkUpdates({current:'0.1.0-alpha.23',channel:'alpha'},fixture({name:'attacker',version:'0.1.0-alpha.24'},[bad]));
 assert.equal(report.npm.status,'unavailable');assert.equal(report.github.status,'unavailable');
 assert.equal(JSON.stringify(report).includes('attacker'),false);
});
test('unknown installation owner gets an installation guide rather than an unsafe global overwrite command',async()=>{
 const opts={current:'0.1.0-alpha.23',channel:'alpha' as const};const request=fixture({name:'durebak',version:'0.1.0-alpha.24'},[]);
 const report=await checkUpdates(opts,request);
 assert.equal(report.npm.status,'update_available');assert.equal(report.npm.install_command,null);assert.equal(report.installation_owner,'unverified');assert.equal(report.installation_guide_url,'https://github.com/ggujunhi247/durebak/blob/main/docs/INSTALLATION.md');
 assert.equal((await checkUpdates({...opts,pin:'0.1.0-alpha.23'},request)).npm.status,'pinned');
 assert.equal((await checkUpdates({...opts,pin:'0.1.0-alpha.23'},request)).npm.install_command,null);
});
test('network failures and arbitrary exception text are bounded unavailable reports',async()=>{
 const report=await checkUpdates({current:'0.1.0-alpha.23',channel:'alpha'},async()=>{throw Error('PRIVATE SECRET');});
 assert.equal(report.npm.status,'unavailable');assert.equal(report.github.status,'unavailable');assert.ok(!JSON.stringify(report).includes('SECRET'));
});
test('metadata reader bounds streamed bytes and rejects malformed JSON, status failures and foreign URLs',async()=>{
 const url='https://registry.npmjs.org/durebak/alpha';
 assert.deepEqual(await readUpdateJson(url,async()=>new Response('{"version":"1.2.3"}')),{version:'1.2.3'});
 for(const response of [new Response('{bad'),new Response('{}',{status:500}),new Response('x'.repeat(262145)),new Response('{}',{headers:{'content-length':'262145'}})]){
  await assert.rejects(readUpdateJson(url,async()=>response));
 }
 let contacted=false;await assert.rejects(readUpdateJson('https://attacker.invalid/',async()=>{contacted=true;return new Response('{}');}));assert.equal(contacted,false);
 await readUpdateJson(url,async(_input,init)=>{assert.equal(init?.redirect,'error');assert.equal(init?.credentials,'omit');assert.ok(init?.signal);return new Response('{}');});
});
test('channel lookup follows a bounded next page when recent prereleases hide stable',async()=>{
 const requested:string[]=[];
 const report=await checkUpdates({current:'1.0.0',channel:'stable'},async url=>{
  requested.push(url);if(url.includes('registry'))return {name:'durebak',version:'1.1.0'};
  return url.endsWith('&page=2')?[release('1.1.0')]:Array.from({length:10},(_,i)=>release(`1.2.0-alpha.${i}`));
 });
 assert.equal(report.github.version,'1.1.0');assert.equal(report.github.status,'update_available');assert.ok(requested.some(url=>url.endsWith('&page=2')));
});
test('rejected response bodies are cancelled before reading or returning',async()=>{
 for(const options of [{status:500},{headers:{'content-length':'262145'}}]){
  let cancelled=false;const body=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});
  await assert.rejects(readUpdateJson('https://registry.npmjs.org/durebak/alpha',async()=>new Response(body,options)));
  assert.equal(cancelled,true);
 }
});
