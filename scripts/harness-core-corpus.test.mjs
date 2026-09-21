import { test, expect } from "vitest";
import { mkdtemp, cp, rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { prepareHarnessSuite } from "./harness-suite.mjs";

test("core corpus freezes 30 unique tasks with no repeated shipping variants", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-core-corpus-"));
  try {
    const receipt = await prepareHarnessSuite(
      path.resolve("benchmarks/harness-core-quality-suite-v1.json"),
      path.join(root, "cases"),
    );
    expect(receipt.cases).toHaveLength(30);
    expect(new Set(receipt.cases.map((c) => c.inputSha256)).size).toBe(30);
    expect(
      receipt.cases.filter((c) =>
        c.coverage.some((tag) => tag.includes("shipping")),
      ),
    ).toHaveLength(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// These established cases have no public test runner; the migration's canonical
// target reference also needs its two callers migrated. Keep original cases and
// historical snapshots unchanged; build the complete reference in a temporary tree.
for (const relative of [
  "coding/loyalty-discount-debug-v1",
  "coding/pricing-options-migration-v1",
  "harness-optimization/memory-shipping-v1",
]) {
  test(
    relative +
      ": behavioral grader rejects original and accepts complete reference",
    async () => {
      const root = await mkdtemp(
        path.join(os.tmpdir(), "napier-core-reference-"),
      );
      const source = path.resolve("benchmarks", relative);
      try {
        const manifest = JSON.parse(
          await readFile(path.join(source, "manifest.json"), "utf8"),
        );
        await cp(path.join(source, manifest.fixturePath), root, {
          recursive: true,
        });
        await cp(
          path.join(source, manifest.outcomeTestPath),
          path.join(root, "__grade.mjs"),
        );
        for (const file of manifest.allowedChangedPaths) {
          const check = spawnSync(process.execPath, ["--check", file], {
            cwd: root,
            encoding: "utf8",
          });
          expect(check.status, check.stderr).toBe(0);
        }
        const grade = () =>
          spawnSync(process.execPath, ["__grade.mjs"], {
            cwd: root,
            encoding: "utf8",
            timeout: 15000,
          });
        expect(grade().status).not.toBe(0);
        if (relative.endsWith("memory-shipping-v1")) {
          const file = path.join(root, "src/shipping.js");
          await writeFile(
            file,
            (await readFile(file, "utf8")).replace(
              "subtotalCents > 6_000",
              "subtotalCents >= 6_000",
            ),
          );
        } else {
          await cp(path.join(source, "expected"), root, { recursive: true });
          if (relative.endsWith("pricing-options-migration-v1")) {
            await writeFile(
              path.join(root, "src/checkout.js"),
              'import { discountedTotalCents } from "./pricing.js";\nexport function checkoutTotalCents(order) { return discountedTotalCents({subtotalCents:order.subtotalCents,discountPercent:order.discountPercent}); }\n',
            );
            await writeFile(
              path.join(root, "src/quote.js"),
              'import { discountedTotalCents } from "./pricing.js";\nexport function quoteTotalCents(subtotalCents,discountPercent=0) { return discountedTotalCents({subtotalCents,discountPercent}); }\n',
            );
          }
        }
        const result = grade();
        expect(result.status, result.stderr + result.stdout).toBe(0);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
}
