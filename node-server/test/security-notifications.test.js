const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { testDatabase } = require('../test-support/database');
const fixture = testDatabase();
let sends = 0;
let providerFails = false;
require.cache[require.resolve('resend')] = { exports: { Resend: class {
  emails = { send: async () => { sends++; return providerFails ? { error: { message: 'fixture rejection' } } : { data: { id: 'fixture-email' } }; } };
} } };
process.env.RESEND_API_KEY = 'test-only-not-a-real-key';
process.env.RESEND_FROM = 'fixture@example.invalid';
process.env.ADMIN_EMAIL = 'fixture@example.invalid';
const { sendNewOrderNotification } = require('../utils/emailNotify');
before(() => fixture.schema());
after(() => fixture.close());

test('a burst of successful orders generates only one email attempt within a minute', async () => {
  const before = sends;
  await Promise.all(Array.from({ length: 5 }, () => sendNewOrderNotification()));
  assert.equal(sends - before, 1);
});

test('the daily attempt cap persists across reloads and resets on a later UTC day', async () => {
  await fixture.query("UPDATE admin_notification_budget SET attempts=100, last_sent_at=now()-interval '2 minutes'");
  const before = sends;
  delete require.cache[require.resolve('../utils/emailNotify')];
  await require('../utils/emailNotify').sendNewOrderNotification();
  assert.equal(sends, before);
  await fixture.query("UPDATE admin_notification_budget SET budget_day=((now() AT TIME ZONE 'UTC')::date - 1)");
  await sendNewOrderNotification();
  assert.equal(sends, before + 1);
  assert.equal((await fixture.query('SELECT attempts FROM admin_notification_budget')).rows[0].attempts, 1);
});

test('provider rejection is reported and still consumes an attempt to bound retries', async () => {
  await fixture.query("UPDATE admin_notification_budget SET last_sent_at=now()-interval '2 minutes'");
  providerFails = true;
  try { await assert.rejects(sendNewOrderNotification(), /rejected/); }
  finally { providerFails = false; }
  const before = sends;
  await sendNewOrderNotification();
  assert.equal(sends, before);
});

test('unconfigured email never consumes budget or queries the database', async () => {
  const key = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  fixture.queries.length = 0;
  try { await sendNewOrderNotification(); assert.equal(fixture.queries.length, 0); }
  finally { process.env.RESEND_API_KEY = key; }
});
