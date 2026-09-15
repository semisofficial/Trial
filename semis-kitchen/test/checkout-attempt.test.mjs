import { test } from 'node:test';
import assert from 'node:assert/strict';

test('unchanged failed checkouts reuse a UUID; changed details or a completed attempt get a fresh key', async () => {
  const { checkoutAttempt } = await import('../src/lib/checkoutAttempt.js');
  const payload = { items: [{ id: 'snack', qty: 10 }], customer: { name: 'Fixture', phone: '0000000000' } };
  const first = checkoutAttempt(null, payload);
  assert.match(first.key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(checkoutAttempt(first, structuredClone(payload)).key, first.key);
  assert.notEqual(checkoutAttempt(first, { ...payload, items: [{ id: 'snack', qty: 20 }] }).key, first.key);
  assert.notEqual(checkoutAttempt(first, { ...payload, customer: { ...payload.customer, name: 'Other customer' } }).key, first.key);
  assert.notEqual(checkoutAttempt(null, payload).key, first.key);
});
