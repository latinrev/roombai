CREATE TABLE IF NOT EXISTS community_totals (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  visits INTEGER NOT NULL DEFAULT 0,
  downloads INTEGER NOT NULL DEFAULT 0,
  since INTEGER NOT NULL
);
INSERT OR IGNORE INTO community_totals(id,since) VALUES (1,unixepoch());
CREATE TABLE IF NOT EXISTS community_visitors (
  id TEXT PRIMARY KEY,
  counted INTEGER NOT NULL DEFAULT 0,
  last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS community_visitors_seen ON community_visitors(last_seen);
CREATE TABLE IF NOT EXISTS community_downloads (
  id TEXT PRIMARY KEY,
  counted INTEGER NOT NULL DEFAULT 0,
  asset TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS community_downloads_created ON community_downloads(created_at);
CREATE TABLE IF NOT EXISTS community_installations (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  roombas INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS community_installations_seen ON community_installations(last_seen);
CREATE TABLE IF NOT EXISTS community_limits (
  id TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
