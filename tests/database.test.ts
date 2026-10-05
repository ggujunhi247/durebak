import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync,linkSync,symlinkSync,chmodSync,lstatSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,privateDirectory} from '../src/database.js';

function fixture(t:test.TestContext){
 const root=mkdtempSync(join(tmpdir(),'durebak-db-private-')),directory=join(root,'data');
 t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(directory,{mode:0o700});
 return {root,directory,file:join(directory,'runtime.sqlite')};
}

test('linked database is refused before modifying its external alias',t=>{
 const f=fixture(t),outside=join(f.root,'outside');writeFileSync(outside,'private fixture',{mode:0o600});linkSync(outside,f.file);
 assert.throws(()=>openDatabase(f.directory),/unsafe_database/);
 assert.equal(readFileSync(outside,'utf8'),'private fixture');
});

for(const suffix of ['-wal','-shm','-journal'])for(const kind of ['symlink','hardlink','permissions','directory'])test(`unsafe ${suffix} ${kind} is refused before SQLite opens`,t=>{
 const f=fixture(t);openDatabase(f.directory).close();const before=readFileSync(f.file),sidecar=f.file+suffix,outside=join(f.root,'outside');
 writeFileSync(outside,'private fixture',{mode:0o600});
 if(kind==='symlink')symlinkSync(outside,sidecar);
 else if(kind==='hardlink')linkSync(outside,sidecar);
 else if(kind==='directory')mkdirSync(sidecar,{mode:0o700});
 else{writeFileSync(sidecar,'private fixture',{mode:0o600});chmodSync(sidecar,0o644);}
 assert.throws(()=>openDatabase(f.directory),/unsafe_database/);
 assert.equal(readFileSync(outside,'utf8'),'private fixture');assert.deepEqual(readFileSync(f.file),before);
 if(kind!=='directory')assert.equal(readFileSync(sidecar,'utf8'),'private fixture');
});

for(const trailing of ['', '/'])test(`data directory symlink${trailing?' with trailing slash':''} is refused`,t=>{
 const f=fixture(t),alias=join(f.root,'alias');symlinkSync(f.directory,alias);
 assert.throws(()=>privateDirectory(alias+trailing),/unsafe_data_directory/);
});

test('directory ownership mismatch is refused without changing its permissions',t=>{
 const f=fixture(t);t.mock.method(process as typeof process&{geteuid:()=>number},'geteuid',()=>lstatSync(f.directory).uid+1);
 assert.throws(()=>privateDirectory(f.directory),/unsafe_data_directory/);
 assert.equal(lstatSync(f.directory).mode&0o777,0o700);
});

for(const suffix of ['', '-wal','-shm','-journal'])test(`ownership mismatch for database${suffix} is refused`,t=>{
 const f=fixture(t);openDatabase(f.directory).close();
 const file=f.file+suffix;if(suffix)writeFileSync(file,'private fixture',{mode:0o600});
 const before=readFileSync(file),uid=process.geteuid!();let checks=0;
 // Emulate identity loss after validating the directory (and main DB for
 // sidecars), without chown, elevated privileges or another user's data.
 t.mock.method(process as typeof process&{geteuid:()=>number},'geteuid',()=>++checks<=(suffix?2:1)?uid:uid+1);
 assert.throws(()=>openDatabase(f.directory),/unsafe_database/);
 assert.deepEqual(readFileSync(file),before);
});

test('safe WAL database supports concurrent connections and private sidecars',t=>{
 const f=fixture(t),first=openDatabase(f.directory);t.after(()=>first.close());
 first.exec("CREATE TABLE privacy_fixture(value TEXT); INSERT INTO privacy_fixture VALUES('persisted');");
 const second=openDatabase(f.directory);try{assert.equal(second.prepare('SELECT value FROM privacy_fixture').get()!.value,'persisted');}finally{second.close();}
 for(const file of [f.file,f.file+'-wal',f.file+'-shm']){const stat=lstatSync(file);assert.equal(stat.mode&0o077,0);assert.equal(stat.uid,process.geteuid!());assert.equal(stat.nlink,1);}
});
