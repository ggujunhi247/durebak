import assert from 'node:assert/strict';
import {chmodSync,mkdirSync,mkdtempSync,realpathSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {delimiter,join} from 'node:path';
import test from 'node:test';
import {verifyNpmUpdateOwner} from '../src/update-installation.js';

test('automatic installation accepts only the current user-owned global npm package', {skip:process.platform==='win32'}, t=>{
 const home=realpathSync(mkdtempSync(join(tmpdir(),'durebak-installation-')));
 t.after(()=>rmSync(home,{recursive:true,force:true}));
 const prefix=join(home,'prefix'),npmRoot=join(prefix,'lib','node_modules'),bin=join(prefix,'bin');
 const dist=join(npmRoot,'durebak','dist'),cli=join(dist,'cli.js');
 mkdirSync(dist,{recursive:true});
 mkdirSync(bin);
 writeFileSync(cli,'', {mode:0o700});
 writeFileSync(join(npmRoot,'durebak','package.json'),JSON.stringify({name:'durebak',bin:{durebak:'dist/cli.js'}}));
 symlinkSync(cli,join(bin,'durebak'));
 const options={home,cli,npmRoot,path:bin,uid:process.geteuid!()};
 if(options.uid===0){assert.throws(()=>verifyNpmUpdateOwner(options),/installation_owner_unverified/);return;}
 assert.deepEqual(verifyNpmUpdateOwner(options),{prefix,cli,launcher:join(bin,'durebak')});
 const other=join(home,'other');
 mkdirSync(other);
 symlinkSync(cli,join(other,'durebak'));
 assert.throws(()=>verifyNpmUpdateOwner({...options,path:`${other}${delimiter}${bin}`}),/installation_owner_unverified/);
 assert.throws(()=>verifyNpmUpdateOwner({...options,cli:join(other,'durebak')}),/installation_owner_unverified/);
 assert.throws(()=>verifyNpmUpdateOwner({...options,npmRoot:join(home,'node_modules')}),/installation_owner_unverified/);
 chmodSync(prefix,0o775);
 assert.throws(()=>verifyNpmUpdateOwner(options),/installation_owner_unverified/);
});
