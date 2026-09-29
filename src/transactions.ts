import type { DatabaseSync } from 'node:sqlite';

// Nested transactions are intentionally unsupported. The caller owns the full
// operation boundary, including expiry maintenance and acknowledgement writes.
export function transaction<T>(db: DatabaseSync, operation: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
