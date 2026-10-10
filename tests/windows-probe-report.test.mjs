import test from 'node:test';
import assert from 'node:assert/strict';

const metadata={platform:'win32',arch:'x64',os_release:'10.0.26100',node:'v24.21.0'};
const ids=['atomic_private_directory','private_file','broad_allow_rejected','null_dacl_rejected','foreign_owner_rejected','junction_rejected','hardlink_rejected','sqlite_sidecars_observed'];
const fixture=()=>({status:'probe_only',cases:ids.map(id=>({id,passed:true})),inherited_file_private:false,sqlite_sidecars_private:false,helper_delivery:'undecided',filesystem:'NTFS'});
async function format(result){
 const module=await import('../scripts/windows/probe-report.mjs');
 return module.sanitizeProbeResult(result,metadata);
}
const success=value=>({status:0,stdout:JSON.stringify(value)});

test('probe report removes unexpected helper fields while preserving negative observations',async()=>{
 const report=fixture();
 report.private_path='C:\\private-fixture\\probe';
 report.cases[0].owner='S-1-5-21-123-456-789-1001';
 report.product_support=true;
 const result=await format(success(report));
 assert.equal(result.exitCode,0);
 assert.deepEqual(result.report,{...fixture(),...metadata,product_support:false,cross_user_access:'not_tested',desktop_validation:'not_tested'});
});

test('probe malformed success output produces bounded JSON failure without exception text',async()=>{
 const duplicate=fixture();duplicate.cases[1]=duplicate.cases[0];
 const unknown=fixture();unknown.cases[0].id='private-path';
 const nonBoolean=fixture();nonBoolean.cases[0].passed='true';
 for(const stdout of ['C:\\private-fixture\\probe','null','[]','{}',undefined,JSON.stringify({...fixture(),cases:[]}),JSON.stringify({...fixture(),cases:[...fixture().cases,fixture().cases[0]]}),JSON.stringify(duplicate),JSON.stringify(unknown),JSON.stringify(nonBoolean),JSON.stringify({...fixture(),status:'supported'}),JSON.stringify({...fixture(),helper_delivery:'ready'}),JSON.stringify({...fixture(),sqlite_sidecars_private:'false'}),JSON.stringify({...fixture(),filesystem:'C:\\private-fixture'})]){
  assert.deepEqual(await format({status:0,stdout}),{exitCode:1,report:{status:'failed',reason:'probe_report_invalid',platform:'win32',arch:'x64',product_support:false}});
 }
});

test('probe failure diagnostics reject paths and oversized error labels',async()=>{
 const result=await format({status:1,stdout:JSON.stringify({stage:'acl_query',error_type:'x'.repeat(1000),error_category:'permissiondenied',error_id:'C:\\private-fixture\\probe',error_code:5,private_path:'hidden'})});
 assert.deepEqual(result,{exitCode:1,report:{status:'failed',reason:'probe_failed',stage:'acl_query',error_category:'permissiondenied',error_code:5,platform:'win32',arch:'x64',product_support:false}});
 const failed=await format({error:new Error('C:\\private-fixture\\probe'),status:null,stdout:''});
 assert.deepEqual(failed.report,{status:'failed',reason:'probe_process_failed',platform:'win32',arch:'x64',product_support:false});
 const bom=await format({status:1,stdout:'\uFEFF'+JSON.stringify({stage:'acl_query',error_code:5})});
 assert.equal(bom.report.stage,'acl_query');
 assert.equal(bom.report.error_code,5);
});

test('probe BOM and failed individual cases remain observable',async()=>{
 const report=fixture();report.cases[3].passed=false;
 const result=await format({status:0,stdout:'\uFEFF'+JSON.stringify(report)});
 assert.equal(result.exitCode,1);
 assert.equal(result.report.cases[3].passed,false);
 assert.equal(result.report.status,'probe_only');
});
