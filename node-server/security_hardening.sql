-- Apply after menu_offers.sql, before deploying the security release.
-- Additive, re-runnable; never alters existing orders, prices or inventory.
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  credential_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);

-- Two hashes per existing order, not a second copy of the customer's details.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS checkout_key_hash text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS checkout_request_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_checkout_key_hash
  ON orders(checkout_key_hash) WHERE checkout_key_hash IS NOT NULL;

-- A single row bounds outgoing email attempts across service restarts/instances.
CREATE TABLE IF NOT EXISTS admin_notification_budget (
  id smallint PRIMARY KEY CHECK (id = 1),
  budget_day date NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 100),
  last_sent_at timestamptz
);
INSERT INTO admin_notification_budget(id, budget_day)
VALUES (1, (now() AT TIME ZONE 'UTC')::date) ON CONFLICT (id) DO NOTHING;
