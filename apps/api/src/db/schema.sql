PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS recipients (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  city TEXT NOT NULL,
  country TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency = 'MXN'),
  bank_account_masked TEXT NOT NULL,
  bank_account_token TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES recipients(id),
  mode TEXT NOT NULL CHECK (mode IN ('send', 'receive')),
  rate_e4 INTEGER NOT NULL,
  send_minor INTEGER NOT NULL,
  fee_minor INTEGER NOT NULL,
  convert_minor INTEGER NOT NULL,
  receive_minor INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'consumed', 'expired')),
  payout_id TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS payouts (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL UNIQUE REFERENCES quotes(id),
  recipient_id TEXT NOT NULL REFERENCES recipients(id),
  send_minor INTEGER NOT NULL,
  fee_minor INTEGER NOT NULL,
  convert_minor INTEGER NOT NULL,
  receive_minor INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'created',
      'collecting',
      'transferring',
      'paying_out',
      'delivered',
      'failed',
      'refunding',
      'refunded'
    )
  ),
  failure_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS payout_legs (
  payout_id TEXT NOT NULL REFERENCES payouts(id),
  leg TEXT NOT NULL CHECK (leg IN ('collect', 'transfer', 'deposit', 'refund')),
  status TEXT NOT NULL CHECK (
    status IN (
      'waiting',
      'submitted',
      'checking',
      'processing',
      'confirming',
      'succeeded',
      'failed',
      'final',
      'dropped'
    )
  ),
  attempt INTEGER NOT NULL DEFAULT 0,
  provider_ref TEXT,
  tx_hash TEXT,
  confirmations INTEGER,
  last_seq INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (payout_id, leg)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  payout_id TEXT NOT NULL REFERENCES payouts(id),
  journal_id TEXT NOT NULL,
  account TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('USD', 'DUSD', 'MXN')),
  amount_minor INTEGER NOT NULL,
  memo TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payout_id TEXT NOT NULL REFERENCES payouts(id),
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS inbox_events (
  event_id TEXT PRIMARY KEY,
  payout_id TEXT NOT NULL,
  leg TEXT NOT NULL,
  seq INTEGER NOT NULL,
  status TEXT NOT NULL,
  received_at TEXT NOT NULL,
  applied INTEGER NOT NULL CHECK (applied IN (0, 1))
);

CREATE TABLE IF NOT EXISTS ops_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (
    kind IN ('api', 'db', 'state', 'webhook', 'worker', 'provider', 'ledger', 'sim')
  ),
  level TEXT NOT NULL,
  payout_id TEXT,
  message TEXT NOT NULL,
  data TEXT
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  body_hash TEXT NOT NULL,
  payout_id TEXT,
  response_status INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
