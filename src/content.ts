import { z } from 'zod';
import { fail } from './domain.js';

export function encodedPreview(value:string, budget:number) { let text=preview(value,512);while(Buffer.byteLength(JSON.stringify(text))>budget)text=Array.from(text).slice(0,-1).join('');return text; }
export function preview(text: string, limit: number) { return range(text, 0, limit).content; }
export function range(text: string, offset: number, limit: number) {
  z.number().int().min(0).parse(offset); z.number().int().min(4).max(4096).parse(limit);
  const buffer = Buffer.from(text);
  if (offset > buffer.length || (offset < buffer.length && (buffer[offset]! & 0xc0) === 0x80)) fail('invalid_offset');
  let end = Math.min(buffer.length, offset + limit);
  while (end < buffer.length && (buffer[end]! & 0xc0) === 0x80) end--;
  // A 4 KiB source can expand to 24 KiB in JSON. Budget the encoded
  // content too, leaving room for metadata in the 16 KiB HTTP envelope.
  let encodedBytes = 2;
  let safeEnd = offset;
  for (const character of buffer.subarray(offset, end).toString('utf8')) {
    const size = Buffer.byteLength(JSON.stringify(character)) - 2;
    if (encodedBytes + size > 12000) break;
    encodedBytes += size;
    safeEnd += Buffer.byteLength(character);
  }
  end = safeEnd;
  return { content: buffer.subarray(offset, end).toString('utf8'), offset, next: end, total_bytes: buffer.length, has_more: end < buffer.length };
}
