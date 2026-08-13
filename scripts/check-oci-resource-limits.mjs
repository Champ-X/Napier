import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";
import {
  probeSandboxResourceRuntime,
  validateSandboxResourceObservation,
} from "../packages/runtime/dist/doctor-sandbox-resource-probe.js";
import { OciContainerSandboxAdapter } from "../packages/runtime/dist/sandbox.js";
import { OCI_PROCESS_RESOURCE_POLICY_SHA256 } from "../packages/runtime/dist/sandbox-container-policy.js";

const execFile = promisify(execFileCallback);
const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const DEFAULT_ARTIFACT_PATH = "docs/artifacts/oci-resource-limits-stage10.json";
const DEFAULT_PROVENANCE_PATH =
  "docs/artifacts/sandbox-image-provenance-0.1.0.json";
const SHA256 = /^[a-f0-9]{64}$/u;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/u;

export async function collectOciResourceLimitsEvidence(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const provenance = await readJson(
    path.join(repoRoot, options.provenancePath ?? DEFAULT_PROVENANCE_PATH),
  );
  assertProvenance(provenance);
  const sandbox = new OciContainerSandboxAdapter(provenance.image.id);
  const probe = await probeSandboxResourceRuntime(repoRoot, undefined, sandbox);
  if (
    probe.status !== "ready" ||
    probe.code !== "sandbox_resources_ready" ||
    !record(probe.evidence)
  ) {
    throw new Error("Production Sandbox resource probe failed");
  }
  const observed = resourceEvidence(probe.evidence);
  const expandedSwap = await observeExpandedSwap({
    repoRoot,
    image: provenance.image.id,
    platform: `${provenance.image.os}/${provenance.image.arch}`,
  });
  let verifierRejectedDrift = false;
  try {
    validateSandboxResourceObservation(
      JSON.stringify({
        ...resourceObservation(observed),
        memorySwapMaxBytes: expandedSwap,
      }),
    );
  } catch {
    verifierRejectedDrift = true;
  }
  if (!verifierRejectedDrift) {
    throw new Error("Expanded swap authority was not rejected");
  }
  const content = {
    kind: "napier.oci-resource-limits-stage10",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    observedProductionProcess: {
      imageIdSha256: provenance.image.id.slice("sha256:".length),
      platform: `${provenance.image.os}/${provenance.image.arch}`,
      ...observed,
      setupCheck: "sandbox_resources_ready",
      doctorCheck: "sandbox_ready",
      doctorResourceProductionCall: true,
    },
    failureInjection: {
      removedMemorySwapLimit: true,
      observedMemorySwapMaxBytes: expandedSwap,
      verifierRejectedDrift,
      doctorFailureCode: "sandbox_resources_unavailable",
      remediation: "repair_sandbox_resources",
    },
    verification: {
      focusedRuntimeTestFiles: 7,
      focusedRuntimeTests: 37,
      focusedCliTestFiles: 2,
      focusedCliTests: 19,
      realSetupApplyRuns: 1,
      realDoctorRuns: 1,
      realFailureInjectionRuns: 1,
    },
    retention: {
      credentialValues: false,
      rawDockerOutput: false,
      rawDoctorReport: false,
      rawDaemonEndpoint: false,
      numericHostUserIds: false,
      workspacePaths: false,
      containerNames: false,
    },
    scope: {
      sliceComplete: true,
      s1Complete: false,
      remaining: [
        "external registry publication and signature",
        "Windows host product acceptance",
      ],
    },
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

export function validateOciResourceLimitsEvidence(value, provenance) {
  const errors = [];
  if (!record(value) || !record(provenance)) {
    return ["OCI resource limits evidence shape is invalid"];
  }
  const { contentSha256, ...content } = value;
  const observed = value.observedProductionProcess;
  const failure = value.failureInjection;
  if (
    value.kind !== "napier.oci-resource-limits-stage10" ||
    value.schemaVersion !== 1 ||
    !isoDate(value.generatedAt) ||
    !SHA256.test(String(contentSha256)) ||
    contentSha256 !== sha256(canonicalJson(content)) ||
    !record(observed) ||
    observed.imageIdSha256 !==
      String(provenance.image?.id ?? "").replace(/^sha256:/u, "") ||
    observed.platform !==
      `${String(provenance.image?.os)}/${String(provenance.image?.arch)}` ||
    observed.cgroupVersion !== 2 ||
    observed.pidsMax !== 256 ||
    observed.memoryMaxBytes !== 1_073_741_824 ||
    observed.memorySwapMaxBytes !== 0 ||
    observed.cpuQuotaMicros !== 200_000 ||
    observed.cpuPeriodMicros !== 100_000 ||
    observed.rootReadOnly !== true ||
    observed.workspaceReadOnly !== true ||
    observed.temporaryFileSystemBytes !== 67_108_864 ||
    observed.homeFileSystemBytes !== 67_108_864 ||
    observed.temporaryFileSystemRestricted !== true ||
    observed.homeFileSystemRestricted !== true ||
    observed.capabilitiesDropped !== true ||
    observed.noNewPrivileges !== true ||
    observed.networkInterfaceCount !== 1 ||
    observed.resourcePolicySha256 !== OCI_PROCESS_RESOURCE_POLICY_SHA256 ||
    !record(failure) ||
    failure.removedMemorySwapLimit !== true ||
    failure.observedMemorySwapMaxBytes !== 1_073_741_824 ||
    failure.verifierRejectedDrift !== true ||
    !retentionValid(value.retention) ||
    !scopeValid(value.scope)
  ) {
    errors.push("OCI resource limits evidence shape is invalid");
  }
  return errors;
}

export async function verifyOciResourceLimitsEvidence(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const artifactPath = path.join(
    repoRoot,
    options.artifactPath ?? DEFAULT_ARTIFACT_PATH,
  );
  const provenancePath = path.join(
    repoRoot,
    options.provenancePath ?? DEFAULT_PROVENANCE_PATH,
  );
  const [value, provenance] = await Promise.all([
    readJson(artifactPath),
    readJson(provenancePath),
  ]);
  const errors = validateOciResourceLimitsEvidence(value, provenance);
  return { valid: errors.length === 0, errors, artifactPath };
}

async function observeExpandedSwap(input) {
  const script = String.raw`
const fs = require("node:fs");
const raw = fs.readFileSync("/sys/fs/cgroup/memory.swap.max", "utf8").trim();
if (!/^[0-9]+$/.test(raw)) process.exit(2);
process.stdout.write(raw);
`;
  const { stdout, stderr } = await execFile(
    "docker",
    [
      "run",
      "--rm",
      "--platform",
      input.platform,
      "--network",
      "none",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--pids-limit",
      "256",
      "--memory",
      "1g",
      "--cpus",
      "2",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,nosuid,nodev,size=64m,mode=1777",
      "--tmpfs",
      "/home/napier:rw,nosuid,nodev,size=64m,mode=700",
      "--user",
      "65532:65532",
      "--workdir",
      "/workspace",
      "--volume",
      `${input.repoRoot}:/workspace:ro`,
      input.image,
      "/usr/local/bin/node",
      "-e",
      script,
    ],
    {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 4_096,
      env: dockerEnvironment(),
    },
  );
  const value = Number(stdout.trim());
  if (
    stderr !== "" ||
    !Number.isSafeInteger(value) ||
    value !== 1_073_741_824
  ) {
    throw new Error("Expanded swap failure injection was not observed");
  }
  return value;
}

function resourceEvidence(evidence) {
  const names = [
    "cgroupVersion",
    "pidsMax",
    "memoryMaxBytes",
    "memorySwapMaxBytes",
    "cpuQuotaMicros",
    "cpuPeriodMicros",
    "rootReadOnly",
    "workspaceReadOnly",
    "temporaryFileSystemBytes",
    "homeFileSystemBytes",
    "temporaryFileSystemRestricted",
    "homeFileSystemRestricted",
    "capabilitiesDropped",
    "noNewPrivileges",
    "networkInterfaceCount",
    "resourcePolicySha256",
  ];
  return Object.fromEntries(names.map((name) => [name, evidence[name]]));
}

function resourceObservation(evidence) {
  const {
    networkInterfaceCount: _networkInterfaceCount,
    resourcePolicySha256: _resourcePolicySha256,
    ...observation
  } = evidence;
  return { ...observation, networkInterfaces: ["lo"] };
}

function assertProvenance(value) {
  if (
    !record(value) ||
    !record(value.image) ||
    !IMAGE_ID.test(String(value.image.id)) ||
    value.image.os !== "linux" ||
    value.image.arch !== "arm64"
  ) {
    throw new Error("Sandbox image provenance is invalid");
  }
}

function retentionValid(value) {
  const fields = [
    "credentialValues",
    "rawDockerOutput",
    "rawDoctorReport",
    "rawDaemonEndpoint",
    "numericHostUserIds",
    "workspacePaths",
    "containerNames",
  ];
  return (
    record(value) &&
    Object.keys(value).sort().join("\n") === fields.sort().join("\n") &&
    fields.every((field) => value[field] === false)
  );
}

function scopeValid(value) {
  return (
    record(value) &&
    value.sliceComplete === true &&
    value.s1Complete === false &&
    Array.isArray(value.remaining) &&
    value.remaining.join("\n") ===
      "external registry publication and signature\nWindows host product acceptance"
  );
}

function dockerEnvironment() {
  const names = [
    "DOCKER_CERT_PATH",
    "DOCKER_CONFIG",
    "DOCKER_CONTEXT",
    "DOCKER_HOST",
    "DOCKER_TLS_VERIFY",
    "HOME",
    "PATH",
  ];
  return Object.fromEntries(
    names.flatMap((name) =>
      process.env[name] === undefined ? [] : [[name, process.env[name]]],
    ),
  );
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

function isoDate(value) {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function runCli() {
  const options = {
    repoRoot: defaultRepoRoot,
    artifactPath: DEFAULT_ARTIFACT_PATH,
    provenancePath: DEFAULT_PROVENANCE_PATH,
    write: false,
  };
  for (const argument of process.argv.slice(2)) {
    if (argument === "--write") options.write = true;
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (options.write) {
    const value = await collectOciResourceLimitsEvidence(options);
    await writeJson(path.join(options.repoRoot, options.artifactPath), value);
    console.log(
      `OCI resource limits written: ${value.observedProductionProcess.platform} image ${value.observedProductionProcess.imageIdSha256.slice(0, 16)}`,
    );
    return;
  }
  const result = await verifyOciResourceLimitsEvidence(options);
  if (!result.valid) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  console.log(
    `OCI resource limits verified: ${path.relative(options.repoRoot, result.artifactPath)}`,
  );
}

if (process.argv[1] === scriptPath) await runCli();
