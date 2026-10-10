// Only allow bounded investigation evidence into public CI output.
const caseIds=new Set(['atomic_private_directory','private_file','broad_allow_rejected','null_dacl_rejected','foreign_owner_rejected','junction_rejected','hardlink_rejected','sqlite_sidecars_observed']);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const label=(value,pattern)=>typeof value==='string'&&value.length<=80&&pattern.test(value);
export function sanitizeProbeResult(result,metadata) {
 const failure=(reason,detail={})=>({exitCode:1,report:{status:'failed',reason,...detail,platform:'win32',arch:metadata.arch,product_support:false}});
 let parsed;
 try {parsed=JSON.parse(result.stdout.trim().replace(/^\uFEFF/,''));} catch {}
 if(result.error||result.status!==0){
  const detail={};
  if(object(parsed)){
   for(const [key,pattern] of [['stage',/^[a-z_]+$/],['error_type',/^[a-z]+$/],['error_category',/^[a-z]+$/],['error_id',/^[a-zA-Z0-9_.,]+$/]]){
    if(label(parsed[key],pattern))detail[key]=parsed[key];
   }
   if(Number.isSafeInteger(parsed.error_code))detail.error_code=parsed.error_code;
  }
  return failure(result.error?'probe_process_failed':'probe_failed',detail);
 }
 if(!object(parsed)||parsed.status!=='probe_only'||!Array.isArray(parsed.cases)||parsed.cases.length!==caseIds.size||
  parsed.cases.some(item=>!object(item)||!caseIds.has(item.id)||typeof item.passed!=='boolean')||
  new Set(parsed.cases.map(item=>item.id)).size!==caseIds.size||
  typeof parsed.inherited_file_private!=='boolean'||typeof parsed.sqlite_sidecars_private!=='boolean'||
  parsed.helper_delivery!=='undecided'||!['NTFS','ReFS','FAT','FAT32','exFAT','UDF'].includes(parsed.filesystem))return failure('probe_report_invalid');
 const cases=parsed.cases.map(({id,passed})=>({id,passed}));
 const report={status:'probe_only',cases,inherited_file_private:parsed.inherited_file_private,sqlite_sidecars_private:parsed.sqlite_sidecars_private,
  helper_delivery:'undecided',filesystem:parsed.filesystem,platform:'win32',arch:metadata.arch,os_release:metadata.os_release,node:metadata.node,
  product_support:false,cross_user_access:'not_tested',desktop_validation:'not_tested'};
 return {report,exitCode:cases.some(item=>!item.passed)?1:0};
}
