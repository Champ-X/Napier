import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { validWindowsProductAcceptance } from "./windows-host-product-acceptance-product.mjs";

export const WINDOWS_ACCEPTANCE_WORKFLOW =
  ".github/workflows/windows-host-product-acceptance.yml";
export const WINDOWS_ACCEPTANCE_KIND = "napier.windows-host-product-acceptance";
export const WINDOWS_ACCEPTANCE_NODE_VERSION = "v24.16.0";
export const WINDOWS_ACCEPTANCE_PTY_VERSION = "1.2.0-beta.15";
export const WINDOWS_ACCEPTANCE_IMAGE = "napier-sandbox:0.1.0";

const SHA256 = /^[a-f0-9]{64}$/u;
const SOURCE_SHA = /^[a-f0-9]{40}$/u;
const VERSION = /^[0-9]+(?:\.[0-9]+){1,3}(?:[-.][A-Za-z0-9]+)*$/u;

export async function windowsHostProductAcceptanceImplementation(repoRoot) {
  const files = {
    packageLock: "package-lock.json",
    sandboxDockerfile: "docker/napier-sandbox/Dockerfile",
    sandboxPackageJson: "docker/napier-sandbox/package.json",
    sandboxPackageLock: "docker/napier-sandbox/package-lock.json",
    containerExecutable: "packages/runtime/src/sandbox-container.ts",
    containerExecutableTest: "packages/runtime/test/sandbox.test.ts",
    workflow: WINDOWS_ACCEPTANCE_WORKFLOW,
    ptyPreparation: "scripts/prepare-node-pty.mjs",
    imageEvidence: "scripts/check-sandbox-image-sbom.mjs",
    productCheck: "scripts/check-sandbox-product-acceptance.mjs",
    productArtifact: "scripts/sandbox-product-acceptance-artifact.mjs",
    productLive: "scripts/sandbox-product-acceptance-live.mjs",
    firstUseHarness: "scripts/sandbox-first-use-coding-acceptance.mjs",
    firstUseSupport: "scripts/sandbox-first-use-coding-support.mjs",
    invalidBindingRepairHarness:
      "scripts/sandbox-invalid-binding-repair-acceptance.mjs",
    invalidBindingRepairVerifier:
      "scripts/sandbox-invalid-binding-repair-artifact.mjs",
    hostLive: "scripts/windows-host-product-acceptance-live.mjs",
    hostSupport: "scripts/windows-host-product-acceptance-support.mjs",
    hostCheck: "scripts/check-windows-host-product-acceptance.mjs",
    artifactVerifier: "scripts/windows-host-product-acceptance-artifact.mjs",
    productVerifier: "scripts/windows-host-product-acceptance-product.mjs",
    workflowVerifier:
      "scripts/check-windows-host-product-acceptance-workflow.mjs",
  };
  return Object.fromEntries(
    await Promise.all(
      Object.entries(files).map(async ([name, relative]) => [
        `${name}Sha256`,
        sha256(await readFile(path.join(repoRoot, relative))),
      ]),
    ),
  );
}

export function createWindowsHostProductAcceptanceReceipt(input) {
  const withoutHash = {
    kind: WINDOWS_ACCEPTANCE_KIND,
    schemaVersion: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    repository: "Champ-X/Napier",
    workflow: WINDOWS_ACCEPTANCE_WORKFLOW,
    workflowRunId: input.workflowRunId,
    workflowRunAttempt: input.workflowRunAttempt,
    sourceSha: input.sourceSha,
    implementation: input.implementation,
    host: input.host,
    source: input.source,
    install: input.install,
    pty: input.pty,
    build: input.build,
    image: input.image,
    product: input.product,
    durationMs: input.durationMs,
    resourceClosure: input.resourceClosure,
    retention: {
      credentialValues: false,
      rawCommandOutput: false,
      rawDockerOutput: false,
      rawDoctorReport: false,
      rawProcessOutput: false,
      resourceNames: false,
      workspacePaths: false,
      dataRootPaths: false,
      endpointUrls: false,
      dependencyTree: false,
      buildOutput: false,
      imageBytes: false,
    },
    scope: {
      sliceComplete: true,
      s1Complete: false,
      freshWindowsCheckout: true,
      githubHostedWindowsRunner: true,
      windowsHostProductAcceptance: true,
      stage13ProductLifecycle: true,
      externalRegistryPublished: false,
      releaseSigningIdentity: false,
      transparencyLogRecorded: false,
      externalAttestation: false,
      remaining: [
        "external multi-architecture registry publication",
        "release signing identity and transparency log",
        "external attestation",
      ],
    },
  };
  return {
    ...withoutHash,
    contentSha256: sha256(canonicalJson(withoutHash)),
  };
}

export function validateWindowsHostProductAcceptanceReceipt(value, expected) {
  const errors = [];
  if (
    !record(value) ||
    !exactKeys(value, [
      "kind",
      "schemaVersion",
      "generatedAt",
      "repository",
      "workflow",
      "workflowRunId",
      "workflowRunAttempt",
      "sourceSha",
      "implementation",
      "host",
      "source",
      "install",
      "pty",
      "build",
      "image",
      "product",
      "durationMs",
      "resourceClosure",
      "retention",
      "scope",
      "contentSha256",
    ]) ||
    value.kind !== WINDOWS_ACCEPTANCE_KIND ||
    value.schemaVersion !== 1 ||
    !isoDate(value.generatedAt) ||
    value.repository !== "Champ-X/Napier" ||
    value.workflow !== WINDOWS_ACCEPTANCE_WORKFLOW ||
    !positiveIntegerText(value.workflowRunId) ||
    !positiveIntegerText(value.workflowRunAttempt) ||
    !SOURCE_SHA.test(value.sourceSha) ||
    value.sourceSha !== expected.sourceSha ||
    canonicalJson(value.implementation) !==
      canonicalJson(expected.implementation) ||
    !validHost(value.host) ||
    !validSource(value.source, expected) ||
    !validCommand(value.install) ||
    !validPty(value.pty) ||
    !validCommand(value.build) ||
    !validImage(value.image, expected) ||
    !validProduct(value.product) ||
    value.product?.imageProvenanceSha256 !== value.image?.provenanceSha256 ||
    !Number.isSafeInteger(value.durationMs) ||
    value.durationMs < 0 ||
    value.durationMs > 45 * 60 * 1_000 ||
    !validResourceClosure(value.resourceClosure) ||
    !validRetention(value.retention) ||
    !validScope(value.scope) ||
    !SHA256.test(value.contentSha256)
  ) {
    errors.push("Windows host product acceptance receipt shape is invalid");
    return errors;
  }
  const { contentSha256, ...content } = value;
  if (contentSha256 !== sha256(canonicalJson(content))) {
    errors.push("Windows host product acceptance receipt hash is invalid");
  }
  return errors;
}

function validHost(value) {
  const identity = value && {
    platform: value.platform,
    arch: value.arch,
    osRelease: value.osRelease,
    runnerEnvironment: value.runnerEnvironment,
    runnerOs: value.runnerOs,
    runnerArch: value.runnerArch,
    nodeVersion: value.nodeVersion,
    npmVersion: value.npmVersion,
    dockerEndpointKind: value.dockerEndpointKind,
    dockerEndpointSha256: value.dockerEndpointSha256,
    dockerServerOs: value.dockerServerOs,
    dockerServerArch: value.dockerServerArch,
    dockerServerVersion: value.dockerServerVersion,
  };
  return (
    record(value) &&
    exactKeys(value, [...Object.keys(identity), "identitySha256"]) &&
    value.platform === "win32" &&
    value.arch === "x64" &&
    typeof value.osRelease === "string" &&
    value.osRelease.length > 0 &&
    value.osRelease.length <= 100 &&
    value.runnerEnvironment === "github-hosted" &&
    value.runnerOs === "Windows" &&
    value.runnerArch === "X64" &&
    value.nodeVersion === WINDOWS_ACCEPTANCE_NODE_VERSION &&
    VERSION.test(value.npmVersion) &&
    value.dockerEndpointKind === "wsl2-loopback-linux-docker-engine" &&
    value.dockerEndpointSha256 === sha256("tcp://127.0.0.1:2375") &&
    value.dockerServerOs === "linux" &&
    value.dockerServerArch === "amd64" &&
    VERSION.test(value.dockerServerVersion) &&
    value.identitySha256 === sha256(canonicalJson(identity))
  );
}

function validSource(value, expected) {
  return (
    record(value) &&
    exactKeys(value, [
      "cleanCheckout",
      "gitHead",
      "mainTip",
      "nodeModulesAbsentBeforeInstall",
      "distAbsentBeforeBuild",
      "trackedFileCount",
      "packageLockSha256",
    ]) &&
    value.cleanCheckout === true &&
    value.gitHead === expected.sourceSha &&
    value.mainTip === expected.sourceSha &&
    value.nodeModulesAbsentBeforeInstall === true &&
    value.distAbsentBeforeBuild === true &&
    Number.isSafeInteger(value.trackedFileCount) &&
    value.trackedFileCount >= 1_000 &&
    value.packageLockSha256 === expected.implementation.packageLockSha256
  );
}

function validCommand(value) {
  return (
    record(value) &&
    exactKeys(value, [
      "status",
      "exitCode",
      "outputBytes",
      "outputSha256",
      "durationMs",
    ]) &&
    value.status === "passed" &&
    value.exitCode === 0 &&
    Number.isSafeInteger(value.outputBytes) &&
    value.outputBytes >= 0 &&
    value.outputBytes <= 1024 * 1024 &&
    SHA256.test(value.outputSha256) &&
    Number.isSafeInteger(value.durationMs) &&
    value.durationMs >= 0 &&
    value.durationMs <= 15 * 60 * 1_000
  );
}

function validPty(value) {
  return (
    record(value) &&
    exactKeys(value, [
      "package",
      "version",
      "binary",
      "nativeBinarySha256",
      "probeOutputSha256",
      "exitCode",
      "passed",
    ]) &&
    value.package === "@lydell/node-pty-win32-x64" &&
    value.version === WINDOWS_ACCEPTANCE_PTY_VERSION &&
    value.binary === "prebuilds/win32-x64/conpty.node" &&
    SHA256.test(value.nativeBinarySha256) &&
    SHA256.test(value.probeOutputSha256) &&
    value.exitCode === 0 &&
    value.passed === true
  );
}

function validImage(value, expected) {
  return (
    record(value) &&
    exactKeys(value, [
      "reference",
      "id",
      "platform",
      "contextSha256",
      "sbomSha256",
      "provenanceSha256",
    ]) &&
    value.reference === WINDOWS_ACCEPTANCE_IMAGE &&
    /^sha256:[a-f0-9]{64}$/u.test(value.id) &&
    value.platform === "linux/amd64" &&
    value.contextSha256 === expected.contextSha256 &&
    SHA256.test(value.sbomSha256) &&
    SHA256.test(value.provenanceSha256)
  );
}

function validProduct(value) {
  return validWindowsProductAcceptance(value);
}

function validResourceClosure(value) {
  return (
    record(value) &&
    exactKeys(value, [
      "productResourceBaselineRestored",
      "hostContainerBaselineRestored",
      "hostNetworkBaselineRestored",
      "hostImageBaselineRestored",
      "officialImageTagRestored",
      "repositoryEvidenceRestored",
      "cleanCheckoutRestored",
      "dependenciesRemoved",
      "buildOutputRemoved",
      "temporaryEnvironmentRemoved",
    ]) &&
    value.productResourceBaselineRestored === true &&
    value.hostContainerBaselineRestored === true &&
    value.hostNetworkBaselineRestored === true &&
    value.hostImageBaselineRestored === true &&
    value.officialImageTagRestored === true &&
    value.repositoryEvidenceRestored === true &&
    value.cleanCheckoutRestored === true &&
    value.dependenciesRemoved === true &&
    value.buildOutputRemoved === true &&
    value.temporaryEnvironmentRemoved === true
  );
}

function validRetention(value) {
  const fields = [
    "credentialValues",
    "rawCommandOutput",
    "rawDockerOutput",
    "rawDoctorReport",
    "rawProcessOutput",
    "resourceNames",
    "workspacePaths",
    "dataRootPaths",
    "endpointUrls",
    "dependencyTree",
    "buildOutput",
    "imageBytes",
  ];
  return (
    record(value) &&
    Object.keys(value).sort().join("\n") === fields.sort().join("\n") &&
    fields.every((field) => value[field] === false)
  );
}

function validScope(value) {
  return (
    record(value) &&
    exactKeys(value, [
      "sliceComplete",
      "s1Complete",
      "freshWindowsCheckout",
      "githubHostedWindowsRunner",
      "windowsHostProductAcceptance",
      "stage13ProductLifecycle",
      "externalRegistryPublished",
      "releaseSigningIdentity",
      "transparencyLogRecorded",
      "externalAttestation",
      "remaining",
    ]) &&
    value.sliceComplete === true &&
    value.s1Complete === false &&
    value.freshWindowsCheckout === true &&
    value.githubHostedWindowsRunner === true &&
    value.windowsHostProductAcceptance === true &&
    value.stage13ProductLifecycle === true &&
    value.externalRegistryPublished === false &&
    value.releaseSigningIdentity === false &&
    value.transparencyLogRecorded === false &&
    value.externalAttestation === false &&
    value.remaining?.join("\n") ===
      [
        "external multi-architecture registry publication",
        "release signing identity and transparency log",
        "external attestation",
      ].join("\n")
  );
}

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isoDate(value) {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function positiveIntegerText(value) {
  return typeof value === "string" && /^[1-9][0-9]*$/u.test(value);
}

function exactKeys(value, names) {
  return Object.keys(value).sort().join("\n") === [...names].sort().join("\n");
}
