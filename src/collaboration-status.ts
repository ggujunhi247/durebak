import type {SessionHealth} from './health.js';
export interface CollaborationStatus {
 mode:'cooperative';auto_wake:false;observed_at:number;self:SessionHealth;
 sessions:{items:{id:string;alias:string;alias_truncated:boolean;provider:string;availability:string;bridge:string;duplicate_bridge:boolean;last_contact_at:number|null}[];next:string;has_more:boolean};
 requests:{items:{id:string;state:string;version:number;creator:string;recipient:string;deadline_at:number;task_state:string|null;task_version:number|null;execution?:string;execution_source?:'mock_managed_ledger'|null;verification:string;review?:string;deployment?:string;needs_attention:boolean}[];next:string;has_more:boolean};
}
// JSON quoting preserves label boundaries. Escape bidi controls explicitly too.
function label(value:string){return JSON.stringify(value).replace(/[\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,c=>`\\u${c.charCodeAt(0).toString(16).padStart(4,'0')}`);}
function evidenceStatus(value:unknown){return typeof value==='string'&&value.length&&!/[^a-z0-9_]/.test(value)?value:'unknown';}
export function renderCollaborationStatus(view:CollaborationStatus){
 const evidenceNotice=view.requests.items.some(q=>q.execution!==undefined||q.review!==undefined||q.deployment!==undefined)
  ? 'Execution shows the mock managed ledger. Verification evidence is self_reported. Deployment is participant-reported.'
  : 'Evidence is self_reported.';
 return [`Durebak | mode=${view.mode} | auto_wake=${view.auto_wake} | host=${view.self.host}`,
  `Snapshot: ${new Date(view.observed_at).toISOString()} | self bridge=${view.self.bridge.state} | availability=${view.self.availability}`,
  '', 'Sessions (contact is not host readiness)',
  ...view.sessions.items.map(s=>`${s.id} | ${label(s.alias)}${s.alias_truncated?' [truncated]':''} | ${s.provider} | ${s.availability} | bridge=${s.bridge}${s.duplicate_bridge?' [duplicate]':''}`),
  ...(view.sessions.has_more?[`More sessions: collaboration_status sessionAfter=${view.sessions.next}`]:[]),
  '', 'Your requests (completion is a submitted result)',
  ...view.requests.items.map(q=>{
   const stages=[['execution',q.execution],['verification',q.verification],['review',q.review],['deployment',q.deployment]];
   const evidence=stages.flatMap(([name,value])=>value===undefined?[]:[`${name}=${evidenceStatus(value)}`]).join(' | ');
   return `${q.id} | ${q.state} v${q.version} | task=${q.task_state??'none'}${q.task_version===null?'':` v${q.task_version}`} | ${evidence} | deadline=${new Date(q.deadline_at).toISOString()}${q.needs_attention?' [attention]':''}`;
  }),
  ...(!view.requests.items.length?['No participant requests in this page.']:[]),
  ...(view.requests.has_more?[`More requests: collaboration_status requestAfter=${view.requests.next}`]:[]),
  '', `Host readiness/progress: unknown. ${evidenceNotice} Snapshot does not receive, acknowledge or execute.`, ''].join('\n');
}
