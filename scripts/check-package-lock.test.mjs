import { execFile as execFileWithCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import {
  auditPackageLock,
  createPackageLockAuditVerification,
  createPackageLockAuditReceipt,
  verifyPackageLockReceipt,
} from "./check-package-lock.mjs";

const temporaryRoots = [];
const execFile = promisify(execFileWithCallback);
const scriptPath = path.resolve("scripts/check-package-lock.mjs");

describe("package lock release gate", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryRoots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("accepts a lockfile that mirrors root and workspace package metadata", async () => {
    const { root } = await createFixture();

    const result = await auditPackageLock({ repoRoot: root });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result).toMatchObject({
      packageLockVersion: 3,
      rootPackageName: "napier-test",
      rootPackageVersion: "0.1.0",
      workspaceCount: 2,
      externalPackageCount: 1,
      integrityCount: 1,
      linkCount: 2,
    });
    expect(createPackageLockAuditReceipt(result)).toMatchObject({
      type: "napier.package-lock-audit",
      schemaVersion: 1,
      ok: true,
      counts: {
        workspaces: 2,
        externalPackages: 1,
        integrityEntries: 1,
        links: 2,
      },
      errors: [],
    });
  });

  it("emits a machine-readable package-lock audit receipt from the CLI", async () => {
    const { root } = await createFixture();

    const { stdout } = await execFile(process.execPath, [
      scriptPath,
      "--json",
      "--repo-root",
      root,
    ]);

    expect(JSON.parse(stdout)).toMatchObject({
      type: "napier.package-lock-audit",
      schemaVersion: 1,
      ok: true,
      rootPackage: {
        name: "napier-test",
        version: "0.1.0",
      },
      errors: [],
    });
  });

  it("writes and verifies a package-lock audit receipt file", async () => {
    const { root } = await createFixture();
    const receiptPath = path.join(
      root,
      "docs/artifacts/package-lock-audit.json",
    );

    const { stdout } = await execFile(process.execPath, [
      scriptPath,
      "--repo-root",
      root,
      "--receipt-path",
      "docs/artifacts/package-lock-audit.json",
    ]);
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    const verification = await verifyPackageLockReceipt({
      repoRoot: root,
      verifyReceiptPath: "docs/artifacts/package-lock-audit.json",
    });

    expect(stdout).toContain("receipt docs/artifacts/package-lock-audit.json");
    expect(receipt).toMatchObject({
      type: "napier.package-lock-audit",
      schemaVersion: 1,
      ok: true,
      errors: [],
    });
    expect(verification.valid).toBe(true);
    expect(createPackageLockAuditVerification(verification)).toMatchObject({
      type: "napier.package-lock-audit-verification",
      schemaVersion: 1,
      valid: true,
      receipt: { path: "docs/artifacts/package-lock-audit.json" },
      errors: [],
    });
  });

  it("rejects a saved package-lock receipt that no longer matches current files", async () => {
    const { root } = await createFixture();
    const receiptPath = path.join(
      root,
      "docs/artifacts/package-lock-audit.json",
    );
    await execFile(process.execPath, [
      scriptPath,
      "--repo-root",
      root,
      "--receipt-path",
      "docs/artifacts/package-lock-audit.json",
    ]);
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    receipt.rootPackage.packageLockSha256 = "0".repeat(64);
    await writeJson(receiptPath, receipt);

    const verification = await verifyPackageLockReceipt({
      repoRoot: root,
      verifyReceiptPath: "docs/artifacts/package-lock-audit.json",
    });

    expect(verification.valid).toBe(false);
    expect(verification.errors).toContain(
      "receipt does not match the current package-lock audit",
    );
  });

  it("rejects malformed package-lock audit receipts", async () => {
    const { root } = await createFixture();
    await writeJson(path.join(root, "docs/artifacts/package-lock-audit.json"), {
      type: "wrong",
      schemaVersion: 1,
      ok: true,
    });

    const verification = await verifyPackageLockReceipt({
      repoRoot: root,
      verifyReceiptPath: "docs/artifacts/package-lock-audit.json",
    });

    expect(verification.valid).toBe(false);
    expect(verification.errors).toEqual(
      expect.arrayContaining([
        "receipt type must be napier.package-lock-audit",
        "receipt rootPackage must be an object",
        "receipt counts must be an object",
        "receipt errors must be an array",
      ]),
    );
  });

  it("removes a stale package-lock receipt target when the audit fails", async () => {
    const { root, lockfile } = await createFixture();
    const receiptPath = path.join(
      root,
      "docs/artifacts/package-lock-audit.json",
    );
    delete lockfile.packages["node_modules/react"].integrity;
    await writeJson(path.join(root, "package-lock.json"), lockfile);
    await writeJson(receiptPath, { ok: true });

    await expect(
      execFile(process.execPath, [
        scriptPath,
        "--repo-root",
        root,
        "--receipt-path",
        "docs/artifacts/package-lock-audit.json",
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("missing an integrity hash"),
    });
    await expect(readFile(receiptPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects package-lock receipt paths outside the repo root", async () => {
    const { root } = await createFixture();

    await expect(
      execFile(process.execPath, [
        scriptPath,
        "--repo-root",
        root,
        "--verify-receipt-path",
        path.join(tmpdir(), "package-lock-audit.json"),
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "verifyReceiptPath must be a repo-relative path",
      ),
    });
  });

  it("rejects workspace dependency drift between package.json and package-lock", async () => {
    const { root, lockfile } = await createFixture();
    lockfile.packages["apps/web"].dependencies.react = "19.9.9";
    await writeJson(path.join(root, "package-lock.json"), lockfile);

    const result = await auditPackageLock({ repoRoot: root });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "apps/web dependencies does not match package.json",
    );
  });

  it("rejects missing external package integrity evidence", async () => {
    const { root, lockfile } = await createFixture();
    delete lockfile.packages["node_modules/react"].integrity;
    await writeJson(path.join(root, "package-lock.json"), lockfile);

    const result = await auditPackageLock({ repoRoot: root });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "node_modules/react is missing an integrity hash",
    );
  });

  it("rejects missing workspace lockfile links", async () => {
    const { root, lockfile } = await createFixture();
    delete lockfile.packages["node_modules/@napier/web"];
    await writeJson(path.join(root, "package-lock.json"), lockfile);

    const result = await auditPackageLock({ repoRoot: root });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "node_modules/@napier/web workspace link is missing from package-lock",
    );
  });
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-package-lock-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, "apps/web"), { recursive: true });
  await mkdir(path.join(root, "packages/contracts"), { recursive: true });

  const rootPackage = {
    name: "napier-test",
    version: "0.1.0",
    private: true,
    workspaces: ["apps/*", "packages/*"],
    engines: { node: ">=22.19.0" },
    devDependencies: { typescript: "5.9.3" },
  };
  const webPackage = {
    name: "@napier/web",
    version: "0.1.0",
    private: true,
    dependencies: {
      "@napier/contracts": "*",
      react: "19.2.8",
    },
  };
  const contractsPackage = {
    name: "@napier/contracts",
    version: "0.1.0",
    private: true,
  };
  const lockfile = {
    name: rootPackage.name,
    version: rootPackage.version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: rootPackage.name,
        version: rootPackage.version,
        workspaces: rootPackage.workspaces,
        engines: rootPackage.engines,
        devDependencies: rootPackage.devDependencies,
      },
      "apps/web": {
        name: webPackage.name,
        version: webPackage.version,
        dependencies: webPackage.dependencies,
      },
      "packages/contracts": {
        name: contractsPackage.name,
        version: contractsPackage.version,
      },
      "node_modules/@napier/contracts": {
        resolved: "packages/contracts",
        link: true,
      },
      "node_modules/@napier/web": {
        resolved: "apps/web",
        link: true,
      },
      "node_modules/react": {
        version: "19.2.8",
        resolved: "https://registry.npmjs.org/react/-/react-19.2.8.tgz",
        integrity: "sha512-test",
      },
    },
  };

  await writeJson(path.join(root, "package.json"), rootPackage);
  await writeJson(path.join(root, "apps/web/package.json"), webPackage);
  await writeJson(
    path.join(root, "packages/contracts/package.json"),
    contractsPackage,
  );
  await writeJson(path.join(root, "package-lock.json"), lockfile);
  return { root, lockfile };
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
