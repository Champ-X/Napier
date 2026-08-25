import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { auditDeadCode } from "./check-dead-code.mjs";
import { auditDependencyOwnership } from "./check-dependency-ownership.mjs";
import { auditDesktopScope } from "./check-desktop-scope.mjs";
import { auditDuplicates } from "./check-duplicates.mjs";
import { auditPublicApi } from "./check-public-api.mjs";
import {
  readHygieneBaseline,
  readScriptRegistry,
} from "./repository-hygiene.mjs";

describe("repository hygiene gates", () => {
  it("keeps reviewed dynamic and manual entries registered with ownership metadata", async () => {
    const registry = await readScriptRegistry();

    expect(registry.paths.size).toBe(registry.entries.length);
    expect(registry.paths).toContain(
      "packages/runtime/src/browser-runtime-installer-child.ts",
    );
    expect(registry.paths).toContain(
      "scripts/run-credential-reference-canary.ts",
    );
  });

  it("ratchets reviewed dead code without accepting new unreachable files", async () => {
    const result = await auditDeadCode();

    expect(result).toMatchObject({
      ok: true,
      issues: [],
      unexpectedUnreachable: [],
      staleAllowedFiles: [],
      staleAllowedUnreachable: [],
    });
  }, 15_000);

  it("pins duplicate debt to a downward-only baseline", async () => {
    const result = await auditDuplicates();

    expect(result.ok).toBe(true);
    expect(result.observed.clones).toBeLessThanOrEqual(
      result.budget.maximumCloneCount,
    );
    expect(result.observed.duplicatedLines).toBeLessThanOrEqual(
      result.budget.maximumDuplicatedLines,
    );
  }, 15_000);

  it("keeps the exact three supported desktop viewports", async () => {
    const result = await auditDesktopScope();

    expect(result).toMatchObject({
      ok: true,
      observed: {
        supportedViewports: [
          { width: 1_280, height: 900 },
          { width: 1_440, height: 900 },
          { width: 1_920, height: 1_080 },
        ],
      },
    });
  });

  it("requires every bare import to belong to its workspace", async () => {
    await expect(auditDependencyOwnership()).resolves.toEqual({
      ok: true,
      issues: [],
    });
  }, 15_000);

  it("freezes public API and compatibility barrel growth", async () => {
    const result = await auditPublicApi();

    expect(result.ok).toBe(true);
    expect(result.observed.runtimeRootExports).toBeLessThanOrEqual(
      result.budget.maximumRuntimeRootExports,
    );
    expect(result.observed.internalRuntimeRootImportFiles).toBeLessThanOrEqual(
      result.budget.maximumInternalRuntimeRootImportFiles,
    );
    expect(result.observed.webDuplicateDefaultExports).toBeLessThanOrEqual(
      result.budget.maximumWebDuplicateDefaultExports,
    );
  }, 15_000);

  it("keeps the hygiene baseline immutable through the normal check path", async () => {
    const [before, baseline] = await Promise.all([
      readFile("docs/repository-hygiene-baseline.json", "utf8"),
      readHygieneBaseline(),
    ]);
    expect(baseline.capturedAtCommit).toBe("610e57c");
    expect(
      await readFile("docs/repository-hygiene-baseline.json", "utf8"),
    ).toBe(before);
  });
});
