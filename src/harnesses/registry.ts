import { fail } from '../domain.js';
import { codex } from './codex.js';
import { claudeCode } from './claude-code.js';
import { opencode } from './opencode.js';
import type { HarnessId, HarnessAdapter } from './types.js';
const adapters: Record<HarnessId,HarnessAdapter> = {codex,'claude-code':claudeCode,opencode};
export function resolveHarness(primary?: string, legacy?: string): HarnessId | 'other' {
  const normalize = (id: string): HarnessId | 'other' => {
    if(id==='claude') return 'claude-code';
    if(id==='other'||Object.hasOwn(adapters,id)) return id as HarnessId|'other';
    return fail('unsupported_harness');
  };
  if(primary===undefined&&legacy===undefined) return fail('missing_harness');
  const first=primary===undefined?undefined:normalize(primary);
  const second=legacy===undefined?undefined:normalize(legacy);
  if(first!==undefined&&second!==undefined&&first!==second) return fail('conflicting_harness');
  return (first??second)!;
}
export function legacyProvider(id: HarnessId|'other'): 'claude'|'codex'|'opencode'|'other' {return id==='claude-code'?'claude':id;}
export function getHarness(id: HarnessId): HarnessAdapter {
  if(!Object.hasOwn(adapters,id)) return fail('unsupported_harness');
  return adapters[id];
}
