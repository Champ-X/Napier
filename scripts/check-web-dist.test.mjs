import { createHash } from "node:crypto";
import { execFile as execFileWithCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import {
  auditWebDist,
  createAuditReceiptVerification,
  createAuditReceipt,
  formatAuditResult,
  generateWebDistManifest,
  verifyWebDistReceipt,
} from "./check-web-dist.mjs";

const temporaryRoots = [];
const scriptPath = path.resolve("scripts/check-web-dist.mjs");
const updateManifestScriptPath = path.resolve(
  "scripts/update-web-dist-manifest.mjs",
);
const execFile = promisify(execFileWithCallback);

describe("Web dist release gate", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryRoots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("accepts a dist folder that exactly matches the manifest and budget", async () => {
    const { root, entryBytes } = await createFixture();

    const result = await auditWebDist({
      repoRoot: root,
      mainEntryBudgetBytes: 1024,
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.fileCount).toBe(2);
    expect(result.mainEntryPath).toBe("apps/web/dist/assets/index-demo.js");
    expect(result.mainEntryBytes).toBe(entryBytes);
    expect(formatAuditResult(result)).toContain(
      "Web dist audit passed: 2 files main apps/web/dist/assets/index-demo.js",
    );
    expect(formatAuditResult(result)).toContain(" dist ");
    expect(createAuditReceipt(result)).toMatchObject({
      type: "napier.web-dist-audit",
      schemaVersion: 1,
      ok: true,
      fileCount: 2,
      mainEntry: {
        path: "apps/web/dist/assets/index-demo.js",
        sizeBytes: entryBytes,
        budgetBytes: 1024,
        withinBudget: true,
      },
      manifest: { path: "docs/artifacts/web-dist-0.1.0.sha256" },
      errors: [],
    });
  });

  it("emits a machine-readable JSON receipt from the CLI", async () => {
    const { root } = await createFixture();

    const { stdout } = await execFile(process.execPath, [
      scriptPath,
      "--json",
      "--repo-root",
      root,
      "--main-entry-budget-bytes",
      "1024",
    ]);

    expect(JSON.parse(stdout)).toMatchObject({
      type: "napier.web-dist-audit",
      schemaVersion: 1,
      ok: true,
      fileCount: 2,
      mainEntry: {
        path: "apps/web/dist/assets/index-demo.js",
        withinBudget: true,
      },
      manifest: { path: "docs/artifacts/web-dist-0.1.0.sha256" },
      errors: [],
    });
  });

  it("writes a JSON receipt file only when the audit passes", async () => {
    const { root } = await createFixture();
    const receiptPath = path.join(root, "docs/artifacts/web-dist-audit.json");

    const { stdout } = await execFile(process.execPath, [
      scriptPath,
      "--repo-root",
      root,
      "--receipt-path",
      "docs/artifacts/web-dist-audit.json",
      "--main-entry-budget-bytes",
      "1024",
    ]);
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));

    expect(stdout).toContain("receipt docs/artifacts/web-dist-audit.json");
    expect(receipt).toMatchObject({
      type: "napier.web-dist-audit",
      schemaVersion: 1,
      ok: true,
      mainEntry: {
        path: "apps/web/dist/assets/index-demo.js",
        withinBudget: true,
      },
      errors: [],
    });
  });

  it("verifies a saved Web dist audit receipt", async () => {
    const { root } = await createFixture();
    await execFile(process.execPath, [
      scriptPath,
      "--repo-root",
      root,
      "--receipt-path",
      "docs/artifacts/web-dist-audit.json",
      "--main-entry-budget-bytes",
      "1024",
    ]);

    const verification = await verifyWebDistReceipt({
      repoRoot: root,
      verifyReceiptPath: "docs/artifacts/web-dist-audit.json",
      mainEntryBudgetBytes: 1024,
    });
    expect(verification.valid).toBe(true);
    expect(verification.errors).toEqual([]);
    expect(createAuditReceiptVerification(verification)).toMatchObject({
      type: "napier.web-dist-audit-verification",
      schemaVersion: 1,
      valid: true,
      receipt: { path: "docs/artifacts/web-dist-audit.json" },
      errors: [],
    });

    const { stdout } = await execFile(process.execPath, [
      scriptPath,
      "--json",
      "--repo-root",
      root,
      "--verify-receipt-path",
      "docs/artifacts/web-dist-audit.json",
      "--main-entry-budget-bytes",
      "1024",
    ]);
    expect(JSON.parse(stdout)).toMatchObject({
      type: "napier.web-dist-audit-verification",
      schemaVersion: 1,
      valid: true,
      receipt: { path: "docs/artifacts/web-dist-audit.json" },
      errors: [],
    });
  });

  it("rejects a saved receipt that no longer matches the current audit", async () => {
    const { root } = await createFixture();
    const receiptPath = path.join(root, "docs/artifacts/web-dist-audit.json");
    await execFile(process.execPath, [
      scriptPath,
      "--repo-root",
      root,
      "--receipt-path",
      "docs/artifacts/web-dist-audit.json",
      "--main-entry-budget-bytes",
      "1024",
    ]);
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    receipt.distContentSha256 = "0".repeat(64);
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2));

    const verification = await verifyWebDistReceipt({
      repoRoot: root,
      verifyReceiptPath: "docs/artifacts/web-dist-audit.json",
      mainEntryBudgetBytes: 1024,
    });

    expect(verification.valid).toBe(false);
    expect(verification.errors).toContain(
      "receipt does not match the current Web dist audit",
    );
  });

  it("rejects malformed Web dist audit receipts", async () => {
    const { root } = await createFixture();
    await writeFile(
      path.join(root, "docs/artifacts/web-dist-audit.json"),
      JSON.stringify({ type: "wrong", schemaVersion: 1, ok: true }),
    );

    const verification = await verifyWebDistReceipt({
      repoRoot: root,
      verifyReceiptPath: "docs/artifacts/web-dist-audit.json",
      mainEntryBudgetBytes: 1024,
    });

    expect(verification.valid).toBe(false);
    expect(verification.errors).toEqual(
      expect.arrayContaining([
        "receipt type must be napier.web-dist-audit",
        "receipt mainEntry must be an object",
        "receipt manifest must be an object",
        "receipt distContentSha256 must be a SHA-256 hex digest",
        "receipt errors must be an array",
      ]),
    );
  });

  it("rejects verify receipt paths outside the repo root", async () => {
    const { root } = await createFixture();

    await expect(
      execFile(process.execPath, [
        scriptPath,
        "--repo-root",
        root,
        "--verify-receipt-path",
        path.join(tmpdir(), "napier-web-dist-audit.json"),
        "--main-entry-budget-bytes",
        "1024",
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "verifyReceiptPath must be a repo-relative path",
      ),
    });
  });

  it("removes a stale receipt target when the audit fails", async () => {
    const { root } = await createFixture({ entryContent: "x".repeat(32) });
    const receiptPath = path.join(root, "docs/artifacts/web-dist-audit.json");
    await writeFile(receiptPath, JSON.stringify({ ok: true }));

    await expect(
      execFile(process.execPath, [
        scriptPath,
        "--repo-root",
        root,
        "--receipt-path",
        "docs/artifacts/web-dist-audit.json",
        "--main-entry-budget-bytes",
        "16",
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("main-entry budget"),
    });
    await expect(readFile(receiptPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects receipt output paths outside the repo root", async () => {
    const { root } = await createFixture();

    await expect(
      execFile(process.execPath, [
        scriptPath,
        "--repo-root",
        root,
        "--receipt-path",
        path.join(tmpdir(), "napier-web-dist-audit.json"),
        "--main-entry-budget-bytes",
        "1024",
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "--receipt-path must be a repo-relative path",
      ),
    });
  });

  it("generates and writes the canonical manifest for the current dist files", async () => {
    const { root, manifestText } = await createFixture();

    const generated = await generateWebDistManifest({ repoRoot: root });
    expect(generated).toMatchObject({
      fileCount: 2,
      manifestRoot: "apps/web/dist",
      manifestText: `${manifestText}\n`,
    });

    await writeFile(
      path.join(root, "docs/artifacts/web-dist-0.1.0.sha256"),
      "stale\n",
    );
    await execFile(process.execPath, [
      updateManifestScriptPath,
      "--repo-root",
      root,
    ]);

    const result = await auditWebDist({
      repoRoot: root,
      mainEntryBudgetBytes: 1024,
    });
    expect(result.ok).toBe(true);
    expect(result.distContentSha256).toBe(generated.distContentSha256);
  });

  it("fails manifest check mode when the generated manifest would differ", async () => {
    const { root } = await createFixture();
    await writeFile(
      path.join(root, "docs/artifacts/web-dist-0.1.0.sha256"),
      "stale\n",
    );

    await expect(
      execFile(process.execPath, [
        updateManifestScriptPath,
        "--check",
        "--repo-root",
        root,
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "docs/artifacts/web-dist-0.1.0.sha256 is stale",
      ),
    });
  });

  it("rejects manifest hash drift and unlisted dist files", async () => {
    const { root } = await createFixture();
    await writeFile(
      path.join(root, "apps/web/dist/assets/index-demo.js"),
      "console.log('changed');\n",
    );
    await writeFile(
      path.join(root, "apps/web/dist/assets/extra.js"),
      "extra\n",
    );

    const result = await auditWebDist({
      repoRoot: root,
      mainEntryBudgetBytes: 1024,
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "apps/web/dist/assets/index-demo.js hash mismatch",
        ),
        "apps/web/dist/assets/extra.js exists but is missing from manifest",
      ]),
    );
  });

  it("rejects a main entry that exceeds the release budget", async () => {
    const { root } = await createFixture({ entryContent: "x".repeat(32) });

    const result = await auditWebDist({
      repoRoot: root,
      mainEntryBudgetBytes: 16,
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "apps/web/dist/assets/index-demo.js is 0.03 KiB, above the 0.02 KiB main-entry budget",
    );
  });

  it("rejects malformed manifests and unsafe entry paths", async () => {
    const { root } = await createFixture({
      indexHtml:
        '<script type="module" src="/not-assets/index-demo.js"></script>',
      manifestText: [
        "not a hash line",
        `${"a".repeat(64)}  outside/file.js`,
        `${"b".repeat(64)}  apps/web/dist/../dist/index.html`,
      ].join("\n"),
    });

    const result = await auditWebDist({
      repoRoot: root,
      mainEntryBudgetBytes: 1024,
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "manifest line 1 is not a shasum -a 256 entry",
        "manifest line 2 is outside apps/web/dist: outside/file.js",
        "manifest line 3 is not normalized: apps/web/dist/../dist/index.html",
        "module script is not an asset JavaScript entry: /not-assets/index-demo.js",
      ]),
    );
  });
});

async function createFixture(options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-web-dist-"));
  temporaryRoots.push(root);
  const distRoot = path.join(root, "apps/web/dist");
  const assetRoot = path.join(distRoot, "assets");
  const artifactRoot = path.join(root, "docs/artifacts");
  await mkdir(assetRoot, { recursive: true });
  await mkdir(artifactRoot, { recursive: true });

  const entryContent = options.entryContent ?? "console.log('ok');\n";
  const indexHtml =
    options.indexHtml ??
    '<script type="module" crossorigin src="/assets/index-demo.js"></script>\n';
  await writeFile(path.join(assetRoot, "index-demo.js"), entryContent);
  await writeFile(path.join(distRoot, "index.html"), indexHtml);

  const manifestText =
    options.manifestText ??
    [
      manifestLine("apps/web/dist/assets/index-demo.js", entryContent),
      manifestLine("apps/web/dist/index.html", indexHtml),
    ].join("\n");
  await writeFile(
    path.join(artifactRoot, "web-dist-0.1.0.sha256"),
    `${manifestText}\n`,
  );
  return {
    root,
    entryBytes: Buffer.byteLength(entryContent),
    manifestText,
  };
}

function manifestLine(filePath, content) {
  return `${sha256(Buffer.from(content, "utf8"))}  ${filePath}`;
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}
