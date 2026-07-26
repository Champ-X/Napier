import { execFile as execFileWithCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import {
  auditRuntimeEnvironment,
  createRuntimeEnvironmentReceipt,
  createRuntimeEnvironmentVerification,
  verifyRuntimeEnvironmentReceipt,
} from "./check-runtime-environment.mjs";

const temporaryRoots = [];
const execFile = promisify(execFileWithCallback);
const scriptPath = path.resolve("scripts/check-runtime-environment.mjs");
const passingRuntime = {
  nodeVersion: "22.19.0",
  platform: "linux",
  arch: "x64",
  versions: {
    sqlite: "3.46.1",
    openssl: "3.0.13",
    uv: "1.48.0",
    v8: "12.4.254.21-node.27",
  },
};

describe("runtime environment release gate", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryRoots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("accepts a Node runtime that satisfies package engines and components", async () => {
    const { root } = await createFixture();

    const result = await auditRuntimeEnvironment({
      repoRoot: root,
      ...passingRuntime,
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result).toMatchObject({
      packageName: "napier-test",
      packageVersion: "0.1.0",
      nodeVersion: "22.19.0",
      nodeRange: ">=22.19.0",
      nodeSatisfies: true,
      platform: "linux",
      arch: "x64",
      components: passingRuntime.versions,
    });
    expect(createRuntimeEnvironmentReceipt(result)).toMatchObject({
      type: "napier.runtime-environment-audit",
      schemaVersion: 1,
      ok: true,
      package: { name: "napier-test", version: "0.1.0" },
      node: {
        version: "22.19.0",
        required: ">=22.19.0",
        satisfies: true,
        components: passingRuntime.versions,
      },
      errors: [],
    });
  });

  it("emits, writes, and verifies a runtime audit receipt", async () => {
    const { root } = await createFixture();

    const { stdout } = await execFile(process.execPath, [
      scriptPath,
      "--json",
      "--repo-root",
      root,
    ]);
    const jsonReceipt = JSON.parse(stdout);
    await execFile(process.execPath, [
      scriptPath,
      "--repo-root",
      root,
      "--receipt-path",
      "docs/artifacts/runtime-environment-audit.json",
    ]);
    const fileReceipt = JSON.parse(
      await readFile(
        path.join(root, "docs/artifacts/runtime-environment-audit.json"),
        "utf8",
      ),
    );
    const verification = await verifyRuntimeEnvironmentReceipt({
      repoRoot: root,
      verifyReceiptPath: "docs/artifacts/runtime-environment-audit.json",
    });

    expect(jsonReceipt).toMatchObject({
      type: "napier.runtime-environment-audit",
      schemaVersion: 1,
      ok: true,
      package: { name: "napier-test", version: "0.1.0" },
      errors: [],
    });
    expect(fileReceipt).toMatchObject({
      type: "napier.runtime-environment-audit",
      schemaVersion: 1,
      ok: true,
      errors: [],
    });
    expect(verification.valid).toBe(true);
    expect(createRuntimeEnvironmentVerification(verification)).toMatchObject({
      type: "napier.runtime-environment-audit-verification",
      schemaVersion: 1,
      valid: true,
      receipt: { path: "docs/artifacts/runtime-environment-audit.json" },
      errors: [],
    });
  });

  it("rejects Node versions below package engines.node", async () => {
    const { root } = await createFixture();

    const result = await auditRuntimeEnvironment({
      repoRoot: root,
      ...passingRuntime,
      nodeVersion: "22.18.0",
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "Node 22.18.0 does not satisfy engines.node >=22.19.0",
    );
  });

  it("rejects unsupported engines.node ranges", async () => {
    const { root, packageJson } = await createFixture();
    packageJson.engines.node = "^22.19.0";
    await writeJson(path.join(root, "package.json"), packageJson);

    const result = await auditRuntimeEnvironment({
      repoRoot: root,
      ...passingRuntime,
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "unsupported engines.node range: ^22.19.0",
        "Node 22.19.0 does not satisfy engines.node ^22.19.0",
      ]),
    );
  });

  it("rejects missing required runtime components", async () => {
    const { root } = await createFixture();

    const result = await auditRuntimeEnvironment({
      repoRoot: root,
      ...passingRuntime,
      versions: {
        ...passingRuntime.versions,
        sqlite: "",
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "process.versions.sqlite must be available",
    );
  });

  it("rejects a saved receipt that no longer matches current runtime evidence", async () => {
    const { root } = await createFixture();
    const receiptPath = path.join(
      root,
      "docs/artifacts/runtime-environment-audit.json",
    );
    const result = await auditRuntimeEnvironment({
      repoRoot: root,
      ...passingRuntime,
    });
    const receipt = createRuntimeEnvironmentReceipt(result);
    receipt.node.version = "22.20.0";
    await writeJson(receiptPath, receipt);

    const verification = await verifyRuntimeEnvironmentReceipt({
      repoRoot: root,
      verifyReceiptPath: "docs/artifacts/runtime-environment-audit.json",
      ...passingRuntime,
    });

    expect(verification.valid).toBe(false);
    expect(verification.errors).toContain(
      "receipt does not match the current runtime environment audit",
    );
  });

  it("rejects malformed runtime audit receipts", async () => {
    const { root } = await createFixture();
    await writeJson(
      path.join(root, "docs/artifacts/runtime-environment-audit.json"),
      {
        type: "wrong",
        schemaVersion: 1,
        ok: true,
      },
    );

    const verification = await verifyRuntimeEnvironmentReceipt({
      repoRoot: root,
      verifyReceiptPath: "docs/artifacts/runtime-environment-audit.json",
      ...passingRuntime,
    });

    expect(verification.valid).toBe(false);
    expect(verification.errors).toEqual(
      expect.arrayContaining([
        "receipt type must be napier.runtime-environment-audit",
        "receipt package must be an object",
        "receipt node must be an object",
        "receipt errors must be an array",
      ]),
    );
  });

  it("removes a stale receipt target when the audit fails", async () => {
    const { root, packageJson } = await createFixture();
    const receiptPath = path.join(
      root,
      "docs/artifacts/runtime-environment-audit.json",
    );
    packageJson.engines.node = "^22.19.0";
    await writeJson(path.join(root, "package.json"), packageJson);
    await writeJson(receiptPath, { ok: true });

    await expect(
      execFile(process.execPath, [
        scriptPath,
        "--repo-root",
        root,
        "--receipt-path",
        "docs/artifacts/runtime-environment-audit.json",
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("unsupported engines.node range"),
    });
    await expect(readFile(receiptPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects runtime receipt and package paths outside the repo root", async () => {
    const { root } = await createFixture();

    await expect(
      execFile(process.execPath, [
        scriptPath,
        "--repo-root",
        root,
        "--verify-receipt-path",
        path.join(tmpdir(), "runtime-environment-audit.json"),
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "verifyReceiptPath must be a repo-relative path",
      ),
    });
    await expect(
      auditRuntimeEnvironment({
        repoRoot: root,
        packageJsonPath: path.join(tmpdir(), "package.json"),
      }),
    ).rejects.toThrow("packageJsonPath must be a repo-relative path");
  });
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-runtime-env-"));
  temporaryRoots.push(root);
  const packageJson = {
    name: "napier-test",
    version: "0.1.0",
    private: true,
    engines: { node: ">=22.19.0" },
  };
  await writeJson(path.join(root, "package.json"), packageJson);
  return { root, packageJson };
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
