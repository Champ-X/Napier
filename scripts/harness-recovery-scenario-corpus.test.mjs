import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { createHarnessScenarioController } from "./harness-scenario-controller.mjs";

const root = fileURLToPath(
  new URL(
    "../benchmarks/harness-optimization/steered-fee-policy-v1/",
    import.meta.url,
  ),
);

it("keeps amended acceptance distinct from the initial request and rejects legacy values and missing validation", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(root, "manifest.json"), "utf8"),
  );
  expect(manifest.kind).toBe("napier.harness-scenario-case");
  const scenario = JSON.parse(
    await readFile(path.join(root, manifest.scenarioPath), "utf8"),
  );
  expect(() =>
    createHarnessScenarioController({
      threadId: "thread_corpus",
      runId: "run_corpus",
      steps: scenario.steps,
    }),
  ).not.toThrow();
  const tmp = await mkdtemp(path.join(tmpdir(), "napier-scenario-corpus-"));
  try {
    await cp(path.join(root, "fixture"), tmp, { recursive: true });
    const grader = path.join(tmp, "grade.mjs");
    await writeFile(grader, await readFile(path.join(root, "outcome.mjs")));
    const grade = () =>
      spawnSync(process.execPath, [grader], { cwd: tmp, encoding: "utf8" });
    expect(grade().status).not.toBe(0);
    const reference = await readFile(path.join(root, "reference.mjs"), "utf8");
    await writeFile(path.join(tmp, "src/fees.mjs"), reference);
    expect(grade().status).toBe(0);
    expect(
      spawnSync(process.execPath, ["--test", "test/public.test.mjs"], {
        cwd: tmp,
      }).status,
    ).toBe(0);
    expect(
      spawnSync(
        process.execPath,
        [
          fileURLToPath(
            new URL("../node_modules/typescript/bin/tsc", import.meta.url),
          ),
          "-p",
          "tsconfig.json",
        ],
        { cwd: tmp },
      ).status,
    ).toBe(0);
    await writeFile(
      path.join(tmp, "src/fees.mjs"),
      reference.replace("subtotal < 120 ? 9", "subtotal < 100 ? 7"),
    );
    expect(grade().status).not.toBe(0);
    await writeFile(
      path.join(tmp, "src/fees.mjs"),
      "export function deliveryFee(subtotal, expedited = false) { return (subtotal < 120 ? 9 : 0) + (expedited ? 3 : 0); }\n",
    );
    expect(grade().status).not.toBe(0);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
