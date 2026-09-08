import test from "node:test";
import assert from "node:assert/strict";

import { floatingCartPlacement } from "../src/lib/floatingCart.js";

test("floating cart stays fixed until the footer is reached", () => {
  assert.deepEqual(floatingCartPlacement(false, 240), {
    position: "fixed",
    bottom: 20,
  });
});

test("floating cart docks once above the footer without following each scroll frame", () => {
  assert.deepEqual(floatingCartPlacement(true, 240), {
    position: "absolute",
    bottom: 260,
  });
});
