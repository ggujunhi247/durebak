export type BridgeState='unknown'|'fresh'|'stale'|'offline';
export interface BridgeObservation {instance:string;epoch:string;last_seen_ms:number;closed:boolean}
export interface SessionHealth {
 session_id:string;
 bridge:{state:BridgeState;last_seen_at:number|null;active_count:number;duplicate:boolean};
 last_activity_at:number|null;availability:'available'|'busy'|'paused';
 host:'unknown';readiness:'unknown';progress:'unknown';auto_wake:false;
}
export function bridgeHealth(rows:readonly BridgeObservation[],epoch:string,now:number):SessionHealth['bridge'] {
 const all=rows.filter(x=>x.epoch===epoch);
 const current=all.filter(x=>x.last_seen_ms<=now);
 if(!current.length)return {state:'unknown',last_seen_at:all.length?Math.max(...all.map(x=>x.last_seen_ms)):null,active_count:0,duplicate:false};
 const last=Math.max(...current.map(x=>x.last_seen_ms));
 const active=current.filter(x=>!x.closed&&now-x.last_seen_ms<60000);
 const open=current.filter(x=>!x.closed);
 const latestOpen=open.length?Math.max(...open.map(x=>x.last_seen_ms)):null;
 const state:BridgeState=latestOpen===null?'offline':now-latestOpen<30000?'fresh':now-latestOpen<60000?'stale':'offline';
 return {state,last_seen_at:last,active_count:active.length,duplicate:active.length>1};
}
