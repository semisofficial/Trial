import test from "node:test";
import assert from "node:assert/strict";

import {
  applyDeliveryDateInput,
  deliveryDateIsUnavailable,
  mainsSundayBlocked,
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

test("Sunday delivery blocks mains-only carts and permits mixed snack carts", () => {
  const mains = [{ cat: "mains" }];
  assert.equal(mainsSundayBlocked(mains, "2026-09-13", "Delivery"), true);
  assert.equal(mainsSundayBlocked(mains, "2026-09-14", "Delivery"), false);
  assert.equal(mainsSundayBlocked(mains, "2026-09-13", "Pickup"), false);
  for (const cat of ["fried", "frozen"]) assert.equal(mainsSundayBlocked([...mains, { cat }], "2026-09-13", "Delivery"), false);
});

test("past-date validation remains separate from typing", () => {
  assert.equal(deliveryDateIsUnavailable("0002-09-08", "2026-09-08"), true);
  assert.equal(deliveryDateIsUnavailable("2026-09-08", "2026-09-08"), false);
  assert.equal(deliveryDateIsUnavailable("2026-09-09", "2026-09-08"), false);
  assert.equal(deliveryDateIsUnavailable("", "2026-09-08"), false);
});
