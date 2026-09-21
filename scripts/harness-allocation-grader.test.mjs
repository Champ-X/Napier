import { test, expect } from "vitest";
import { mkdtemp, cp, rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

test("allocation grader accepts unspecified validation error classes but preserves capacity and invalid-input requirements", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "napier-allocation-grade-"),
  );
  const source = path.resolve(
    "benchmarks/harness-optimization/weighted-expense-allocation-v1",
  );
  try {
    await cp(path.join(source, "expected"), root, { recursive: true });
    await cp(path.join(source, "outcome.mjs"), path.join(root, "grade.mjs"));
    const allocationPath = path.join(root, "src/allocation.py");
    const original = await readFile(allocationPath, "utf8");
    const grade = () =>
      spawnSync(process.execPath, ["grade.mjs"], {
        cwd: root,
        encoding: "utf8",
        timeout: 15000,
      });
    const typed = original
      .replaceAll(
        "ValueError('Invalid allocation')",
        "TypeError('Invalid allocation')",
      )
      .replaceAll("ValueError('Invalid caps')", "TypeError('Invalid caps')");
    await writeFile(allocationPath, typed);
    let result = grade();
    expect(result.status, result.stderr).toBe(0);
    await writeFile(
      allocationPath,
      typed.replace(
        "ValueError('Insufficient capacity')",
        "TypeError('Insufficient capacity')",
      ),
    );
    expect(grade().status).not.toBe(0);
    await writeFile(
      allocationPath,
      typed +
        "\n_original=allocate\ndef allocate(total,weights,caps=None):\n if total is True:return {'a':1}\n return _original(total,weights,caps)\n",
    );
    expect(grade().status).not.toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
