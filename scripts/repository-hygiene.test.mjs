import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { auditDeadCode } from "./check-dead-code.mjs";
import { auditDependencyOwnership } from "./check-dependency-ownership.mjs";
import { auditDesktopScope } from "./check-desktop-scope.mjs";
import { auditDuplicates } from "./check-duplicates.mjs";
import { auditPublicApi } from "./check-public-api.mjs";
import {
  collectPublicApi,
  readHygieneBaseline,
  readScriptRegistry,
} from "./repository-hygiene.mjs";

const temporaryRoots = [];

describe("repository hygiene gates", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryRoots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true })),
    );
  });

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
  }, 30_000);

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
    expect(result.observed.runtimeRootSemanticExports).toBe(1_896);
    expect(result.observed.runtimeRootSemanticExportSha256).toBe(
      "8be2c3a9341c07a60b8fbb333dacef42f5008b41a2602745eea9f786e4ac6806",
    );
    expect(result.observed.runtimePackageExportKeysSha256).toBe(
      result.budget.runtimePackageExportKeysSha256,
    );
    expect(result.observed.runtimeInternalSemanticExports).toBe(16);
    expect(result.observed.runtimeInternalSemanticExportSha256).toBe(
      result.budget.runtimeInternalSemanticExportSha256,
    );
    expect(result.observed.runtimeFacadeSemanticExports).toEqual(
      result.budget.runtimeFacadeSemanticExports,
    );
    expect(result.observed.runtimeFacadeSemanticExportSha256).toEqual(
      result.budget.runtimeFacadeSemanticExportSha256,
    );
    expect(result.observed.internalRuntimeRootImportFiles).toBeLessThanOrEqual(
      result.budget.maximumInternalRuntimeRootImportFiles,
    );
    expect(result.observed.webDuplicateDefaultExports).toBeLessThanOrEqual(
      result.budget.maximumWebDuplicateDefaultExports,
    );
  }, 15_000);

  it("rejects semantic root, facade, internal, and package export growth", async () => {
    const root = await createPublicApiFixture();
    const observed = await collectPublicApi(root);
    await writePublicApiBaseline(root, observed);
    await Promise.all([
      writeFile(
        path.join(root, "packages/runtime/src/value.ts"),
        "export const value = true;\nexport const leaked = true;\n",
      ),
      writeFile(
        path.join(root, "packages/runtime/src/public/agent.ts"),
        'export { value, leaked } from "../value.js";\n',
      ),
      writeFile(
        path.join(root, "packages/runtime/src/internal.ts"),
        "export const internalValue = true;\nexport const addedInternal = true;\n",
      ),
      writeFile(
        path.join(root, "packages/runtime/package.json"),
        `${JSON.stringify(
          {
            name: "@napier/runtime",
            exports: {
              ".": "./src/index.ts",
              "./internal": "./src/internal.ts",
              "./agent": "./src/public/agent.ts",
              "./added": "./src/value.ts",
            },
          },
          null,
          2,
        )}\n`,
      ),
    ]);

    const result = await auditPublicApi(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("runtimeRootSemanticExports 2 exceeds 1"),
        expect.stringContaining("runtimeRootSemanticExportSha256"),
        expect.stringContaining("runtimePackageExportKeys 4 exceeds 3"),
        expect.stringContaining("runtimePackageExportKeysSha256"),
        expect.stringContaining("runtimeInternalSemanticExports 2 exceeds 1"),
        expect.stringContaining("runtimeInternalSemanticExportSha256"),
        expect.stringContaining("runtime facade agent has 2 semantic exports"),
        expect.stringContaining("runtime facade agent semantic export digest"),
      ]),
    );
  });

  it("fails closed when a semantic public API budget is missing", async () => {
    const root = await createPublicApiFixture();
    const observed = await collectPublicApi(root);
    const baseline = publicApiBaseline(observed);
    delete baseline.publicApi.maximumRuntimeRootSemanticExports;
    await writeFile(
      path.join(root, "docs/repository-hygiene-baseline.json"),
      `${JSON.stringify(baseline, null, 2)}\n`,
    );

    const result = await auditPublicApi(root);

    expect(result).toMatchObject({
      ok: false,
      observed: undefined,
      errors: [
        "publicApi maximumRuntimeRootSemanticExports must be a non-negative integer",
      ],
    });
  });

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

async function createPublicApiFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-public-api-"));
  temporaryRoots.push(root);
  await Promise.all(
    ["apps/web/src", "packages/runtime/src/public", "docs"].map((directory) =>
      mkdir(path.join(root, directory), { recursive: true }),
    ),
  );
  await Promise.all([
    writeFile(
      path.join(root, "packages/runtime/package.json"),
      `${JSON.stringify(
        {
          name: "@napier/runtime",
          exports: {
            ".": "./src/index.ts",
            "./internal": "./src/internal.ts",
            "./agent": "./src/public/agent.ts",
          },
        },
        null,
        2,
      )}\n`,
    ),
    writeFile(
      path.join(root, "packages/runtime/src/index.ts"),
      'export * from "./value.js";\n',
    ),
    writeFile(
      path.join(root, "packages/runtime/src/value.ts"),
      "export const value = true;\n",
    ),
    writeFile(
      path.join(root, "packages/runtime/src/internal.ts"),
      "export const internalValue = true;\n",
    ),
    ...[
      "agent",
      "browser",
      "code",
      "core",
      "evaluation",
      "governance",
      "model",
      "store",
      "subagents",
      "tools",
      "workflow",
    ].map((entry) =>
      writeFile(
        path.join(root, `packages/runtime/src/public/${entry}.ts`),
        'export { value } from "../value.js";\n',
      ),
    ),
    writeFile(
      path.join(root, "apps/web/package.json"),
      `${JSON.stringify({ name: "@napier/web" }, null, 2)}\n`,
    ),
    writeFile(
      path.join(root, "apps/web/src/index.ts"),
      "export const web = true;\n",
    ),
  ]);
  return root;
}

async function writePublicApiBaseline(root, observed) {
  await writeFile(
    path.join(root, "docs/repository-hygiene-baseline.json"),
    `${JSON.stringify(publicApiBaseline(observed), null, 2)}\n`,
  );
}

function publicApiBaseline(observed) {
  return {
    kind: "napier.repository-hygiene-baseline",
    schemaVersion: 2,
    publicApi: {
      maximumRuntimeRootExports: observed.runtimeRootExports,
      maximumRuntimeRootSemanticExports: observed.runtimeRootSemanticExports,
      runtimeRootSemanticExportSha256: observed.runtimeRootSemanticExportSha256,
      maximumRuntimePackageExportKeys: observed.runtimePackageExportKeys,
      runtimePackageExportKeysSha256: observed.runtimePackageExportKeysSha256,
      maximumRuntimeInternalSemanticExports:
        observed.runtimeInternalSemanticExports,
      runtimeInternalSemanticExportSha256:
        observed.runtimeInternalSemanticExportSha256,
      runtimeFacadeSemanticExports: observed.runtimeFacadeSemanticExports,
      runtimeFacadeSemanticExportSha256:
        observed.runtimeFacadeSemanticExportSha256,
      maximumInternalRuntimeRootImportFiles:
        observed.internalRuntimeRootImportFiles,
      maximumWebDuplicateDefaultExports: observed.webDuplicateDefaultExports,
    },
  };
}
