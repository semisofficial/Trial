export const INDIA_TIME_ZONE = "Asia/Kolkata";

export function formatIndiaDate(value) {
  return new Date(value).toLocaleDateString("en-IN", {
    timeZone: INDIA_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatIndiaDateTime(value) {
  const time = new Date(value).toLocaleTimeString('en-IN', {
    timeZone: INDIA_TIME_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  });
  return `${formatIndiaDate(value)}, ${time} IST`;
}

export function indiaCalendarDateKey(value = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: INDIA_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(value)).map(({ type, value: partValue }) => [type, partValue])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Business calendar arithmetic is independent of the browser's timezone/DST.
// UTC here is only a calendar scratchpad; returned bounds are IST instants.
export function indiaRangeBounds(range, reference = new Date()) {
  if (range === 'all') return { start: -Infinity, end: Infinity };
  const date = typeof reference === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(reference)
    ? reference : indiaCalendarDateKey(reference || new Date());
  const start = new Date(`${date}T00:00:00Z`);
  if (range === 'week') start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  if (range === 'month') start.setUTCDate(1);
  const next = new Date(start);
  if (range === 'month') next.setUTCMonth(next.getUTCMonth() + 1);
  else next.setUTCDate(next.getUTCDate() + (range === 'week' ? 7 : 1));
  const istOffsetMs = 330 * 60 * 1000;
  return { start: start.getTime() - istOffsetMs, end: next.getTime() - istOffsetMs - 1 };
}

export function indiaWeekLabel(value) {
  const { start, end } = indiaRangeBounds('week', value);
  return `${formatIndiaDate(start)} – ${formatIndiaDate(end)}`;
}
