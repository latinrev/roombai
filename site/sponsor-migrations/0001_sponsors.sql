CREATE TABLE IF NOT EXISTS sponsor_slots (
  id TEXT PRIMARY KEY,
  row_number INTEGER NOT NULL,
  side TEXT NOT NULL,
  active_order TEXT,
  reserved_order TEXT
);
CREATE TABLE IF NOT EXISTS sponsor_orders (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL REFERENCES sponsor_slots(id),
  owner_hash TEXT NOT NULL,
  company TEXT NOT NULL,
  website TEXT NOT NULL,
  logo TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'creating',
  session_id TEXT UNIQUE,
  checkout_url TEXT,
  payment_intent TEXT,
  created_at INTEGER NOT NULL,
  checkout_expires INTEGER NOT NULL,
  starts_at INTEGER,
  ends_at INTEGER,
  renews_order TEXT,
  suspended INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sponsor_payment ON sponsor_orders(payment_intent);
CREATE TABLE IF NOT EXISTS sponsor_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
INSERT OR IGNORE INTO sponsor_slots(id, row_number, side) VALUES
  ('left-1-1',1,'left'),('left-2-1',2,'left'),('left-2-2',2,'left'),
  ('left-3-1',3,'left'),('left-3-2',3,'left'),('left-3-3',3,'left'),
  ('left-4-1',4,'left'),('left-4-2',4,'left'),('left-4-3',4,'left'),('left-4-4',4,'left'),
  ('right-1-1',1,'right'),('right-2-1',2,'right'),('right-2-2',2,'right'),
  ('right-3-1',3,'right'),('right-3-2',3,'right'),('right-3-3',3,'right'),
  ('right-4-1',4,'right'),('right-4-2',4,'right'),('right-4-3',4,'right'),('right-4-4',4,'right');
