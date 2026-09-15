// Kept in a component ref only. No name, phone or address is persisted locally.
export function checkoutAttempt(previous, order) {
  const fingerprint = JSON.stringify(order);
  if (previous?.fingerprint === fingerprint) return previous;
  return { fingerprint, key: crypto.randomUUID() };
}
