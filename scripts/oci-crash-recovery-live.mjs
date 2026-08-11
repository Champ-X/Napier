import { execFile as execFileWithCallback, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";
import { OCI_CRASH_RECOVERY_CHILD_SOURCE } from "./oci-crash-recovery-fixture.mjs";

const execFile = promisify(execFileWithCallback);
const CHILD_READY_TIMEOUT_MS = 20_000;
const CLEANUP_TIMEOUT_MS = 15_000;
const MAX_CHILD_OUTPUT_BYTES = 4_096;
const MAX_DOCKER_OUTPUT_BYTES = 64 * 1024;
const CONTAINER_NAME = /^napier-[a-f0-9]{32}$/u;
const NETWORK_NAME = /^napier-network-[a-f0-9]{32}$/u;
const SCRATCH_NAME = /^napier-process-sandbox-[A-Za-z0-9]{6}$/u;
const SCRATCH_TOMBSTONE =
  /^napier-process-sandbox-[A-Za-z0-9]{6}\.[a-f0-9]{16}\.guardian-remove$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SERVICE_MARKER = "napier_crash_recovery_ready";

export async function collectOciCrashRecoveryCycles(input) {
  const baseline = await snapshotResources({
    dependencies: input.dependencies,
  });
  const cycles = [];
  for (let index = 1; index <= 2; index += 1) {
    cycles.push(
      await runCrashCycle({
        ...input,
        baseline,
        index,
      }),
    );
  }
  if (cycles[0].endpointSha256 === cycles[1].endpointSha256) {
    throw new Error("Crash recovery reused an ephemeral service endpoint");
  }
  return cycles;
}

async function runCrashCycle(input) {
  const spawnChild = input.dependencies?.spawnChild ?? spawnRuntimeChild;
  const snapshot = input.dependencies?.snapshot ?? snapshotResources;
  const probeHealth = input.dependencies?.probeHealth ?? requestHealth;
  const child = spawnChild(input);
  let ready;
  try {
    ready = await readReady(child);
    validateReady(ready);
    if ((await probeHealth(ready.healthUrl)) !== SERVICE_MARKER) {
      throw new Error("Crash recovery service health check failed");
    }
    const during = await snapshot({ dependencies: input.dependencies });
    assertResourceDelta(input.baseline, during);
    const cleanupStartedAt = Date.now();
    child.kill("SIGKILL");
    await waitForExit(child);
    await waitForCleanup(
      input.baseline,
      ready.healthUrl,
      snapshot,
      probeHealth,
      input.dependencies,
    );
    return {
      index: input.index,
      runtimeSignal: "SIGKILL",
      serviceReady: true,
      serviceIdentitySha256: ready.serviceIdentitySha256,
      endpointSha256: sha256(ready.healthUrl),
      containerDeltaCount: 1,
      networkDeltaCount: 1,
      scratchDeltaCount: 1,
      containerCleanupVerified: true,
      networkCleanupVerified: true,
      scratchCleanupVerified: true,
      endpointClosedVerified: true,
      exactBaselineRestored: true,
      cleanupDurationMs: Math.max(0, Date.now() - cleanupStartedAt),
    };
  } catch (error) {
    child.kill("SIGKILL");
    await waitForExit(child).catch(() => undefined);
    await waitForCleanup(
      input.baseline,
      ready?.healthUrl,
      snapshot,
      probeHealth,
      input.dependencies,
    ).catch(() => undefined);
    throw error;
  }
}

function spawnRuntimeChild(input) {
  return spawn(
    process.execPath,
    ["--input-type=module", "--eval", OCI_CRASH_RECOVERY_CHILD_SOURCE],
    {
      cwd: input.repoRoot,
      env: {
        ...dockerEnvironment(),
        LANG: "C",
        LC_ALL: "C",
        NO_COLOR: "1",
        NAPIER_CRASH_IMAGE_ID: input.imageId,
        NAPIER_CRASH_WORKSPACE: input.repoRoot,
        NAPIER_CONTAINER_SANDBOX_SCRATCH_DIR: scratchBaseDirectory(),
        NAPIER_RUNTIME_ENTRY: path.join(
          input.repoRoot,
          "packages/runtime/dist/index.js",
        ),
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
}

async function readReady(child) {
  const line = await readBoundedLine(child);
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error("Crash recovery child readiness is invalid");
  }
  validateReady(value);
  return value;
}

function validateReady(value) {
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join("\n") !==
      ["healthUrl", "serviceIdentitySha256"].sort().join("\n") ||
    typeof value.healthUrl !== "string" ||
    !SHA256.test(value.serviceIdentitySha256)
  ) {
    throw new Error("Crash recovery child readiness shape is invalid");
  }
  const url = new URL(value.healthUrl);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/__napier_crash_ready" ||
    !/^[1-9][0-9]{0,4}$/u.test(url.port)
  ) {
    throw new Error("Crash recovery loopback endpoint is invalid");
  }
}

async function snapshotResources(options = {}) {
  const docker = options.dependencies?.docker ?? runDocker;
  const [containerText, networkText, scratch] = await Promise.all([
    docker(["container", "ls", "--all", "--format", "{{.Names}}"]),
    docker(["network", "ls", "--format", "{{.Name}}"]),
    snapshotScratch(),
  ]);
  return {
    containers: sortedNames(containerText, CONTAINER_NAME),
    networks: sortedNames(networkText, NETWORK_NAME),
    scratch,
  };
}

async function snapshotScratch() {
  try {
    return (await readdir(scratchBaseDirectory()))
      .filter(
        (name) => SCRATCH_NAME.test(name) || SCRATCH_TOMBSTONE.test(name),
      )
      .sort();
  } catch {
    return [];
  }
}

function assertResourceDelta(baseline, current) {
  const counts = {
    containerAdds: additions(baseline.containers, current.containers).length,
    networkAdds: additions(baseline.networks, current.networks).length,
    scratchAdds: additions(baseline.scratch, current.scratch).length,
    containerRemovals: removals(
      baseline.containers,
      current.containers,
    ).length,
    networkRemovals: removals(baseline.networks, current.networks).length,
    scratchRemovals: removals(baseline.scratch, current.scratch).length,
  };
  if (Object.values(counts).join(",") !== "1,1,1,0,0,0") {
    throw new Error(
      `Crash recovery resource delta is not isolated (${Object.values(counts).join(",")})`,
    );
  }
}

async function waitForCleanup(
  baseline,
  healthUrl,
  snapshot,
  probeHealth,
  dependencies,
) {
  const deadline = Date.now() + CLEANUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const current = await snapshot({ dependencies });
    const closed =
      healthUrl === undefined ||
      (await probeHealth(healthUrl).then(
        () => false,
        () => true,
      ));
    if (canonicalJson(baseline) === canonicalJson(current) && closed) return;
    await delay(100);
  }
  throw new Error("Crash recovery did not restore the exact resource baseline");
}

async function requestHealth(urlValue) {
  const { get } = await import("node:http");
  return new Promise((resolve, reject) => {
    const request = get(urlValue, { timeout: 1_000 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
        if (body.length > 128) request.destroy();
      });
      response.on("end", () => {
        if (response.statusCode !== 200 || body !== SERVICE_MARKER) {
          reject(new Error("Crash recovery service returned an invalid body"));
          return;
        }
        resolve(body);
      });
    });
    request.once("timeout", () => request.destroy());
    request.once("error", reject);
  });
}

async function runDocker(args) {
  const result = await execFile("docker", args, {
    encoding: "utf8",
    env: dockerEnvironment(),
    timeout: 5_000,
    maxBuffer: MAX_DOCKER_OUTPUT_BYTES,
    windowsHide: true,
  });
  return result.stdout;
}

async function readBoundedLine(child) {
  let output = "";
  let errorOutput = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
    if (Buffer.byteLength(output, "utf8") > MAX_CHILD_OUTPUT_BYTES) {
      child.kill("SIGKILL");
    }
  });
  child.stderr.on("data", (chunk) => {
    errorOutput += chunk;
    if (Buffer.byteLength(errorOutput, "utf8") > MAX_CHILD_OUTPUT_BYTES) {
      child.kill("SIGKILL");
    }
  });
  const deadline = Date.now() + CHILD_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const newline = output.indexOf("\n");
    if (newline >= 0) {
      if (output.slice(newline + 1) !== "") {
        throw new Error("Crash recovery child emitted unexpected output");
      }
      return output.slice(0, newline);
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Crash recovery child exited before readiness (${hashDiagnostic(errorOutput)})`,
      );
    }
    await delay(25);
  }
  throw new Error("Crash recovery child readiness timed out");
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Crash recovery child did not exit")),
      5_000,
    );
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
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

function scratchBaseDirectory() {
  const configured =
    process.env["NAPIER_CONTAINER_SANDBOX_SCRATCH_DIR"]?.trim();
  return configured && path.isAbsolute(configured) ? configured : tmpdir();
}

function sortedNames(text, pattern) {
  return text
    .trim()
    .split("\n")
    .filter((name) => pattern.test(name))
    .sort();
}

function additions(before, after) {
  const existing = new Set(before);
  return after.filter((value) => !existing.has(value));
}

function removals(before, after) {
  return additions(after, before);
}

function hashDiagnostic(value) {
  return `${createHash("sha256").update(value).digest("hex").slice(0, 16)}:${Buffer.byteLength(value, "utf8")}`;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
