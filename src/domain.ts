import { createHash } from 'node:crypto';
import { z } from 'zod';

export class DomainError extends Error {
  constructor(public readonly code: string) { super(code); }
}
export function fail(code: string): never { throw new DomainError(code); }
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const id = z.string().min(1).max(200);
export const short = z.string().min(1).max(200);
export const body = z.string().min(1).refine(v => Buffer.byteLength(v) <= 65536, 'max 64 KiB');
export const sendSchema = z.object({ to: id, body, key: short, replyTo: id.optional(), priority: z.enum(['urgent','high','normal','low']).default('normal'), urgentReason: z.string().trim().min(1).max(200).optional(), delayMs: z.number().int().min(0).max(604800000).default(0), ttlMs: z.number().int().min(1).max(86400000).default(86400000) }).strict();
export const taskSchema = z.object({ title: short, criteria: z.string().min(1).max(4000).refine(v => Buffer.byteLength(JSON.stringify(v)) <= 4096, 'encoded criteria exceeds 4 KiB'), key: short }).strict();
export interface Session { id: string; workspace: string; alias: string; provider: string; revoked: number }
export interface Message { seq: number; id: string; workspace: string; sender: string; recipient: string; body: string; reply_to: string | null; status: string; created_at: string }
export type Priority = 'urgent' | 'high' | 'normal' | 'low';
export interface QueuedMessage extends Message { priority: Priority; urgent_reason: string | null; created_ms: number; due_at: number; expires_at: number | null; receipt: string | null; lease_until: number | null; attempts: number; delivered_at: number | null; digest: string; legacy: number }
export interface Task { id: string; workspace: string; creator: string; title: string; criteria: string; state: string; owner: string | null; version: number; result_hash: string | null; created_at: string }
