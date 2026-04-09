CREATE TABLE IF NOT EXISTS proxy_catalog (
  source_message_id TEXT PRIMARY KEY,
  proxy_number INTEGER NOT NULL UNIQUE,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
