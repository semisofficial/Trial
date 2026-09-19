-- Additive and re-runnable. Run against the intended database before enabling uploads.
-- Only one current payment image is retained; never touches orders or inventory.
CREATE TABLE IF NOT EXISTS payment_qr (
  id smallint PRIMARY KEY CHECK (id = 1),
  image bytea CHECK (image IS NULL OR octet_length(image) BETWEEN 1 AND 524288),
  version text NOT NULL,
  updated_at timestamptz,
  CHECK ((image IS NULL AND version = 'default' AND updated_at IS NULL)
    OR (image IS NOT NULL AND version <> 'default' AND updated_at IS NOT NULL))
);
INSERT INTO payment_qr(id, version) VALUES (1, 'default') ON CONFLICT (id) DO NOTHING;
