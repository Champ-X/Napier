import assert from "node:assert/strict";
import { matchesPath as match } from "./src/glob.mjs";
import { selectPaths } from "./src/select.mjs";
for (const [p, s, result] of [
  ["**/a", "a", true],
  ["a/**/b", "a/b", true],
  ["a/**/b", "a/x/y/b", true],
  ["a/*/b", "a/b", false],
  ["?.js", "😀.js", true],
  ["??.js", "😀.js", false],
  ["[a].js", "a.js", false],
  ["[a].js", "[a].js", true],
  ["a+.js", "aa.js", false],
  ["**", ".git/config", true],
  ["A", "a", false],
  ["a/**", "a", true],
  ["**/**/x", "a/b/x", true],
])
  assert.equal(match(p, s), result, p + " " + s);
for (const p of ["", null, "/a", "a/", "a//b", "a/../b", "./a", "a\\b", "a**b"])
  assert.throws(() => match(p, "a"), TypeError);
for (const p of ["a*", "a?", "a//b", ".."])
  assert.throws(() => match("**", p), TypeError);
for (const args of [
  [[], [{ pattern: "a**b", include: true }]],
  [[], [{ pattern: "*", include: 1 }]],
  [Array(1), []],
  [[], Array(1)],
  [["../x"], []],
])
  assert.throws(() => selectPaths(...args), TypeError);
const paths = Object.freeze([
    "src/a.js",
    "src/a.test.js",
    "src/keep.test.js",
    "README",
    "src/a.js",
  ]),
  rules = Object.freeze([
    { pattern: "**/*.js", include: true },
    { pattern: "**/*.test.js", include: false },
    { pattern: "src/keep*", include: true },
  ]);
assert.deepEqual(selectPaths(paths, rules), ["src/a.js", "src/keep.test.js"]);
// Independent regular-expression oracle for single-component ASCII globs.
const patterns = ["*", "?", "a*", "*b", "a?b", "*a*b*", "a.b", "[x]"];
const values = ["a", "b", "ab", "aab", "acb", "baab", "a.b", "[x]"];
for (const p of patterns) {
  let regex = "^";
  for (const c of p)
    regex +=
      c === "*"
        ? ".*"
        : c === "?"
          ? "."
          : c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  regex += "$";
  for (const v of values) assert.equal(match(p, v), new RegExp(regex).test(v));
}
console.log("Glob path boundaries, Unicode and ordered selection passed");
