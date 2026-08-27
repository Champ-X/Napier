import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  auditArchitecture,
  createArchitectureBaseline,
} from "./check-architecture.mjs";
import { analyzeRepository } from "./architecture-analysis.mjs";

const temporaryRoots = [];

describe("architecture growth gate", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryRoots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("accepts an explicit baseline for size, complexity, exports, and dependencies", async () => {
    const root = await createFixture();
    await writeBaseline(root);

    const result = await auditArchitecture({ repoRoot: root });

    expect(result).toMatchObject({
      ok: true,
      errors: [],
      sourceFileCount: 6,
      testFileCount: 1,
      cycleCount: 0,
    });
  });

  it("rejects growth in existing overrides and new oversized modules", async () => {
    const root = await createFixture();
    await writeBaseline(root);
    await writeFile(
      path.join(root, "packages/runtime/src/complex.ts"),
      `${complexSource("  if (value > 4) value -= 1;\n")}\nexport const padding = true;\n`,
    );
    await writeFile(
      path.join(root, "apps/server/src/oversized.ts"),
      "export const value = 1;\n".repeat(7),
    );

    const result = await auditArchitecture({ repoRoot: root });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "packages/runtime/src/complex.ts has function complexity",
        ),
        expect.stringContaining(
          "apps/server/src/oversized.ts has 7 lines, exceeding the 6-line budget",
        ),
      ]),
    );
  });

  it("requires reduced debt to ratchet its explicit baseline", async () => {
    const root = await createFixture();
    await writeBaseline(root);
    await writeFile(
      path.join(root, "packages/runtime/src/complex.ts"),
      "export function adjust(value: number): number {\n  return value;\n}\n",
    );

    const result = await auditArchitecture({ repoRoot: root });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("line override is stale"),
        expect.stringContaining("complexity override is stale"),
      ]),
    );
  });

  it("rejects public API growth and new relative import cycles", async () => {
    const root = await createFixture();
    await writeBaseline(root);
    await writeFile(
      path.join(root, "packages/contracts/src/index.ts"),
      [
        "export interface Contract { value: string }",
        "export interface AddedContract { value: number }",
        "",
      ].join("\n"),
    );
    await writeFile(
      path.join(root, "packages/runtime/src/value.ts"),
      [
        'import type { RuntimeValue } from "./index.js";',
        "export const value: RuntimeValue = { value: 'ok' };",
        "",
      ].join("\n"),
    );

    const result = await auditArchitecture({ repoRoot: root });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "packages/contracts/src/index.ts has 2 public exports, exceeding the 1 budget",
        expect.stringContaining("new relative import cycle"),
      ]),
    );
  });

  it("enforces workspace dependency direction", async () => {
    const root = await createFixture();
    await writeBaseline(root);
    await writeFile(
      path.join(root, "packages/contracts/src/index.ts"),
      [
        'import type { RuntimeValue } from "@napier/runtime";',
        "export interface Contract extends RuntimeValue {}",
        "",
      ].join("\n"),
    );

    const result = await auditArchitecture({ repoRoot: root });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "packages/contracts/src/index.ts imports forbidden workspace dependency @napier/runtime",
    );
  });

  it("rejects source fan-out and static change-coupling growth", async () => {
    const root = await createFixture();
    await writeBaseline(root, {
      maxSourceFanOut: 1,
      maxSourceChangeCoupling: 1,
    });
    await writeFile(
      path.join(root, "packages/runtime/src/helper.ts"),
      "export const helper = true;\n",
    );
    await writeFile(
      path.join(root, "packages/runtime/src/value.ts"),
      [
        'import type { Contract } from "@napier/contracts";',
        'import { adjust } from "./complex.js";',
        'import { helper } from "./helper.js";',
        "export const value: Contract = { value: String(adjust(Number(helper))) };",
        "",
      ].join("\n"),
    );

    const result = await auditArchitecture({ repoRoot: root });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "packages/runtime/src/value.ts has fan-out 2, exceeding the 1 budget",
        ),
        expect.stringContaining(
          "packages/runtime/src/value.ts has change coupling (fan-in * fan-out) 2",
        ),
      ]),
    );
  });

  it("fails closed on workspace instability growth and missing budgets", async () => {
    const root = await createFixture();
    await writeBaseline(root);
    await writeFile(
      path.join(root, "packages/contracts/src/index.ts"),
      [
        'import type { RuntimeValue } from "@napier/runtime";',
        "export interface Contract extends RuntimeValue {}",
        "",
      ].join("\n"),
    );

    const growth = await auditArchitecture({ repoRoot: root });

    expect(growth.ok).toBe(false);
    expect(growth.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "@napier/contracts has instability 0.333333, exceeding the 0 budget",
        ),
      ]),
    );

    const baseline = await createArchitectureBaseline({ repoRoot: root });
    delete baseline.sourceFanOutOverrides;
    await writeFile(
      path.join(root, "docs/architecture-budget.json"),
      `${JSON.stringify(baseline, null, 2)}\n`,
    );
    const missing = await auditArchitecture({ repoRoot: root });
    expect(missing.errors).toContain(
      "architecture budget sourceFanOutOverrides must be an object",
    );
  });

  it("keeps the SDK management subpath isolated from embedded application code", async () => {
    const repoRoot = path.resolve(import.meta.dirname, "..");
    const analysis = await analyzeRepository(repoRoot);
    const closure = relativeClosure(
      analysis.graph,
      "packages/sdk/src/management.ts",
    );

    expect([...closure].sort()).toEqual([
      "packages/sdk/src/management-client-error.ts",
      "packages/sdk/src/management-client.ts",
      "packages/sdk/src/management.ts",
    ]);
    for (const filePath of closure) {
      const file = analysis.filesByPath.get(filePath);
      expect(file).toBeDefined();
      expect(
        file.moduleSpecifiers.filter(
          (specifier) =>
            !specifier.startsWith(".") &&
            !specifier.startsWith("@napier/contracts/"),
        ),
      ).toEqual([]);
    }
  }, 20_000);

  it("retains the management public-entry pins when regenerating the repository baseline", async () => {
    const repoRoot = path.resolve(import.meta.dirname, "..");
    const baseline = await createArchitectureBaseline({ repoRoot });

    expect(baseline.publicExports).toMatchObject({
      "packages/contracts/src/management-http.ts": 6,
      "packages/sdk/src/management.ts": 5,
    });
  }, 20_000);
});

function relativeClosure(graph, entry) {
  const closure = new Set();
  const pending = [entry];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || closure.has(current)) continue;
    closure.add(current);
    pending.push(...(graph.get(current) ?? []));
  }
  return closure;
}

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-architecture-"));
  temporaryRoots.push(root);
  await Promise.all(
    [
      "apps/server/src",
      "apps/server/test",
      "packages/contracts/src",
      "packages/runtime/src",
      "packages/sdk/src",
      "docs",
    ].map((directory) =>
      mkdir(path.join(root, directory), { recursive: true }),
    ),
  );
  await Promise.all([
    writePackage(root, "apps/server", "@napier/server"),
    writePackage(root, "packages/contracts", "@napier/contracts"),
    writePackage(root, "packages/runtime", "@napier/runtime"),
    writePackage(root, "packages/sdk", "@napier/sdk"),
    writeFile(
      path.join(root, "apps/server/src/index.ts"),
      [
        'import { value } from "@napier/runtime";',
        "export const response = value;",
        "",
      ].join("\n"),
    ),
    writeFile(
      path.join(root, "apps/server/test/index.test.ts"),
      "export const testValue = true;\n",
    ),
    writeFile(
      path.join(root, "packages/contracts/src/index.ts"),
      "export interface Contract { value: string }\n",
    ),
    writeFile(
      path.join(root, "packages/runtime/src/index.ts"),
      [
        'export * from "./value.js";',
        "export interface RuntimeValue { value: string }",
        "",
      ].join("\n"),
    ),
    writeFile(
      path.join(root, "packages/runtime/src/value.ts"),
      [
        'import type { Contract } from "@napier/contracts";',
        "export const value: Contract = { value: 'ok' };",
        "",
      ].join("\n"),
    ),
    writeFile(
      path.join(root, "packages/runtime/src/complex.ts"),
      complexSource(),
    ),
    writeFile(
      path.join(root, "packages/sdk/src/index.ts"),
      'export type { Contract } from "@napier/contracts";\n',
    ),
  ]);
  return root;
}

async function writeBaseline(root, options = {}) {
  const baseline = await createArchitectureBaseline({
    repoRoot: root,
    sourceMaxLines: 6,
    testMaxLines: 3,
    maxFunctionComplexity: 2,
    ...options,
  });
  await writeFile(
    path.join(root, "docs/architecture-budget.json"),
    `${JSON.stringify(baseline, null, 2)}\n`,
  );
}

async function writePackage(root, directory, name) {
  await writeFile(
    path.join(root, directory, "package.json"),
    `${JSON.stringify({ name }, null, 2)}\n`,
  );
}

function complexSource(extra = "") {
  return [
    "export function adjust(value: number): number {",
    "  const original = value;",
    "  if (value > 1) value -= 1;",
    "  if (value > 2) value -= 1;",
    "  if (value > 3) value -= 1;",
    extra.trimEnd(),
    "  return Math.min(value, original);",
    "}",
    "",
  ]
    .filter(Boolean)
    .join("\n");
}
