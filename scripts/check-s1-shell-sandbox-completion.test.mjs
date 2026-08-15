import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

import {
  collectS1ShellSandboxCompletion,
  verifyS1ShellSandboxCompletion,
  verifyS1ShellSandboxReadiness,
} from "./check-s1-shell-sandbox-completion.mjs";
import {
  createS1ShellSandboxCompletionArtifact,
  createS1ShellSandboxReadinessArtifact,
  S1_REQUIREMENT_GROUPS,
  validateS1ShellSandboxCompletionArtifact,
  validateS1ShellSandboxReadinessArtifact,
} from "./s1-shell-sandbox-completion-artifact.mjs";
import {
  canonicalJson,
  sha256,
} from "./sandbox-external-publication-model.mjs";
import { writeSandboxExternalPublicationReceipt } from "./sandbox-external-publication-evidence.mjs";
import { sandboxImageSourceEvidence } from "./check-sandbox-image-sbom.mjs";
import {
  createWindowsHostProductAcceptanceReceipt,
  windowsHostProductAcceptanceImplementation,
} from "./windows-host-product-acceptance-artifact.mjs";
import { createS1UpstreamRunAuthority } from "./s1-upstream-run-authority.mjs";

const SOURCE_SHA = "a".repeat(40);
const HASH = "b".repeat(64);
const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("S1 Shell/Sandbox aggregate gate", () => {
  it("accepts the current blocked local readiness receipt", async () => {
    await expect(verifyS1ShellSandboxReadiness()).resolves.toEqual(
      expect.objectContaining({
        valid: true,
        errors: [],
        path: "docs/artifacts/s1-shell-sandbox-readiness-stage22.json",
        value: expect.objectContaining({
          status: "blocked",
          blockers: [
            "public_signed_external_release",
            "windows_host_product_acceptance",
          ],
          scope: expect.objectContaining({ s1Complete: false }),
        }),
      }),
    );
  });

  it("requires all five exact local requirement groups", () => {
    const artifact = readinessArtifact();
    expect(
      validateS1ShellSandboxReadinessArtifact(artifact, {
        implementation: artifact.implementation,
        requirements: requirements(),
      }),
    ).toEqual([]);

    artifact.requirements[2].evidence.pop();
    rehash(artifact);
    expect(
      validateS1ShellSandboxReadinessArtifact(artifact, {
        implementation: artifact.implementation,
        requirements: requirements(),
      }),
    ).not.toEqual([]);
  });

  it("reports exact blockers and completes only with both verified receipts", () => {
    for (const [externalPublication, windowsHost, status, blockers] of [
      [
        null,
        null,
        "blocked",
        ["public_signed_external_release", "windows_host_product_acceptance"],
      ],
      [externalReceipt(), null, "blocked", ["windows_host_product_acceptance"]],
      [null, windowsReceipt(), "blocked", ["public_signed_external_release"]],
      [externalReceipt(), windowsReceipt(), "complete", []],
    ]) {
      const artifact = completionArtifact({
        externalPublication,
        windowsHost,
      });
      expect(
        validateS1ShellSandboxCompletionArtifact(artifact, {
          sourceSha: SOURCE_SHA,
          readiness: artifact.readiness,
          requirements: artifact.requirements,
          externalPublication,
          windowsHost,
        }),
      ).toEqual([]);
      expect(artifact.status).toBe(status);
      expect(artifact.blockers).toEqual(blockers);
      expect(artifact.scope.s1Complete).toBe(status === "complete");
    }
  });

  it.each([
    [
      "source mixing",
      (value) => {
        value.externalPublication.sourceSha = "c".repeat(40);
      },
    ],
    [
      "workflow success substitution",
      (value) => {
        value.externalPublication.workflowConclusion = "success";
      },
    ],
    [
      "queued Windows substitution",
      (value) => {
        value.windowsHost = null;
        value.windowsWorkflowStatus = "queued";
      },
    ],
    [
      "blocker suppression",
      (value) => {
        value.windowsHost = null;
        value.status = "complete";
        value.blockers = [];
        value.scope.s1Complete = true;
        value.scope.windowsHostProductAcceptance = false;
      },
    ],
    [
      "upstream receipt body retention",
      (value) => {
        value.externalPublication.receipt = { raw: true };
      },
    ],
  ])("rejects %s even after recomputing the outer hash", (_name, mutate) => {
    const artifact = completionArtifact({
      externalPublication: externalReceipt(),
      windowsHost: windowsReceipt(),
    });
    mutate(artifact);
    rehash(artifact);
    expect(validateS1ShellSandboxCompletionArtifact(artifact)).not.toEqual([]);
  });

  it("writes and replays a blocked completion without treating it as success", async () => {
    const artifact = await collectS1ShellSandboxCompletion({
      sourceSha: SOURCE_SHA,
    });
    expect(artifact.status).toBe("blocked");
    expect(artifact.scope.s1Complete).toBe(false);

    const root = await mkdtemp(path.join(tmpdir(), "napier-s1-completion-"));
    roots.push(root);
    const artifactPath = path.join(root, "completion.json");
    await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);

    await expect(
      verifyS1ShellSandboxCompletion({
        sourceSha: SOURCE_SHA,
        artifactPath,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        valid: true,
        errors: [],
        value: expect.objectContaining({
          status: "blocked",
          scope: expect.objectContaining({ s1Complete: false }),
        }),
      }),
    );
  });

  it("completes only after both strict upstream verifiers accept exact-run receipts", async () => {
    const external = await externalEvidenceFixture();
    const windowsReceiptPath = await writeWindowsReceipt();
    const externalPublicationAuthorityPath = await writeRunAuthority({
      authority: "external_publication",
      workflow: ".github/workflows/publish-sandbox.yml",
      runId: "456",
      artifactName: `sandbox-external-publication-${SOURCE_SHA}`,
    });
    const windowsHostAuthorityPath = await writeRunAuthority({
      authority: "windows_host_product_acceptance",
      workflow: ".github/workflows/windows-host-product-acceptance.yml",
      runId: "789",
      artifactName: `napier-windows-host-product-acceptance-${SOURCE_SHA}`,
    });
    const options = {
      sourceSha: SOURCE_SHA,
      releaseSourceSha: SOURCE_SHA,
      workflowRunId: "999",
      workflowRunAttempt: "1",
      externalPublicationRunId: "456",
      windowsHostRunId: "789",
      externalPublicationAuthorityPath,
      windowsHostAuthorityPath,
      externalPublicationDir: external.root,
      windowsReceiptPath,
      verifyPromotedRelease: vi.fn(async () => undefined),
    };
    const artifact = await collectS1ShellSandboxCompletion(options);
    expect(artifact).toEqual(
      expect.objectContaining({
        status: "complete",
        blockers: [],
        workflowRunId: "999",
        scope: {
          localRequirementsReady: true,
          externalPublicationAccepted: true,
          windowsHostProductAcceptance: true,
          s1Complete: true,
          nextStage: "S2",
        },
      }),
    );
    expect(options.verifyPromotedRelease).toHaveBeenCalledWith(
      process.cwd(),
      SOURCE_SHA,
      artifact.externalPublication,
    );

    const root = await mkdtemp(path.join(tmpdir(), "napier-s1-complete-"));
    roots.push(root);
    const artifactPath = path.join(root, "completion.json");
    await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
    await expect(
      verifyS1ShellSandboxCompletion({ ...options, artifactPath }),
    ).resolves.toEqual(
      expect.objectContaining({
        valid: true,
        errors: [],
        value: expect.objectContaining({ status: "complete" }),
      }),
    );
    await expect(
      collectS1ShellSandboxCompletion({
        ...options,
        externalPublicationRunId: "457",
      }),
    ).rejects.toThrow("workflowRunId does not match");
    const windowsAuthority = JSON.parse(
      await readFile(windowsHostAuthorityPath, "utf8"),
    );
    windowsAuthority.workflowRunAttempt = "2";
    rehash(windowsAuthority);
    await writeFile(
      windowsHostAuthorityPath,
      `${JSON.stringify(windowsAuthority, null, 2)}\n`,
    );
    await expect(collectS1ShellSandboxCompletion(options)).rejects.toThrow(
      "receipt does not match run authority",
    );
  });

  it("rejects partial upstream authority inputs instead of degrading to blocked", async () => {
    await expect(
      collectS1ShellSandboxCompletion({
        sourceSha: SOURCE_SHA,
        externalPublicationRunId: "456",
      }),
    ).rejects.toThrow("authority inputs must be supplied together");
  });

  it("rejects a tampered blocked completion during replay", async () => {
    const artifact = await collectS1ShellSandboxCompletion({
      sourceSha: SOURCE_SHA,
    });
    artifact.blockers = [];
    rehash(artifact);
    const root = await mkdtemp(path.join(tmpdir(), "napier-s1-completion-"));
    roots.push(root);
    const artifactPath = path.join(root, "completion.json");
    await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = await verifyS1ShellSandboxCompletion({
      sourceSha: SOURCE_SHA,
      artifactPath,
    });
    expect(result.valid).toBe(false);
  });
});

function readinessArtifact() {
  return createS1ShellSandboxReadinessArtifact({
    generatedAt: "2026-08-12T00:00:00.000Z",
    implementation: {
      modelSha256: HASH,
      checkerSha256: HASH,
      workflowSha256: HASH,
      workflowCheckerSha256: HASH,
    },
    requirements: requirements(),
  });
}

function completionArtifact(overrides = {}) {
  const localRequirements = requirements().map((group) => ({
    ...group,
    evidenceSetSha256: sha256(canonicalJson(group.evidence)),
  }));
  const readiness = readinessReference();
  readiness.requirementSetSha256 = sha256(canonicalJson(localRequirements));
  return createS1ShellSandboxCompletionArtifact({
    generatedAt: "2026-08-12T00:00:00.000Z",
    workflowRunId: "123",
    workflowRunAttempt: "1",
    sourceSha: SOURCE_SHA,
    releaseSourceSha: SOURCE_SHA,
    readiness,
    requirements: localRequirements,
    externalPublication: overrides.externalPublication ?? null,
    windowsHost: overrides.windowsHost ?? null,
  });
}

function requirements() {
  return S1_REQUIREMENT_GROUPS.map((group) => ({
    id: group.id,
    status: "verified",
    evidence: group.evidenceKinds.map((kind, index) => ({
      kind,
      path: `docs/artifacts/evidence-${index}.json`,
      sha256: HASH,
      verifierSha256: HASH,
    })),
  }));
}

function readinessReference() {
  return {
    path: "docs/artifacts/s1-shell-sandbox-readiness-stage22.json",
    sha256: HASH,
    contentSha256: HASH,
    requirementSetSha256: HASH,
  };
}

function externalReceipt() {
  return {
    workflow: ".github/workflows/publish-sandbox.yml",
    workflowRunId: "456",
    workflowRunAttempt: "1",
    sourceSha: SOURCE_SHA,
    runAuthorityFileSha256: HASH,
    runAuthoritySha256: HASH,
    receiptSha256: HASH,
    contentSha256: HASH,
    digest: `sha256:${HASH}`,
    contextSha256: HASH,
  };
}

function windowsReceipt() {
  return {
    workflow: ".github/workflows/windows-host-product-acceptance.yml",
    workflowRunId: "789",
    workflowRunAttempt: "1",
    sourceSha: SOURCE_SHA,
    runAuthorityFileSha256: HASH,
    runAuthoritySha256: HASH,
    receiptSha256: HASH,
    contentSha256: HASH,
    hostIdentitySha256: HASH,
    productContentSha256: HASH,
  };
}

function rehash(value) {
  const { contentSha256: _contentSha256, ...content } = value;
  value.contentSha256 = sha256(canonicalJson(content));
}

async function externalEvidenceFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-s1-external-"));
  roots.push(root);
  const index = {
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [
      descriptor("linux", "amd64", "1"),
      descriptor("linux", "arm64", "2"),
      descriptor("unknown", "unknown", "3"),
      descriptor("unknown", "unknown", "4"),
    ],
  };
  const indexBytes = Buffer.from(JSON.stringify(index));
  const digest = `sha256:${sha256(indexBytes)}`;
  const predicate = externalPredicate();
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    subject: [
      {
        name: "ghcr.io/champ-x/napier-sandbox",
        digest: { sha256: digest.slice("sha256:".length) },
      },
    ],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate,
  };
  const files = {
    "remote-index.json": indexBytes,
    "buildkit-attestation-predicates.jsonl":
      `${JSON.stringify("https://spdx.dev/Document")}\n` +
      `${JSON.stringify("https://slsa.dev/provenance/v1")}\n`,
    "anonymous-platforms.jsonl":
      `${JSON.stringify(externalPlatform("linux/amd64"))}\n` +
      `${JSON.stringify(externalPlatform("linux/arm64"))}\n`,
    "cosign.bundle.json": JSON.stringify({
      verificationMaterial: { tlogEntries: [{ logIndex: "1" }] },
    }),
    "cosign.verify.json": JSON.stringify([
      {
        critical: { image: { "docker-manifest-digest": digest } },
        optional: { "source-sha": SOURCE_SHA },
      },
    ]),
    "slsa-provenance-v1.json": JSON.stringify(predicate),
    "cosign-attestation.bundle.json": JSON.stringify({
      verificationMaterial: { tlogEntries: [{ logIndex: "2" }] },
    }),
    "cosign-attestation.verify.json": JSON.stringify([
      { payload: Buffer.from(JSON.stringify(statement)).toString("base64") },
    ]),
  };
  await Promise.all(
    Object.entries(files).map(([name, value]) =>
      writeFile(path.join(root, name), value),
    ),
  );
  await writeSandboxExternalPublicationReceipt(root, {
    GITHUB_REPOSITORY: "Champ-X/Napier",
    GITHUB_RUN_ID: "456",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_SHA: SOURCE_SHA,
    IMAGE_NAME: "ghcr.io/champ-x/napier-sandbox",
    VERSION: "0.1.0",
    DIGEST: digest,
    CONTEXT_SHA256: HASH,
  });
  return { root };
}

async function writeWindowsReceipt() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-s1-windows-"));
  roots.push(root);
  const receiptPath = path.join(root, "receipt.json");
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
    runnerEnvironment: "github-hosted",
    runnerOs: "Windows",
    runnerArch: "X64",
    nodeVersion: "v24.16.0",
    npmVersion: "11.10.0",
    dockerEndpointKind: "wsl2-loopback-linux-docker-engine",
    dockerEndpointSha256: sha256("tcp://127.0.0.1:2375"),
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
  const receipt = createWindowsHostProductAcceptanceReceipt({
    generatedAt: "2026-08-12T00:00:00.000Z",
    workflowRunId: "789",
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
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return receiptPath;
}

async function writeRunAuthority({ authority, workflow, runId, artifactName }) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-s1-authority-"));
  roots.push(root);
  const artifactPath = path.join(root, `${authority}.json`);
  const value = createS1UpstreamRunAuthority({
    authority,
    sourceSha: SOURCE_SHA,
    expectedRunId: runId,
    run: {
      id: Number(runId),
      run_attempt: 1,
      event: "workflow_dispatch",
      status: "completed",
      conclusion: "success",
      head_branch: "main",
      head_sha: SOURCE_SHA,
      path: workflow,
      updated_at: "2026-08-12T00:00:00.000Z",
      repository: { id: 42, full_name: "Champ-X/Napier" },
      head_repository: { id: 42, full_name: "Champ-X/Napier" },
    },
    artifacts: {
      total_count: 1,
      artifacts: [
        {
          id: Number(runId) + 1000,
          name: artifactName,
          expired: false,
          size_in_bytes: 1024,
          workflow_run: {
            id: Number(runId),
            head_branch: "main",
            head_sha: SOURCE_SHA,
            repository_id: 42,
            head_repository_id: 42,
          },
        },
      ],
    },
  });
  await writeFile(artifactPath, `${JSON.stringify(value, null, 2)}\n`);
  return artifactPath;
}

function descriptor(os, architecture, digit) {
  return {
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    digest: `sha256:${digit.repeat(64)}`,
    size: 123,
    platform: { os, architecture },
  };
}

function externalPlatform(platform) {
  return {
    platform,
    anonymousPull: true,
    executed: true,
    contextSha256: HASH,
    sourceSha: SOURCE_SHA,
    nodeVersion: "v24.16.0",
  };
}

function externalPredicate() {
  return {
    buildDefinition: {
      buildType: "https://napier.local/github-actions/sandbox-oci/v1",
      externalParameters: {
        repository: "Champ-X/Napier",
        sourceSha: SOURCE_SHA,
        platforms: ["linux/amd64", "linux/arm64"],
        contextSha256: HASH,
      },
      internalParameters: {
        workflow: ".github/workflows/publish-sandbox.yml",
        releaseGate: "npm run check",
      },
      resolvedDependencies: [],
    },
    runDetails: {
      builder: {
        id: "https://github.com/Champ-X/Napier/actions/runs/456/attempts/1",
      },
      metadata: {
        invocationId:
          "https://github.com/Champ-X/Napier/actions/runs/456/attempts/1",
      },
      byproducts: [],
    },
  };
}
