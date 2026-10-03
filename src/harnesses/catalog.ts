import type {HarnessId} from './types.js';
import {version} from '../version.js';
export type CatalogHarnessId=HarnessId|'grok-build'|'antigravity-cli'|'gemini-cli'|'cursor-agent'|'copilot-cli';
export type CapabilityName='mcp'|'managed_start'|'persistent_submit'|'resume'|'attach_existing'|'observe'|'interrupt'|'reconcile'|'permission_bridge'|'read_only_enforcement'|'usage';
export type EvidenceKind='documented'|'source_observed'|'renderer_tested'|'protocol_tested'|'live_verified';
export interface CapabilityEvidence {kind:EvidenceKind;source:string;observedOn:string}
export interface CatalogCapability {status:'supported'|'unsupported'|'unknown';enabled:boolean;evidence:CapabilityEvidence[]}
export interface CatalogEntry {id:CatalogHarnessId;surface:'cli';stage:'research_candidate'|'config_tested';executableAdapter:boolean;adapterVersion:string|null;hostObservation:null;capabilities:Record<CapabilityName,CatalogCapability>}
export interface CatalogReport {catalogVersion:1;harnesses:CatalogEntry[]}
const names:CapabilityName[]=['mcp','managed_start','persistent_submit','resume','attach_existing','observe','interrupt','reconcile','permission_bridge','read_only_enforcement','usage'];
const sources: Array<[CatalogHarnessId,string]>=[
 ['claude-code','tests/harnesses.test.ts'],['codex','tests/harnesses.test.ts'],['opencode','tests/harnesses.test.ts'],
 ['grok-build','https://docs.x.ai/build/features/mcp-servers'],['antigravity-cli','https://antigravity.google/docs/mcp'],
 ['gemini-cli','https://geminicli.com/docs/tools/mcp-server/'],['cursor-agent','https://cursor.com/docs/cli/reference/configuration'],
 ['copilot-cli','https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference'],
];
export function harnessCatalog():CatalogReport {
 return {catalogVersion:1,harnesses:sources.map(([id,source],i)=>{
  const executableAdapter=i<3;
  const capabilities=Object.fromEntries(names.map(name=>[name,{status:'unknown',enabled:false,evidence:[]} as CatalogCapability])) as Record<CapabilityName,CatalogCapability>;
  capabilities.mcp={status:'supported',enabled:executableAdapter,evidence:[{kind:executableAdapter?'renderer_tested':'documented',source,observedOn:executableAdapter?'2026-10-04':'2026-10-03'}]};
  return {id,surface:'cli',stage:executableAdapter?'config_tested':'research_candidate',executableAdapter,adapterVersion:executableAdapter?version:null,hostObservation:null,capabilities};
 })};
}
