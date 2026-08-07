import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  finalizeServerAndRoot,
  MAX_CHILD_OUTPUT_BYTES,
  observeServer,
  runExample,
  withTimeout,
} from "./sdk-capability-production-process.mjs";

const SERVER_ENTRY = path.resolve("apps/server/dist/index.js");
const STARTUP_TIMEOUT_MS = 10_000;

export async function runBoundProductionServerTrace() {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-sdk-production-trace-"),
  );
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "state");
  const childTempRoot = path.join(root, "tmp");
  const serverEnvironment = {
    LANG: "C",
    NAPIER_HOME: dataRoot,
    NAPIER_PORT: "0",
    NAPIER_WORKSPACE: workspaceRoot,
    NODE_ENV: "test",
    TMPDIR: childTempRoot,
    TZ: "UTC",
  };
  const receipt = {
    schemaVersion: 1,
    serverEntrySha256: await sha256File(SERVER_ENTRY),
    sdkManagementEntrySha256: await sha256File(
      path.resolve("packages/sdk/dist/management.js"),
    ),
    allowlistedEnvironmentKeys: Object.keys(serverEnvironment).sort(),
    listener: { loopback: false, ephemeralNonzeroPort: false },
    child: {
      startupBounded: false,
      outputBounded: false,
      gracefulZeroExit: false,
      forcedCleanup: false,
      stdoutBytes: 0,
      stderrBytes: 0,
      totalOutputBytes: 0,
      maximumOutputBytes: MAX_CHILD_OUTPUT_BYTES,
    },
    example: {
      timeoutBounded: false,
      outputBounded: false,
      gracefulZeroExit: false,
      forcedCleanup: false,
      stdoutBytes: 0,
      stderrBytes: 0,
      totalOutputBytes: 0,
      maximumOutputBytes: MAX_CHILD_OUTPUT_BYTES,
    },
    sdk: {
      externalProcess: false,
      builtPackageSubpath: false,
      globalFetch: false,
      integrityVerified: false,
      agentId: "",
      agentRevision: 0,
      driftState: "",
      ownership: "",
      projectionSha256: "",
    },
    storeNonMutation: false,
    portClosed: false,
    postExitSdkRequestFailed: false,
    cleanup: { rootValidated: false, removed: false },
  };
  let server;
  let observed;
  let origin;
  let operationError;
  let cleanupError;
  try {
    await Promise.all([
      mkdir(workspaceRoot),
      mkdir(dataRoot),
      mkdir(childTempRoot),
    ]);
    server = spawn(process.execPath, [SERVER_ENTRY], {
      cwd: process.cwd(),
      env: serverEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    observed = observeServer(server);
    origin = await withTimeout(
      observed.origin,
      STARTUP_TIMEOUT_MS,
      "Production server startup timed out",
    );
    receipt.child.startupBounded = true;
    const parsedOrigin = new URL(origin);
    assert.equal(parsedOrigin.protocol, "http:");
    assert.equal(parsedOrigin.hostname, "127.0.0.1");
    assert.ok(Number(parsedOrigin.port) > 0);
    receipt.listener.loopback = true;
    receipt.listener.ephemeralNonzeroPort = true;
    receipt.listener.announcedOriginSha256 = sha256Text(origin);
    await waitForFile(path.join(dataRoot, "workspace.json"));
    const before = await storeDigests(dataRoot);
    const example = await runExample(origin, childTempRoot);
    receipt.sdk = {
      externalProcess: true,
      builtPackageSubpath: true,
      globalFetch: true,
      integrityVerified: true,
      ...example.result,
    };
    assert.equal(example.result.agentId, "agent_napier");
    assert.equal(example.result.agentRevision, 1);
    assert.equal(example.result.driftState, "current");
    assert.equal(example.result.ownership, "recommended");
    receipt.example = example.process;
    observed.assertOutputBounded();
    const after = await storeDigests(dataRoot);
    assert.deepEqual(after, before);
    receipt.storeNonMutation = true;
    receipt.storeDigests = { before, after };
  } catch (error) {
    operationError = error;
  } finally {
    try {
      await finalizeServerAndRoot({
        child: server,
        observed,
        origin,
        receipt,
        cleanupRoot: async () => {
          receipt.cleanup.rootValidated = await validateOwnedRoot(root);
          if (receipt.cleanup.rootValidated) {
            await rm(root, { recursive: true, force: true });
            receipt.cleanup.removed = await access(root).then(
              () => false,
              () => true,
            );
          }
        },
      });
    } catch (error) {
      cleanupError = error;
    }
  }
  if (operationError && cleanupError) {
    throw new AggregateError(
      [operationError, cleanupError],
      "Production trace and cleanup both failed",
    );
  }
  if (operationError) throw operationError;
  if (cleanupError) throw cleanupError;
  return receipt;
}

async function waitForFile(filePath) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (
      await access(filePath).then(
        () => true,
        () => false,
      )
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Production server Store did not become readable");
}

async function validateOwnedRoot(root) {
  const [canonicalRoot, canonicalTmp, info] = await Promise.all([
    realpath(root),
    realpath(tmpdir()),
    lstat(root),
  ]);
  return (
    !info.isSymbolicLink() &&
    path.dirname(canonicalRoot) === canonicalTmp &&
    path.basename(canonicalRoot).startsWith("napier-sdk-production-trace-")
  );
}

async function storeDigests(dataRoot) {
  const workspaceBytes = await readFile(path.join(dataRoot, "workspace.json"));
  const workspace = JSON.parse(workspaceBytes.toString("utf8"));
  const eventManifest = [];
  await collectEventFiles(dataRoot, dataRoot, eventManifest);
  eventManifest.sort((left, right) => left.path.localeCompare(right.path));
  return {
    rawWorkspaceSha256: sha256Bytes(workspaceBytes),
    logicalStoreSha256: sha256Text(canonicalJson(workspace)),
    eventManifestSha256: sha256Text(canonicalJson(eventManifest)),
  };
}

async function collectEventFiles(root, current, output) {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await collectEventFiles(root, absolute, output);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      output.push({
        path: path.relative(root, absolute).split(path.sep).join("/"),
        sha256: await sha256File(absolute),
      });
    }
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256File(filePath) {
  return sha256Bytes(await readFile(filePath));
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Text(value) {
  return sha256Bytes(Buffer.from(value, "utf8"));
}
