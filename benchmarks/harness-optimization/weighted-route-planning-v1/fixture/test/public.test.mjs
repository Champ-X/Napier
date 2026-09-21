import { test } from "node:test";
import assert from "node:assert/strict";
import { shortestRoute } from "../src/route.mjs";
test("lower cost multi-hop route wins", () =>
  assert.deepEqual(
    shortestRoute(
      ["a", "b", "c"],
      [
        { from: "a", to: "c", cost: 9 },
        { from: "a", to: "b", cost: 2 },
        { from: "b", to: "c", cost: 3 },
      ],
      "a",
      "c",
    ),
    { cost: 5, path: ["a", "b", "c"] },
  ));
