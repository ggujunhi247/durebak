-- Released schema 4 SQL snapshot, independent of the current migration function.

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
        

          CREATE TABLE delivery_audit (
            cursor INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT NOT NULL UNIQUE REFERENCES messages(id),
            recipient TEXT NOT NULL REFERENCES sessions(id)
          ) STRICT;
          CREATE INDEX delivery_recipient_idx ON delivery_audit(recipient,cursor);
          INSERT INTO delivery_audit(message_id,recipient)
            SELECT id,recipient FROM messages WHERE delivered_at IS NOT NULL ORDER BY delivered_at,seq;
          PRAGMA user_version=3;
        

          CREATE TABLE session_activity (
            session_id TEXT PRIMARY KEY REFERENCES sessions(id), last_activity_ms INTEGER NOT NULL
          ) STRICT;
          CREATE TABLE bridge_observations (
            session_id TEXT NOT NULL REFERENCES sessions(id), instance TEXT NOT NULL,
            epoch TEXT NOT NULL, last_seen_ms INTEGER NOT NULL, closed INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(session_id,instance)
          ) STRICT;
          PRAGMA user_version=4;
        