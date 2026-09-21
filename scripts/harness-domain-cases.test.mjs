import { test, expect } from "vitest";
import { mkdtemp, cp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
export const CASES = [
  "http-retry-policy-v1",
  "rollout-dependency-plan-v1",
  "access-rule-evaluation-v1",
  "booking-calendar-v1",
  "safe-csv-export-v1",
  "inventory-event-projection-v1",
  "weighted-expense-allocation-v1",
  "http-etag-preconditions-v1",
  "incremental-ndjson-v1",
  "bounded-async-queue-v1",
  "semantic-version-order-v1",
  "ttl-lru-cache-v1",
  "http-byte-ranges-v1",
  "sql-named-binding-v1",
  "transaction-savepoints-v1",
  "atomic-json-patch-v1",
  "weighted-route-planning-v1",
  "resumable-byte-upload-v1",
  "binary-frame-decoder-v1",
  "path-glob-selection-v1",
  "streaming-csv-decoder-v1",
  "business-calendar-v1",
  "source-map-vlq-v1",
  "bm25-document-search-v1",
];
for (const name of CASES)
  test(
    name + ": independent outcome rejects original and accepts reference",
    async () => {
      const root = await mkdtemp(
        path.join(os.tmpdir(), "napier-domain-grade-"),
      );
      const source = path.resolve("benchmarks/harness-optimization", name);
      try {
        await cp(path.join(source, "fixture"), root, { recursive: true });
        const manifest = JSON.parse(
          await readFile(path.join(source, "manifest.json"), "utf8"),
        );
        // A syntax/import accident is not the intended behavioral baseline.
        for (const file of manifest.allowedChangedPaths) {
          const syntax = file.endsWith(".py")
            ? spawnSync(
                "/usr/bin/python3",
                [
                  "-B",
                  "-c",
                  "import pathlib,sys; p=pathlib.Path(sys.argv[1]); compile(p.read_bytes(),str(p),'exec')",
                  file,
                ],
                { cwd: root, encoding: "utf8", timeout: 15000 },
              )
            : spawnSync(process.execPath, ["--check", file], {
                cwd: root,
                encoding: "utf8",
                timeout: 15000,
              });
          expect(syntax.status, syntax.stderr).toBe(0);
        }
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
        expect(grade().status, "Original behavioral defect must fail").not.toBe(
          0,
        );
        await cp(path.join(source, "expected"), root, { recursive: true });
        const outcome = grade();
        expect(outcome.status, outcome.stderr).toBe(0);
        const python = manifest.allowedChangedPaths.some((p) =>
          p.endsWith(".py"),
        );
        const publicTest = spawnSync(
          python ? "/usr/bin/python3" : process.execPath,
          python
            ? ["-B", "-m", "unittest", "discover", "-s", "tests", "-v"]
            : ["--test", "test/public.test.mjs"],
          { cwd: root, encoding: "utf8", timeout: 15000 },
        );
        expect(publicTest.status, publicTest.stderr + publicTest.stdout).toBe(
          0,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
