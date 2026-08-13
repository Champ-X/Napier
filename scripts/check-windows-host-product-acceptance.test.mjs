import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifyWindowsHostProductAcceptance } from "./check-windows-host-product-acceptance.mjs";
import { sandboxImageSourceEvidence } from "./check-sandbox-image-sbom.mjs";
import {
  canonicalJson,
  createWindowsHostProductAcceptanceReceipt,
  sha256,
  windowsHostProductAcceptanceImplementation,
} from "./windows-host-product-acceptance-artifact.mjs";

const SOURCE_SHA = "a".repeat(40);
const HASH = "b".repeat(64);
const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Windows host product acceptance receipt", () => {
  it("accepts a structurally complete source-bound receipt", async () => {
    const receiptPath = await writeReceipt();

    await expect(
      verifyWindowsHostProductAcceptance({
        artifactPath: receiptPath,
        sourceSha: SOURCE_SHA,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        valid: true,
        errors: [],
        path: receiptPath,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
  });

  it("rejects host, source, ConPTY, image, product, and scope tampering", async () => {
    for (const mutate of [
      (value) => {
        value.host.platform = "linux";
      },
      (value) => {
        value.source.mainTip = "c".repeat(40);
      },
      (value) => {
        value.pty.binary = "prebuilds/win32-x64/pty.node";
      },
      (value) => {
        value.image.contextSha256 = "d".repeat(64);
      },
      (value) => {
        value.product.doctor.warningCount = 2;
      },
      (value) => {
        value.product.rawCommandOutput = "forbidden";
      },
      (value) => {
        value.resourceClosure.cleanCheckoutRestored = false;
      },
      (value) => {
        value.scope.windowsHostProductAcceptance = false;
      },
    ]) {
      const receiptPath = await writeReceipt(mutate);
      const result = await verifyWindowsHostProductAcceptance({
        artifactPath: receiptPath,
        sourceSha: SOURCE_SHA,
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Windows host product acceptance receipt shape is invalid",
      );
    }
  });

  it("rejects unknown retained fields even when the outer hash is recomputed", async () => {
    const receiptPath = await writeReceipt((value) => {
      value.workspacePath = "C:\\private\\workspace";
    });

    const result = await verifyWindowsHostProductAcceptance({
      artifactPath: receiptPath,
      sourceSha: SOURCE_SHA,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Windows host product acceptance receipt shape is invalid",
    );
  });

  it("requires an explicit absolute artifact and expected source SHA", async () => {
    await expect(
      verifyWindowsHostProductAcceptance({
        artifactPath: "relative.json",
        sourceSha: SOURCE_SHA,
      }),
    ).rejects.toThrow("artifact path must be absolute");
    await expect(
      verifyWindowsHostProductAcceptance({
        artifactPath: path.resolve("missing.json"),
        sourceSha: "main",
      }),
    ).rejects.toThrow("source SHA is invalid");
  });
});

async function writeReceipt(mutate) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-windows-receipt-"));
  roots.push(root);
  const receiptPath = path.join(root, "receipt.json");
  const receipt = await validReceipt();
  mutate?.(receipt);
  const { contentSha256: _discarded, ...content } = receipt;
  receipt.contentSha256 = sha256(canonicalJson(content));
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return receiptPath;
}

async function validReceipt() {
  const [implementation, sandboxSource, stage13] = await Promise.all([
    windowsHostProductAcceptanceImplementation(process.cwd()),
    sandboxImageSourceEvidence(process.cwd()),
    readFile(
      "docs/artifacts/sandbox-product-acceptance-stage13.json",
      "utf8",
    ).then(JSON.parse),
  ]);
  const hostIdentity = {
    platform: "win32",
    arch: "x64",
    osRelease: "10.0.26100",
    runnerEnvironment: "self-hosted",
    runnerOs: "Windows",
    runnerArch: "X64",
    nodeVersion: "v24.16.0",
    npmVersion: "11.10.0",
    dockerEndpointKind: "npipe-local-docker-engine",
    dockerEndpointSha256: sha256("npipe:////./pipe/docker_engine"),
    dockerServerOs: "linux",
    dockerServerArch: "amd64",
    dockerServerVersion: "28.3.3",
  };
  const command = {
    status: "passed",
    exitCode: 0,
    outputBytes: 1,
    outputSha256: HASH,
    durationMs: 1,
  };
  return createWindowsHostProductAcceptanceReceipt({
    generatedAt: "2026-08-12T00:00:00.000Z",
    workflowRunId: "123",
    workflowRunAttempt: "1",
    sourceSha: SOURCE_SHA,
    implementation,
    host: {
      ...hostIdentity,
      identitySha256: sha256(canonicalJson(hostIdentity)),
    },
    source: {
      cleanCheckout: true,
      gitHead: SOURCE_SHA,
      mainTip: SOURCE_SHA,
      nodeModulesAbsentBeforeInstall: true,
      distAbsentBeforeBuild: true,
      trackedFileCount: 2_000,
      packageLockSha256: implementation.packageLockSha256,
    },
    install: command,
    pty: {
      package: "@lydell/node-pty-win32-x64",
      version: "1.2.0-beta.15",
      binary: "prebuilds/win32-x64/conpty.node",
      nativeBinarySha256: HASH,
      probeOutputSha256: HASH,
      exitCode: 0,
      passed: true,
    },
    build: command,
    image: {
      reference: "napier-sandbox:0.1.0",
      id: `sha256:${HASH}`,
      platform: "linux/amd64",
      contextSha256: sandboxSource.contextSha256,
      sbomSha256: HASH,
      provenanceSha256: HASH,
    },
    product: {
      imagePlatform: "linux/amd64",
      imageProvenanceSha256: HASH,
      setup: stage13.setup,
      doctor: stage13.doctor,
      verification: stage13.verification,
      service: stage13.service,
      restart: stage13.restart,
      firstUse: stage13.firstUse,
      invalidBindingRepair: stage13.invalidBindingRepair,
      uninstall: stage13.uninstall,
      resourceClosure: stage13.resourceClosure,
      contentSha256: HASH,
    },
    durationMs: 1,
    resourceClosure: {
      productResourceBaselineRestored: true,
      hostContainerBaselineRestored: true,
      hostNetworkBaselineRestored: true,
      hostImageBaselineRestored: true,
      officialImageTagRestored: true,
      repositoryEvidenceRestored: true,
      cleanCheckoutRestored: true,
      dependenciesRemoved: true,
      buildOutputRemoved: true,
      temporaryEnvironmentRemoved: true,
    },
  });
}
