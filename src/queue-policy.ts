import type { Priority } from './domain.js';

// Public policy metadata and implementation share these constants.
export const queuePolicy = {
  version: 1,
  delay_ms: { urgent: 0, high: 1000, normal: 5000, low: 30000 },
  lease_ms: 30000,
  max_attempts: 5,
  aging_ms: 30000,
  starvation_ms: 120000,
  urgent_limit: 3,
  urgent_window_ms: 60000,
  capacity: 100,
} as const;

export function retryDelay(attempts: number): number {
  return Math.min(60000, 1000 * 2 ** (attempts - 1));
}

export function canDeliver(state: string, priority: Priority): boolean {
  return state === 'available' || (state === 'busy' && priority === 'urgent');
}

export function deliveryRank(message: {priority: Priority; due_at: number}, now: number): number {
  if (message.priority === 'urgent') return 3;
  const initial = {low: 0, normal: 1, high: 2}[message.priority];
  return Math.min(2, initial + Math.floor((now - message.due_at) / queuePolicy.aging_ms));
}
