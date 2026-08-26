import { execFile as execFileWithCallback } from "node:child_process";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  LspDefinitionRunner,
  LspDiagnosticsRunner,
  LspSymbolsRunner,
  OciContainerSandboxAdapter,
  canonicalJson,
  sha256,
} from "../packages/runtime/dist/index.js";
import { createLspProtocolPathBinding } from "../packages/runtime/dist/lsp-protocol-path-binding.js";
import { PORTABLE_CONTAINER_USER_IDS } from "../packages/runtime/dist/sandbox-container-runtime.js";

const execFile = promisify(execFileWithCallback);
const CONTAINER_NAME = /^napier-[a-f0-9]{32}$/u;
const NETWORK_NAME = /^napier-network-[a-f0-9]{32}$/u;
const SCRATCH_NAME = /^napier-process-sandbox-[A-Za-z0-9]{6}$/u;
const SCRATCH_TOMBSTONE =
  /^napier-process-sandbox-[A-Za-z0-9]{6}\.[a-f0-9]{16}\.guardian-remove$/u;
const TARGET = "packages/contracts/src/sandbox-setup.ts";
const TIMEOUT_MS = 15_000;

export async function runSandboxPortableLspAcceptance(input) {
  const snapshot = input.dependencies?.snapshot ?? snapshotResources;
  const baseline = await snapshot();
  const protocolBinding = controlledProtocolBinding();
  const host = await runArm(input.repoRoot, input.imageId);
  const portable = await runArm(
    input.repoRoot,
    input.imageId,
    PORTABLE_CONTAINER_USER_IDS,
  );
  const productionParity = parityEvidence(host, portable);
  const finalSnapshot = await snapshot();
  const delta = resourceDelta(baseline, finalSnapshot);
  if (Object.values(delta).some((count) => count !== 0)) {
    throw new Error("Sandbox portable LSP did not restore resources");
  }
  return {
    protocolBinding,
    productionParity,
    resourceClosure: {
      exactBaselineRestored: true,
      ...delta,
    },
  };
}

async function runArm(repoRoot, imageId, userIds) {
  const sandbox = new OciContainerSandboxAdapter(imageId, {
    ...(userIds ? { userIds } : {}),
  });
  const diagnostics = await new LspDiagnosticsRunner({
    workspaceRoot: repoRoot,
    sandbox,
  }).run({ path: TARGET, timeoutMs: TIMEOUT_MS });
  const symbols = await new LspSymbolsRunner({
    workspaceRoot: repoRoot,
    sandbox,
  }).run({ path: TARGET, maxSymbols: 32, timeoutMs: TIMEOUT_MS });
  const definition = await new LspDefinitionRunner({
    workspaceRoot: repoRoot,
    sandbox,
  }).run({
    path: TARGET,
    line: 29,
    character: 11,
    timeoutMs: TIMEOUT_MS,
  });
  return {
    diagnostics: {
      status: diagnostics.details.status,
      resultSha256: diagnostics.details.resultSha256,
      projection: diagnostics.diagnostics,
    },
    symbols: {
      status: symbols.details.status,
      resultSha256: symbols.details.resultSha256,
      projection: symbols.symbols.map((symbol) => ({
        nameSha256: sha256(symbol.name),
        kind: symbol.kindLabel,
        rangeSha256: symbol.rangeSha256,
        selectionRangeSha256: symbol.selectionRangeSha256,
      })),
    },
    definition: {
      status: definition.details.status,
      resultSha256: definition.details.resultSha256,
      projection: definition.locations.map((location) => ({
        pathSha256: location.pathSha256,
        fileSha256: location.fileSha256,
        rangeSha256: location.rangeSha256,
      })),
    },
  };
}

function parityEvidence(host, portable) {
  const diagnostics = capabilityParity(host.diagnostics, portable.diagnostics);
  const symbols = capabilityParity(host.symbols, portable.symbols);
  const definition = capabilityParity(host.definition, portable.definition);
  const allEqual = diagnostics.equal && symbols.equal && definition.equal;
  if (
    host.diagnostics.status !== "clean" ||
    portable.diagnostics.status !== "clean" ||
    host.symbols.status !== "found" ||
    portable.symbols.status !== "found" ||
    host.definition.status !== "found" ||
    portable.definition.status !== "found" ||
    !allEqual
  ) {
    throw new Error("Sandbox portable LSP parity failed");
  }
  const content = {
    hostPlatform: process.platform,
    sandbox: "oci-container",
    sameTarget: true,
    diagnostics,
    symbols,
    definition,
    allEqual,
  };
  return {
    ...content,
    evidenceSha256: sha256(canonicalJson(content)),
  };
}

function capabilityParity(host, portable) {
  const hostProjectionSha256 = sha256(canonicalJson(host.projection));
  const portableProjectionSha256 = sha256(canonicalJson(portable.projection));
  return {
    hostStatus: host.status,
    portableStatus: portable.status,
    equal: hostProjectionSha256 === portableProjectionSha256,
    hostResultSha256: host.resultSha256,
    portableResultSha256: portable.resultSha256,
    projectionSha256: hostProjectionSha256,
  };
}

function controlledProtocolBinding() {
  const binding = createLspProtocolPathBinding({
    workspaceRoot: "/host/workspace",
    target: "/host/workspace/packages/example.ts",
    protocolWorkspaceRoot: "/workspace",
  });
  const hostUri = binding.toHostUri("file:///workspace/packages/example.ts");
  const content = {
    protocolWorkspaceRoot: "/workspace",
    workspaceRootMapped: binding.workspaceRootUri === "file:///workspace",
    targetUriMapped:
      binding.targetUri === "file:///workspace/packages/example.ts",
    hostUriRestored: hostUri === "file:///host/workspace/packages/example.ts",
    escapeRejected:
      binding.toHostUri("file:///outside/example.ts") === undefined,
    authorityRejected:
      binding.toHostUri("file://server/workspace/example.ts") === undefined,
    queryRejected:
      binding.toHostUri("file:///workspace/example.ts?secret=value") ===
      undefined,
  };
  if (
    Object.values(content).some(
      (value) => value !== true && value !== "/workspace",
    )
  ) {
    throw new Error("Sandbox portable LSP protocol binding failed");
  }
  return {
    ...content,
    bindingSha256: sha256(canonicalJson(content)),
  };
}

async function snapshotResources() {
  const [containers, networks, scratch] = await Promise.all([
    runDocker(["container", "ls", "--all", "--format", "{{.Names}}"]),
    runDocker(["network", "ls", "--format", "{{.Name}}"]),
    readdir(scratchBaseDirectory()).catch(() => []),
  ]);
  return {
    containers: names(containers, CONTAINER_NAME),
    networks: names(networks, NETWORK_NAME),
    scratch: scratch
      .filter((name) => SCRATCH_NAME.test(name) || SCRATCH_TOMBSTONE.test(name))
      .sort(),
  };
}

async function runDocker(args) {
  const result = await execFile("docker", args, {
    encoding: "utf8",
    env: dockerEnvironment(),
    timeout: 30_000,
    maxBuffer: 64 * 1024,
    windowsHide: true,
  });
  if (result.stderr !== "") {
    throw new Error("Docker resource snapshot emitted diagnostics");
  }
  return result.stdout;
}

function resourceDelta(before, after) {
  return {
    containerDeltaCount: symmetricDifference(
      before.containers,
      after.containers,
    ),
    networkDeltaCount: symmetricDifference(before.networks, after.networks),
    scratchDeltaCount: symmetricDifference(before.scratch, after.scratch),
  };
}

function names(text, pattern) {
  return text
    .trim()
    .split("\n")
    .filter((name) => pattern.test(name))
    .sort();
}

function symmetricDifference(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    left.filter((value) => !rightSet.has(value)).length +
    right.filter((value) => !leftSet.has(value)).length
  );
}

function scratchBaseDirectory() {
  const configured = process.env.NAPIER_CONTAINER_SANDBOX_SCRATCH_DIR?.trim();
  return configured && path.isAbsolute(configured) ? configured : tmpdir();
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
