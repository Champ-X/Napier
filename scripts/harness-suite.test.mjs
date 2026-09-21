import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  cp,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { prepareHarnessSuite, executeSuiteJobs } from "./harness-suite.mjs";

test("batch scheduling bounds concurrency, preserves failures and settles started work on cancellation", async () => {
  let active = 0,
    max = 0,
    finished = 0;
  const controller = new AbortController();
  const results = await executeSuiteJobs(
    [0, 1, 2, 3],
    async (id) => {
      active++;
      max = Math.max(active, max);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      finished++;
      if (id === 0) {
        controller.abort();
        throw new Error("retained failure");
      }
      return id;
    },
    { concurrency: 2, signal: controller.signal },
  );
  assert.equal(max, 2);
  assert.equal(finished, 2);
  assert.equal(results[0].status, "failed");
  assert.equal(results[1].status, "settled");
  assert.deepEqual(
    results.slice(2).map((r) => r.status),
    ["not_started", "not_started"],
  );
});

test("suite snapshots original inputs and rejects reused tasks, traversal and links", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-suite-test-"));
  try {
    const source = path.join(root, "one");
    await mkdir(path.join(source, "fixture"), { recursive: true });
    const manifest = {
      id: "one",
      promptPath: "prompt.md",
      fixturePath: "fixture",
      outcomeTestPath: "outcome.mjs",
    };
    await writeFile(
      path.join(source, "manifest.json"),
      JSON.stringify(manifest),
    );
    await writeFile(path.join(source, "prompt.md"), "Repair original");
    await writeFile(path.join(source, "outcome.mjs"), 'throw Error("unfixed")');
    await writeFile(path.join(source, "fixture/code.js"), "original");
    const suite = {
      kind: "napier.harness-optimization-suite",
      schemaVersion: 1,
      id: "suite",
      cases: [{ path: "one", coverage: ["edit"] }],
    };
    const file = path.join(root, "suite.json");
    await writeFile(file, JSON.stringify(suite));
    const snapshot = await prepareHarnessSuite(
      file,
      path.join(root, "snapshot"),
    );
    await writeFile(path.join(source, "fixture/code.js"), "changed");
    assert.equal(
      await readFile(
        path.join(snapshot.cases[0].path, "fixture/code.js"),
        "utf8",
      ),
      "original",
    );
    await assert.rejects(
      prepareHarnessSuite(file, path.join(root, "snapshot")),
      /EEXIST/,
    );
    await cp(source, path.join(root, "two"), { recursive: true });
    await writeFile(
      path.join(root, "two/manifest.json"),
      JSON.stringify({ ...manifest, id: "two" }),
    );
    await writeFile(
      file,
      JSON.stringify({
        ...suite,
        cases: [...suite.cases, { path: "two", coverage: ["edit"] }],
      }),
    );
    await assert.rejects(
      prepareHarnessSuite(file, path.join(root, "duplicate")),
      /Duplicate suite task/,
    );
    await writeFile(
      path.join(root, "two/outcome.mjs"),
      'throw Error("different grader")',
    );
    await assert.rejects(
      prepareHarnessSuite(file, path.join(root, "grader-alias")),
      /Duplicate suite task/,
    );
    await writeFile(
      file,
      JSON.stringify({
        ...suite,
        cases: [{ path: "../escape", coverage: ["edit"] }],
      }),
    );
    await assert.rejects(
      prepareHarnessSuite(file, path.join(root, "traversal")),
      /path\/coverage/,
    );
    await writeFile(file, JSON.stringify(suite));
    await symlink(path.join(source, "prompt.md"), path.join(source, "link"));
    await assert.rejects(
      prepareHarnessSuite(file, path.join(root, "linked")),
      /links/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const name of [
  "config-layers-v1",
  "cursor-pagination-v1",
  "ledger-reconciliation-v1",
])
  test(`${name}: independent grader rejects original bugs and accepts a contract-conforming reference`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "napier-case-grade-"));
    const source = path.resolve("benchmarks/harness-optimization", name);
    try {
      await cp(path.join(source, "fixture"), root, { recursive: true });
      await cp(
        path.join(source, "outcome.mjs"),
        path.join(root, "__grade.mjs"),
      );
      const grade = () =>
        spawnSync(process.execPath, ["__grade.mjs"], {
          cwd: root,
          encoding: "utf8",
          timeout: 15000,
        });
      assert.notEqual(grade().status, 0, "original defect must be detected");
      await cp(path.join(source, "expected"), root, { recursive: true });
      const result = grade();
      assert.equal(result.status, 0, result.stderr);
      if (name === "ledger-reconciliation-v1") {
        const parser = path.join(root, "src/events.py");
        await writeFile(
          parser,
          (await readFile(parser, "utf8")) +
            `
_parse_events = parse_events
class Record:
    __slots__ = ('fields',)
    def __init__(self, fields): self.fields = fields
    def __getitem__(self, key): return self.fields[key]
def parse_events(text): return [Record(e) for e in _parse_events(text)]
`,
        );
        const alternate = grade();
        assert.equal(alternate.status, 0, alternate.stderr);
        const report = path.join(root, "src/report.py");
        await writeFile(
          report,
          (await readFile(report, "utf8")) +
            `
_reconcile = reconcile
def reconcile(events, start, end):
    result = _reconcile(events, start, end)
    if events: events[0].fields['customer_id'] = 'mutated'
    return result
`,
        );
        assert.notEqual(
          grade().status,
          0,
          "nested mutation must be detected without record equality",
        );
      }
      if (name === "cursor-pagination-v1") {
        const cursor = path.join(root, "src/cursor.mjs");
        const original = await readFile(cursor, "utf8");
        await writeFile(
          cursor,
          original.replace(
            "export function decodeCursor",
            "function decodeCursorWithVersion",
          ) +
            `
export function decodeCursor(...args) {
  const {v, ...key} = decodeCursorWithVersion(...args);
  return key;
}
`,
        );
        const alternate = grade();
        assert.equal(alternate.status, 0, alternate.stderr);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
