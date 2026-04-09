CREATE TABLE IF NOT EXISTS content_modes (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  access_state TEXT NOT NULL CHECK (access_state IN ('public', 'locked')),
  is_enabled INTEGER NOT NULL DEFAULT 1,
  is_default_public INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 100,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS access_rules (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  hash_scheme TEXT NOT NULL DEFAULT 'scrypt_v2',
  target_mode TEXT NOT NULL REFERENCES content_modes(id),
  is_enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 100,
  notes TEXT,
  usage_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  max_uses INTEGER,
  first_use_only INTEGER NOT NULL DEFAULT 0,
  soft_deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wallets (
  id TEXT PRIMARY KEY,
  network TEXT NOT NULL,
  title TEXT NOT NULL,
  address TEXT NOT NULL,
  qr_payload TEXT NOT NULL,
  warning_text TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 100,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS proxy_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_live_refresh_at TEXT,
  last_snapshot_at TEXT,
  last_source_fetch_at TEXT,
  last_refresh_status TEXT DEFAULT 'booting',
  stale_reason TEXT,
  panic_mode INTEGER NOT NULL DEFAULT 0,
  session_version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS proxy_items_fresh (
  id TEXT PRIMARY KEY,
  proxy_number INTEGER NOT NULL,
  proxy_url TEXT NOT NULL,
  posted_at TEXT NOT NULL,
  source_message_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  click_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS proxy_items_archive (
  id TEXT PRIMARY KEY,
  proxy_number INTEGER NOT NULL,
  proxy_url TEXT NOT NULL,
  posted_at TEXT NOT NULL,
  source_message_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  click_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  access_rule_id TEXT,
  mode_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  mode_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  version INTEGER NOT NULL,
  is_revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS admin_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
