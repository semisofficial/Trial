import test from "node:test";
import assert from "node:assert/strict";

import { formatIndiaDate, formatIndiaDateTime, indiaCalendarDateKey, indiaRangeBounds, indiaWeekLabel } from "../src/lib/dateTime.js";

test("admin timestamps use the Indian calendar day regardless of device timezone", () => {
  const nearMidnightUtc = "2026-09-08T20:00:00.000Z";
  assert.equal(formatIndiaDate(nearMidnightUtc), "09 Sept 2026");
  assert.equal(indiaCalendarDateKey(nearMidnightUtc), "2026-09-09");
  assert.equal(formatIndiaDateTime('2026-09-08T18:30:01Z'),'09 Sept 2026, 12:00:01 am IST');
});

test('IST date ranges include midnight boundaries and never depend on the device timezone', () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo', 'Asia/Kolkata']) {
      process.env.TZ = zone;
      for (const [range, reference, from, to] of [
        ['day','2026-03-01','2026-02-28T18:30:00Z','2026-03-01T18:29:59.999Z'],
        ['week','2026-03-01','2026-02-22T18:30:00Z','2026-03-01T18:29:59.999Z'],
        ['week','2026-03-02','2026-03-01T18:30:00Z','2026-03-08T18:29:59.999Z'],
        ['month','2024-02-29','2024-01-31T18:30:00Z','2024-02-29T18:29:59.999Z'],
        ['month','2026-12-31','2026-11-30T18:30:00Z','2026-12-31T18:29:59.999Z'],
        ['day',Date.parse('2026-12-31T18:30:00Z'),'2026-12-31T18:30:00Z','2027-01-01T18:29:59.999Z'],
      ]) {
        assert.deepEqual(indiaRangeBounds(range,reference),{start:Date.parse(from),end:Date.parse(to)},`${zone}: ${range} ${reference}`);
      }
      assert.equal(indiaWeekLabel(Date.parse('2026-03-01T18:30:00Z')),'02 Mar 2026 – 08 Mar 2026');
      assert.deepEqual(indiaRangeBounds('all'),{start:-Infinity,end:Infinity});
    }
  } finally { if(previous===undefined)delete process.env.TZ; else process.env.TZ=previous; }
});
