import { expect, it } from "vitest";
import { inferModelHarnessTaskPhases } from "../src/model-harness-resolution.js";

const phases = (content: string) =>
  inferModelHarnessTaskPhases([{ role: "user", content, timestamp: 0 }]);

it.each(["call site", "call\nsite", "call-site", "call sites"])(
  "does not mistake a programming %s for a browser task",
  (term) => {
    expect(phases(`Refactor this function and update every ${term}.`)).toEqual([
      "coding",
    ]);
  },
);

it("preserves explicit browser work alongside programming call sites", () => {
  expect(
    phases("Fix every call site, then open the website and click its form."),
  ).toEqual(["browser", "coding"]);
  expect(phases("Open the site and navigate to its contact form.")).toEqual([
    "browser",
  ]);
});

it.each([
  "src/search.mjs",
  "packages/browser.ts",
  "src/latest.py",
  "src/site.vue",
  "C:\\src\\form.cs",
  "src/data.js",
])("treats %s as a code target rather than a task directive", (file) => {
  expect(
    phases(
      `Repair the implementation to satisfy README.md. Inspect sources and tests. Change only ${file}.`,
    ),
  ).toEqual(["coding"]);
});

it.each([
  "Repair the implementation and run the tests.",
  "Fix bugs in these files, then finish verification.",
  "Repair search ranking and preserve its public exports.",
  "Refactor the web server source code and run tests.",
])(
  "recognizes programming actions and their ordinary word forms: %s",
  (text) => {
    expect(phases(text)).toEqual(["coding"]);
  },
);

it.each([
  "Research official sources and repair src/search.mjs.",
  "Search for official documentation and implement the fix.",
  "Repair src/search.mjs, then search official sources for comparison.",
])("preserves explicit research alongside code targets: %s", (text) => {
  expect(phases(text)).toEqual(["research", "coding"]);
});

it("retains actual navigation and data work while ignoring resource basenames", () => {
  expect(
    phases("Open https://example.org/search/source.html and click its form."),
  ).toEqual(["browser"]);
  expect(phases("Analyze results.csv.")).toEqual(["data"]);
  expect(phases("Read the latest news and cite sources.")).toEqual([
    "research",
  ]);
});

it("preserves navigation to quoted URLs", () => {
  expect(phases("Open `https://example.org/source.html`.")).toEqual([
    "browser",
  ]);
  expect(phases('访问 "https://example.org/search"。')).toEqual(["browser"]);
});
