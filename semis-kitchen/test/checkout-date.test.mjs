import test from "node:test";
import assert from "node:assert/strict";

import {
  applyDeliveryDateInput,
  deliveryDateIsUnavailable,
} from "../src/lib/deliveryDate.js";

test("typing a year preserves the entered day and month", () => {
  const form = {
    deliveryDate: "",
    deliverySlot: "15-16",
    name: "Customer",
  };

  const next = applyDeliveryDateInput(form, "0002-09-08");

  assert.equal(next.deliveryDate, "0002-09-08");
  assert.equal(next.deliverySlot, "");
  assert.equal(next.name, "Customer");
});

test("past-date validation remains separate from typing", () => {
  assert.equal(deliveryDateIsUnavailable("0002-09-08", "2026-09-08"), true);
  assert.equal(deliveryDateIsUnavailable("2026-09-08", "2026-09-08"), false);
  assert.equal(deliveryDateIsUnavailable("2026-09-09", "2026-09-08"), false);
  assert.equal(deliveryDateIsUnavailable("", "2026-09-08"), false);
});
