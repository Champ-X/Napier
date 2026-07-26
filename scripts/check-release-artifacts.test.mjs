import { createHash } from "node:crypto";
import { execFile as execFileWithCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import {
  auditReleaseArtifacts,
  createReleaseArtifactsReceipt,
  createReleaseArtifactsVerification,
  verifyReleaseArtifactsReceipt,
} from "./check-release-artifacts.mjs";

const temporaryRoots = [];
const execFile = promisify(execFileWithCallback);
const packageLockScriptPath = path.resolve("scripts/check-package-lock.mjs");
const releaseScriptPath = path.resolve("scripts/check-release-artifacts.mjs");
const runtimeEnvironmentScriptPath = path.resolve(
  "scripts/check-runtime-environment.mjs",
);
const webDistScriptPath = path.resolve("scripts/check-web-dist.mjs");

describe("release artifacts audit", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryRoots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("accepts current package-lock and Web dist receipts as one release set", async () => {
    const { root } = await createFixture();

    const result = await auditReleaseArtifacts({ repoRoot: root });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.artifacts.map((artifact) => artifact.kind)).toEqual([
      "package-lock-audit",
      "runtime-environment-audit",
      "web-dist-audit",
      "web-dist-manifest",
    ]);
    expect(createReleaseArtifactsReceipt(result)).toMatchObject({
      type: "napier.release-artifacts-audit",
      schemaVersion: 1,
      ok: true,
      package: { name: "napier-test", version: "0.1.0" },
      errors: [],
    });
  });

  it("writes and verifies a release artifacts receipt from the CLI", async () => {
    const { root } = await createFixture();

    await execFile(process.execPath, [
      releaseScriptPath,
      "--repo-root",
      root,
      "--receipt-path",
      "docs/artifacts/release-artifacts-audit.json",
    ]);
    const receipt = JSON.parse(
      await readFile(
        path.join(root, "docs/artifacts/release-artifacts-audit.json"),
        "utf8",
      ),
    );
    const verification = await verifyReleaseArtifactsReceipt({
      repoRoot: root,
      verifyReceiptPath: "docs/artifacts/release-artifacts-audit.json",
    });

    expect(receipt).toMatchObject({
      type: "napier.release-artifacts-audit",
      schemaVersion: 1,
      ok: true,
    });
    expect(verification.valid).toBe(true);
    expect(createReleaseArtifactsVerification(verification)).toMatchObject({
      type: "napier.release-artifacts-audit-verification",
      schemaVersion: 1,
      valid: true,
      receipt: { path: "docs/artifacts/release-artifacts-audit.json" },
      errors: [],
    });
  });

  it("rejects a release receipt that no longer matches the artifact set", async () => {
    const { root } = await createFixture();
    const receiptPath = path.join(
      root,
      "docs/artifacts/release-artifacts-audit.json",
    );
    await execFile(process.execPath, [
      releaseScriptPath,
      "--repo-root",
      root,
      "--receipt-path",
      "docs/artifacts/release-artifacts-audit.json",
    ]);
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    receipt.artifactSetSha256 = "0".repeat(64);
    await writeJson(receiptPath, receipt);

    const verification = await verifyReleaseArtifactsReceipt({
      repoRoot: root,
      verifyReceiptPath: "docs/artifacts/release-artifacts-audit.json",
    });

    expect(verification.valid).toBe(false);
    expect(verification.errors).toContain(
      "receipt does not match the current release artifacts audit",
    );
  });

  it("fails when a component receipt drifts from current evidence", async () => {
    const { root } = await createFixture();
    const webReceiptPath = path.join(
      root,
      "docs/artifacts/web-dist-audit-0.1.0.json",
    );
    const webReceipt = JSON.parse(await readFile(webReceiptPath, "utf8"));
    webReceipt.distContentSha256 = "0".repeat(64);
    await writeJson(webReceiptPath, webReceipt);

    const result = await auditReleaseArtifacts({ repoRoot: root });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "web-dist receipt: receipt does not match the current Web dist audit",
    );
  });

  it("fails when the runtime environment receipt drifts from current evidence", async () => {
    const { root } = await createFixture();
    const runtimeReceiptPath = path.join(
      root,
      "docs/artifacts/runtime-environment-audit-0.1.0.json",
    );
    const runtimeReceipt = JSON.parse(
      await readFile(runtimeReceiptPath, "utf8"),
    );
    runtimeReceipt.node.version = "0.0.0";
    await writeJson(runtimeReceiptPath, runtimeReceipt);

    const result = await auditReleaseArtifacts({ repoRoot: root });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "runtime-environment receipt: receipt does not match the current runtime environment audit",
    );
  });

  it("rejects malformed release artifact receipts", async () => {
    const { root } = await createFixture();
    await writeJson(
      path.join(root, "docs/artifacts/release-artifacts-audit.json"),
      {
        type: "wrong",
        schemaVersion: 1,
        ok: true,
      },
    );

    const verification = await verifyReleaseArtifactsReceipt({
      repoRoot: root,
      verifyReceiptPath: "docs/artifacts/release-artifacts-audit.json",
    });

    expect(verification.valid).toBe(false);
    expect(verification.errors).toEqual(
      expect.arrayContaining([
        "receipt type must be napier.release-artifacts-audit",
        "receipt package must be an object",
        "receipt artifactSetSha256 must be a SHA-256 hex digest",
        "receipt artifacts must be a non-empty array",
        "receipt errors must be an array",
      ]),
    );
  });
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-release-artifacts-"));
  temporaryRoots.push(root);
  await createPackageLockFixture(root);
  await createWebDistFixture(root);
  await execFile(process.execPath, [
    packageLockScriptPath,
    "--repo-root",
    root,
    "--receipt-path",
    "docs/artifacts/package-lock-audit-0.1.0.json",
  ]);
  await execFile(process.execPath, [
    runtimeEnvironmentScriptPath,
    "--repo-root",
    root,
    "--receipt-path",
    "docs/artifacts/runtime-environment-audit-0.1.0.json",
  ]);
  await execFile(process.execPath, [
    webDistScriptPath,
    "--repo-root",
    root,
    "--receipt-path",
    "docs/artifacts/web-dist-audit-0.1.0.json",
  ]);
  return { root };
}

async function createPackageLockFixture(root) {
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
    dependencies: { "@napier/contracts": "*", react: "19.2.8" },
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
}

async function createWebDistFixture(root) {
  const distRoot = path.join(root, "apps/web/dist");
  const assetRoot = path.join(distRoot, "assets");
  await mkdir(assetRoot, { recursive: true });
  await mkdir(path.join(root, "docs/artifacts"), { recursive: true });
  const entryContent = "console.log('ok');\n";
  const indexHtml =
    '<script type="module" crossorigin src="/assets/index-demo.js"></script>\n';
  await writeFile(path.join(assetRoot, "index-demo.js"), entryContent);
  await writeFile(path.join(distRoot, "index.html"), indexHtml);
  await writeFile(
    path.join(root, "docs/artifacts/web-dist-0.1.0.sha256"),
    [
      manifestLine("apps/web/dist/assets/index-demo.js", entryContent),
      manifestLine("apps/web/dist/index.html", indexHtml),
    ].join("\n") + "\n",
  );
}

function manifestLine(filePath, content) {
  return `${sha256(Buffer.from(content, "utf8"))}  ${filePath}`;
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}
