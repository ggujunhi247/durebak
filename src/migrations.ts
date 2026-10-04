import type { DatabaseSync } from 'node:sqlite';
import { fail } from './domain.js';
import { transaction } from './transactions.js';

export const schemaVersion = 11;

// Preserve released migration SQL and append new versions at the end.
export function migrate(db: DatabaseSync) {
    const version = (db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version;
    if (version > schemaVersion) { fail('unsupported_database_version'); }
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, workspace TEXT NOT NULL, alias TEXT NOT NULL, provider TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE, revoked INTEGER NOT NULL DEFAULT 0, UNIQUE(workspace, alias)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS messages (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, workspace TEXT NOT NULL,
        sender TEXT NOT NULL REFERENCES sessions(id), recipient TEXT NOT NULL REFERENCES sessions(id),
        body TEXT NOT NULL, reply_to TEXT, status TEXT NOT NULL DEFAULT 'sent', created_at TEXT NOT NULL,
        key TEXT NOT NULL, digest TEXT NOT NULL, UNIQUE(sender,key)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS inbox_idx ON messages(recipient,seq);
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, workspace TEXT NOT NULL, creator TEXT NOT NULL REFERENCES sessions(id),
        title TEXT NOT NULL, criteria TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', owner TEXT,
        version INTEGER NOT NULL DEFAULT 1, result_hash TEXT, created_at TEXT NOT NULL,
        key TEXT NOT NULL, digest TEXT NOT NULL, UNIQUE(creator,key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS artifacts (
        workspace TEXT NOT NULL, hash TEXT NOT NULL, content TEXT NOT NULL, bytes INTEGER NOT NULL,
        PRIMARY KEY(workspace,hash)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, workspace TEXT NOT NULL, kind TEXT NOT NULL,
        entity TEXT NOT NULL, created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS cache (
        workspace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, bytes INTEGER NOT NULL,
        touched INTEGER NOT NULL, PRIMARY KEY(workspace,key)
      ) STRICT;

    `);
    transaction(db, () => {
      if ((db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version < 2) {
        db.exec(`
          ALTER TABLE sessions ADD COLUMN availability TEXT NOT NULL DEFAULT 'available';
          ALTER TABLE messages ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
          ALTER TABLE messages ADD COLUMN urgent_reason TEXT;
          ALTER TABLE messages ADD COLUMN created_ms INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE messages ADD COLUMN due_at INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE messages ADD COLUMN expires_at INTEGER;
          ALTER TABLE messages ADD COLUMN receipt TEXT;
          ALTER TABLE messages ADD COLUMN lease_until INTEGER;
          ALTER TABLE messages ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE messages ADD COLUMN delivered_at INTEGER;
          ALTER TABLE messages ADD COLUMN legacy INTEGER NOT NULL DEFAULT 1;
          UPDATE messages SET created_ms=CAST(unixepoch(created_at)*1000 AS INTEGER), due_at=CAST(unixepoch(created_at)*1000 AS INTEGER);
          UPDATE messages SET delivered_at=created_ms WHERE status='read';
          UPDATE messages SET status='queued' WHERE status='sent';
          CREATE INDEX queue_idx ON messages(recipient,status,due_at);
          CREATE INDEX urgent_idx ON messages(sender,priority,created_ms);
          PRAGMA user_version=2;
        `);
      }
      if ((db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version < 3) {
        db.exec(`
          CREATE TABLE delivery_audit (
            cursor INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT NOT NULL UNIQUE REFERENCES messages(id),
            recipient TEXT NOT NULL REFERENCES sessions(id)
          ) STRICT;
          CREATE INDEX delivery_recipient_idx ON delivery_audit(recipient,cursor);
          INSERT INTO delivery_audit(message_id,recipient)
            SELECT id,recipient FROM messages WHERE delivered_at IS NOT NULL ORDER BY delivered_at,seq;
          PRAGMA user_version=3;
        `);
      }
      if ((db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version < 4) {
        db.exec(`
          CREATE TABLE session_activity (
            session_id TEXT PRIMARY KEY REFERENCES sessions(id), last_activity_ms INTEGER NOT NULL
          ) STRICT;
          CREATE TABLE bridge_observations (
            session_id TEXT NOT NULL REFERENCES sessions(id), instance TEXT NOT NULL,
            epoch TEXT NOT NULL, last_seen_ms INTEGER NOT NULL, closed INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(session_id,instance)
          ) STRICT;
          PRAGMA user_version=4;
        `);
      }
      if ((db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version < 5) {
        db.exec(`
          CREATE TABLE requests (
            id TEXT PRIMARY KEY, workspace TEXT NOT NULL, creator TEXT NOT NULL REFERENCES sessions(id),
            recipient TEXT NOT NULL REFERENCES sessions(id), message_id TEXT NOT NULL REFERENCES messages(id),
            state TEXT NOT NULL DEFAULT 'pending', version INTEGER NOT NULL DEFAULT 1,
            reason_code TEXT, detail TEXT,
            created_ms INTEGER NOT NULL, deadline_at INTEGER NOT NULL, key TEXT NOT NULL, digest TEXT NOT NULL,
            UNIQUE(creator,key)
          ) STRICT;
          CREATE INDEX request_participants ON requests(workspace,creator,recipient,state);
          CREATE TABLE request_messages (
            message_id TEXT PRIMARY KEY REFERENCES messages(id), request_id TEXT NOT NULL REFERENCES requests(id), kind TEXT NOT NULL,
            author TEXT REFERENCES sessions(id), key TEXT, digest TEXT, UNIQUE(request_id,author,key)
          ) STRICT;
          CREATE INDEX request_conversation ON request_messages(request_id,message_id);
          CREATE TABLE request_late (
            request_id TEXT NOT NULL REFERENCES requests(id), author TEXT NOT NULL REFERENCES sessions(id),
            key TEXT NOT NULL, digest TEXT NOT NULL, body TEXT NOT NULL, created_ms INTEGER NOT NULL,
            PRIMARY KEY(request_id,author,key)
          ) STRICT;
          CREATE TABLE request_controls (
            cursor INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL REFERENCES requests(id),
            recipient TEXT NOT NULL REFERENCES sessions(id), reason TEXT NOT NULL, created_ms INTEGER NOT NULL,
            observed_ms INTEGER, acked_ms INTEGER, UNIQUE(request_id,recipient,reason)
          ) STRICT;
          CREATE TABLE consumer_checkpoints (
            session_id TEXT NOT NULL REFERENCES sessions(id), consumer TEXT NOT NULL,
            version INTEGER NOT NULL, message_cursor INTEGER NOT NULL, control_cursor INTEGER NOT NULL,
            PRIMARY KEY(session_id,consumer)
          ) STRICT;
          PRAGMA user_version=5;
        `);
      }
      if ((db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version < 6) {
        db.exec(`
          CREATE TABLE request_previews (
            id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES sessions(id), payload TEXT NOT NULL,
            digest TEXT NOT NULL, created_ms INTEGER NOT NULL, expires_at INTEGER NOT NULL
          ) STRICT;
          CREATE INDEX preview_owner ON request_previews(owner,expires_at);
          PRAGMA user_version=6;
        `);
      }
      if ((db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version < 7) {
        db.exec(`
          CREATE TABLE request_tasks (
            request_id TEXT PRIMARY KEY REFERENCES requests(id), task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id)
          ) STRICT;
          PRAGMA user_version=7;
        `);
      }
      if ((db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version < 8) {
        db.exec(`
          CREATE TABLE private_uploads (
            id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES sessions(id), workspace TEXT NOT NULL,
            name TEXT NOT NULL, hash TEXT NOT NULL, content TEXT NOT NULL, bytes INTEGER NOT NULL,
            key TEXT NOT NULL, digest TEXT NOT NULL, UNIQUE(owner,key)
          ) STRICT;
          CREATE TABLE request_attachment_handles (
            cursor INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
            request_id TEXT NOT NULL REFERENCES requests(id), message_id TEXT NOT NULL REFERENCES messages(id),
            upload_id TEXT NOT NULL REFERENCES private_uploads(id), UNIQUE(message_id,upload_id)
          ) STRICT;
          CREATE INDEX scoped_attachment_request ON request_attachment_handles(request_id,cursor);
          ALTER TABLE request_previews ADD COLUMN attachment_digest TEXT;
          PRAGMA user_version=8;
        `);
      }
      if ((db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version < 9) {
        db.exec(`
          CREATE TABLE task_revisions (
            cursor INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
            request_id TEXT NOT NULL REFERENCES requests(id), task_id TEXT NOT NULL REFERENCES tasks(id),
            upload_id TEXT NOT NULL REFERENCES private_uploads(id), handle_id TEXT NOT NULL REFERENCES request_attachment_handles(id),
            message_id TEXT NOT NULL REFERENCES messages(id), hash TEXT NOT NULL, criteria_digest TEXT NOT NULL,
            author TEXT NOT NULL REFERENCES sessions(id), key TEXT NOT NULL, digest TEXT NOT NULL,
            created_ms INTEGER NOT NULL, task_version INTEGER NOT NULL, UNIQUE(request_id,author,key)
          ) STRICT;
          CREATE TABLE verification_evidence (
            cursor INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
            request_id TEXT NOT NULL REFERENCES requests(id), revision_id TEXT NOT NULL REFERENCES task_revisions(id),
            author TEXT NOT NULL REFERENCES sessions(id), key TEXT NOT NULL, digest TEXT NOT NULL,
            attempt TEXT NOT NULL, procedure TEXT NOT NULL, result TEXT NOT NULL,
            started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL, supersedes TEXT REFERENCES verification_evidence(id),
            created_ms INTEGER NOT NULL, UNIQUE(request_id,author,key), UNIQUE(request_id,author,attempt), UNIQUE(supersedes)
          ) STRICT;
          ALTER TABLE request_tasks ADD COLUMN result_revision_id TEXT REFERENCES task_revisions(id);
          ALTER TABLE request_tasks ADD COLUMN result_message_id TEXT REFERENCES messages(id);
          PRAGMA user_version=9;
        `);
      }
      if ((db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version < 10) {
        db.exec(`
          CREATE TABLE native_bindings (
            id TEXT PRIMARY KEY, session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id), workspace TEXT NOT NULL,
            harness TEXT NOT NULL, profile TEXT NOT NULL, native_id TEXT NOT NULL, instance TEXT NOT NULL,
            owner_hash TEXT NOT NULL, epoch INTEGER NOT NULL DEFAULT 1, lease_until INTEGER NOT NULL,
            execution_state TEXT NOT NULL DEFAULT 'unverified', created_ms INTEGER NOT NULL, last_owner_contact_ms INTEGER NOT NULL, last_observed_ms INTEGER NOT NULL,
            key TEXT NOT NULL UNIQUE, digest TEXT NOT NULL, UNIQUE(harness,profile,native_id)
          ) STRICT;
          CREATE TABLE managed_policies (
            binding_id TEXT PRIMARY KEY REFERENCES native_bindings(id), version INTEGER NOT NULL DEFAULT 1,
            enabled INTEGER NOT NULL DEFAULT 0, scope_id TEXT NOT NULL UNIQUE,
            max_turns INTEGER NOT NULL DEFAULT 30, max_concurrent INTEGER NOT NULL DEFAULT 3,
            expires_at INTEGER, grant_ttl_ms INTEGER NOT NULL DEFAULT 3600000, expired INTEGER NOT NULL DEFAULT 0,
            spent_turns INTEGER NOT NULL DEFAULT 0, active_turns INTEGER NOT NULL DEFAULT 0
          ) STRICT;
          CREATE TABLE managed_policy_updates (
            binding_id TEXT NOT NULL REFERENCES native_bindings(id), key TEXT NOT NULL,
            digest TEXT NOT NULL, snapshot TEXT NOT NULL, PRIMARY KEY(binding_id,key)
          ) STRICT;
          PRAGMA user_version=10;
        `);
      }
      if ((db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version < 11) {
        db.exec(`
          CREATE TABLE work_scopes (
            request_id TEXT PRIMARY KEY REFERENCES requests(id), scope_id TEXT NOT NULL,
            owner_binding TEXT NOT NULL REFERENCES native_bindings(id), max_turns INTEGER NOT NULL,
            max_concurrent INTEGER NOT NULL, expires_at INTEGER NOT NULL,
            spent_turns INTEGER NOT NULL DEFAULT 0, active_turns INTEGER NOT NULL DEFAULT 0
          ) STRICT;
          CREATE TABLE work_attempts (
            id TEXT PRIMARY KEY, binding_id TEXT NOT NULL REFERENCES native_bindings(id),
            workspace TEXT NOT NULL, request_id TEXT NOT NULL REFERENCES work_scopes(request_id),
            message_id TEXT NOT NULL REFERENCES messages(id), epoch INTEGER NOT NULL, instance TEXT NOT NULL,
            key TEXT NOT NULL, intent_digest TEXT NOT NULL, policy_digest TEXT NOT NULL, root_policy_digest TEXT NOT NULL,
            source_digest TEXT NOT NULL, source TEXT NOT NULL, created_ms INTEGER NOT NULL,
            state TEXT NOT NULL CHECK(state IN ('reserved','submitting','unknown','completed','cancelled')),
            UNIQUE(binding_id,key)
          ) STRICT;
          CREATE TABLE work_reservations (
            message_id TEXT PRIMARY KEY REFERENCES messages(id), attempt_id TEXT NOT NULL REFERENCES work_attempts(id)
          ) STRICT;
          CREATE INDEX work_attempt_binding ON work_attempts(binding_id,state);
          CREATE INDEX work_attempt_workspace ON work_attempts(workspace,state);
          PRAGMA user_version=11;
        `);
      }
    });
}
