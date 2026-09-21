import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesPath } from "../src/glob.mjs";
import { selectPaths } from "../src/select.mjs";
test("globstar spans zero or many directories", () => {
  assert.equal(matchesPath("src/**/*.js", "src/a.js"), true);
  assert.equal(matchesPath("src/**/*.js", "src/x/y/a.js"), true);
  assert.equal(matchesPath("src/*.js", "src/x/a.js"), false);
});
test("last matching rule wins", () =>
  assert.deepEqual(
    selectPaths(
      ["a.js", "test/a.js"],
      [
        { pattern: "**", include: true },
        { pattern: "test/**", include: false },
      ],
    ),
    ["a.js"],
  ));
