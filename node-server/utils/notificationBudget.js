const db = require('../config/db');

async function claimAdminEmailAttempt() {
  // One atomic UPDATE coordinates simultaneous orders. No polling, extra order
  // copies, or growing per-customer rate-limit records are needed.
  const result = await db.query(`UPDATE admin_notification_budget
    SET budget_day = (now() AT TIME ZONE 'UTC')::date,
        attempts = CASE WHEN budget_day = (now() AT TIME ZONE 'UTC')::date THEN attempts + 1 ELSE 1 END,
        last_sent_at = now()
    WHERE id = 1
      AND (budget_day <> (now() AT TIME ZONE 'UTC')::date OR attempts < 100)
      AND (last_sent_at IS NULL OR last_sent_at <= now() - interval '60 seconds')
    RETURNING id`);
  return result.rowCount === 1;
}

module.exports = { claimAdminEmailAttempt };
