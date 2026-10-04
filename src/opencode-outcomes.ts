import {z} from 'zod';
import {fail,hash,short} from './domain.js';
const identitySchema=z.object({nativeId:short,messageId:short,providerId:short,modelId:short}).strict();
const envelopeSchema=z.object({info:z.object({id:short,sessionID:short,role:z.enum(['user','assistant'])}).passthrough(),parts:z.array(z.unknown()).max(256)});
const modelSchema=z.object({providerID:short,modelID:short});
const assistantSchema=z.object({id:short,sessionID:short,parentID:short,role:z.literal('assistant'),providerID:short,modelID:short,time:z.object({created:z.number().int().nonnegative(),completed:z.number().int().nonnegative().optional()}),finish:short.optional(),summary:z.boolean().optional(),error:z.object({name:z.enum(['ProviderAuthError','UnknownError','MessageOutputLengthError','MessageAbortedError','StructuredOutputError','ContextOverflowError','ContentFilterError','APIError'])}).optional()});
const textSchema=z.object({id:short,sessionID:short,messageID:short,type:z.literal('text'),text:z.string().max(65536),synthetic:z.boolean().optional(),ignored:z.boolean().optional()});
export interface OpencodeOutcome {state:'unknown'|'running'|'succeeded'|'failed'|'stopped';messageId?:string;errorCode?:string;output?:{text:string;digest:string}}
// Internal observation only: no submission, ownership or execution authority.
// Callers must bind the response to a live owner and bounded fresh HTTP read.
// ACK, session idle and time.completed alone never establish successful work.
export function observeOpencodeTurn(raw:unknown,rawIdentity:unknown):OpencodeOutcome {
 const identity=identitySchema.safeParse(rawIdentity);if(!identity.success)fail('native_identity_invalid');const id=identity.data;
 const history=z.array(envelopeSchema).max(256).safeParse(raw);if(!history.success)fail('native_protocol_error');
 const messages=history.data;if(new Set(messages.map(m=>m.info.id)).size!==messages.length)fail('native_messages_ambiguous');
 const input=messages.find(m=>m.info.role==='user'&&m.info.id===id.messageId&&m.info.sessionID===id.nativeId);if(!input)return {state:'unknown'};
 const inputModel=modelSchema.safeParse(input.info.model);if(!inputModel.success)fail('native_protocol_error');if(inputModel.data.providerID!==id.providerId||inputModel.data.modelID!==id.modelId)fail('native_model_mismatch');
 const related=messages.filter(m=>m.info.role==='assistant'&&m.info.sessionID===id.nativeId&&m.info.parentID===id.messageId).map(m=>{const parsed=assistantSchema.safeParse(m.info);if(!parsed.success)fail('native_protocol_error');if(parsed.data.providerID!==id.providerId||parsed.data.modelID!==id.modelId)fail('native_model_mismatch');if(parsed.data.time.completed!==undefined&&parsed.data.time.completed<parsed.data.time.created)fail('native_protocol_error');return {info:parsed.data,parts:m.parts};}).filter(m=>!m.info.summary);
 const terminal=related.filter(m=>m.info.error||m.info.time.completed!==undefined&&['stop','length','content-filter'].includes(m.info.finish??''));if(terminal.length>1)fail('native_messages_ambiguous');const selected=terminal[0];
 if(!selected)return {state:related.some(m=>m.info.time.completed===undefined)?'running':'unknown'};
 if(related.some(m=>m!==selected&&(m.info.time.completed===undefined||m.info.time.created>=selected.info.time.created||m.info.time.completed>selected.info.time.completed!)))fail('native_messages_ambiguous');
 const info=selected.info;if(info.error)return {state:info.error.name==='MessageAbortedError'?'stopped':'failed',messageId:info.id,errorCode:info.error.name};
 if(info.finish!=='stop')return {state:'failed',messageId:info.id,errorCode:'native_output_incomplete'};
 const texts:string[]=[];const partIds=new Set<string>();for(const rawPart of selected.parts){if(!rawPart||typeof rawPart!=='object'||!('type' in rawPart))fail('native_protocol_error');if(rawPart.type==='tool')fail('native_tools_unsettled');if(rawPart.type!=='text')continue;const parsed=textSchema.safeParse(rawPart);if(!parsed.success)fail('native_protocol_error');const part=parsed.data;if(part.sessionID!==id.nativeId||part.messageID!==info.id)fail('native_part_mismatch');if(partIds.has(part.id))fail('native_messages_ambiguous');partIds.add(part.id);if(!part.synthetic&&!part.ignored)texts.push(part.text);}
 const text=texts.join(''),bytes=Buffer.byteLength(text);if(!bytes||bytes>65536)fail('native_output_size');return {state:'succeeded',messageId:info.id,output:{text,digest:hash(text)}};
}
