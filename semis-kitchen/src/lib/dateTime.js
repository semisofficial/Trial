export const INDIA_TIME_ZONE = "Asia/Kolkata";

export function formatIndiaDate(value) {
  return new Date(value).toLocaleDateString("en-IN", {
    timeZone: INDIA_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
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
