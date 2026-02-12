import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'messenger.db');

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    const fs = require('fs');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initializeSchema(db);
  }
  return db;
}

function initializeSchema(db: Database.Database): void {
  db.exec(`
    -- Identity attestations published by clients
    CREATE TABLE IF NOT EXISTS attestations (
      pgp_fingerprint TEXT NOT NULL,
      device_id TEXT NOT NULL,
      messaging_identity_public_key TEXT NOT NULL,
      pgp_signature TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (pgp_fingerprint, device_id)
    );

    -- Signed pre-keys for X3DH
    CREATE TABLE IF NOT EXISTS signed_prekeys (
      pgp_fingerprint TEXT NOT NULL,
      device_id TEXT NOT NULL,
      key_id INTEGER NOT NULL,
      public_key TEXT NOT NULL,
      signature TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (pgp_fingerprint, device_id, key_id)
    );

    -- One-time pre-keys for X3DH (consumed on fetch)
    CREATE TABLE IF NOT EXISTS onetime_prekeys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pgp_fingerprint TEXT NOT NULL,
      device_id TEXT NOT NULL,
      key_id INTEGER NOT NULL,
      public_key TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(pgp_fingerprint, device_id, key_id)
    );

    -- Device revocations
    CREATE TABLE IF NOT EXISTS revocations (
      pgp_fingerprint TEXT NOT NULL,
      revoked_device_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      pgp_signature TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (pgp_fingerprint, revoked_device_id)
    );

    -- Encrypted relay messages (store-and-forward)
    CREATE TABLE IF NOT EXISTS relay_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient_fingerprint TEXT NOT NULL,
      recipient_device_id TEXT NOT NULL,
      sender_fingerprint TEXT NOT NULL,
      encrypted_payload TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      ttl INTEGER NOT NULL DEFAULT 604800,
      fetched INTEGER NOT NULL DEFAULT 0
    );

    -- Index for efficient relay message fetching
    CREATE INDEX IF NOT EXISTS idx_relay_recipient
      ON relay_messages(recipient_fingerprint, recipient_device_id, fetched);

    -- Index for TTL cleanup
    CREATE INDEX IF NOT EXISTS idx_relay_ttl
      ON relay_messages(created_at);

    -- WebRTC signaling messages (ephemeral)
    CREATE TABLE IF NOT EXISTS signaling (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient_fingerprint TEXT NOT NULL,
      recipient_device_id TEXT NOT NULL,
      sender_fingerprint TEXT NOT NULL,
      sender_device_id TEXT NOT NULL,
      signal_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_signaling_recipient
      ON signaling(recipient_fingerprint, recipient_device_id);
  `);
}

/**
 * Clean up expired relay messages (called periodically).
 */
export function cleanupExpiredMessages(): number {
  const d = getDatabase();
  const result = d.prepare(`
    DELETE FROM relay_messages
    WHERE created_at + ttl < unixepoch()
  `).run();
  return result.changes;
}

/**
 * Clean up old signaling messages (older than 5 minutes).
 */
export function cleanupSignaling(): number {
  const d = getDatabase();
  const result = d.prepare(`
    DELETE FROM signaling
    WHERE created_at < unixepoch() - 300
  `).run();
  return result.changes;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
