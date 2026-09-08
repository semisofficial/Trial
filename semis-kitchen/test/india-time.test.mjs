import test from "node:test";
import assert from "node:assert/strict";

import { formatIndiaDate, indiaCalendarDateKey } from "../src/lib/dateTime.js";

test("admin timestamps use the Indian calendar day regardless of device timezone", () => {
  const nearMidnightUtc = "2026-09-08T20:00:00.000Z";
  assert.equal(formatIndiaDate(nearMidnightUtc), "09 Sept 2026");
  assert.equal(indiaCalendarDateKey(nearMidnightUtc), "2026-09-09");
});
