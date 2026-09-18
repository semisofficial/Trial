-- OPTIONAL manual cleanup AFTER both applications have been deployed without offers.
-- Back up and verify the target Neon branch first. Run with the atomic migration runner:
-- node migrate.js remove_24_hour_offers.sql
-- Deletes promotion definitions only; orders and their saved invoice prices are independent.
-- No CASCADE: abort safely if an unexpected database dependency exists.
SET LOCAL lock_timeout = '5s';
DROP TABLE IF EXISTS offers;
