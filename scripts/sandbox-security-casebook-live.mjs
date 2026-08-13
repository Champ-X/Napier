import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { access, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  CommandRunner,
  OciContainerSandboxAdapter,
  canonicalJson,
  sha256,
} from "../packages/runtime/dist/index.js";
import { resolveContainerImageIdentity } from "../packages/runtime/dist/sandbox-container-runtime.js";

const CONTAINER_NAME = /^napier-[a-f0-9]{32}$/u;
const NETWORK_NAME = /^napier-network-[a-f0-9]{32}$/u;
const SCRATCH_NAME = /^napier-process-sandbox-[A-Za-z0-9]{6}$/u;
const SCRATCH_TOMBSTONE =
  /^napier-process-sandbox-[A-Za-z0-9]{6}\.[a-f0-9]{16}\.guardian-remove$/u;

export async function runSandboxSecurityCasebook(input) {
  const dependencies = input.dependencies ?? {};
  const snapshot = dependencies.snapshot ?? snapshotResources;
  const baseline = await snapshot();
  const sandbox =
    dependencies.sandbox ?? new OciContainerSandboxAdapter(input.imageId);
  const runner =
    dependencies.runner ??
    new CommandRunner({ workspaceRoot: input.repoRoot, sandbox });
  const privateRoot = await mkdtemp(
    path.join(tmpdir(), "napier-security-casebook-"),
  );
  const cases = [];
  try {
    cases.push(await workspaceWriteCase(input.repoRoot, runner));
    cases.push(await outsideReadCase(privateRoot, runner));
    cases.push(await secretInheritanceCase(runner));
    cases.push(await privateNetworkCase(runner));
    cases.push(await temporaryStorageCase(runner));
    cases.push(await processLimitCase(runner));
    cases.push(await memoryLimitCase(runner));
    cases.push(await wallTimeCase(runner));
    cases.push(await outputLimitCase(runner));
    cases.push(await cancellationCase(runner));
    cases.push(await identityDriftCase(input.repoRoot, input.imageId));
  } finally {
    await rm(privateRoot, { recursive: true, force: true });
  }
  const finalSnapshot = await snapshot();
  const delta = snapshotDelta(baseline, finalSnapshot);
  if (Object.values(delta).some((count) => count !== 0)) {
    throw new Error("Sandbox security Casebook did not restore resources");
  }
  return {
    cases,
    resourceClosure: {
      exactBaselineRestored: true,
      containerDeltaCount: 0,
      networkDeltaCount: 0,
      scratchDeltaCount: 0,
    },
  };
}

async function workspaceWriteCase(workspaceRoot, runner) {
  const name = `.napier-security-${randomBytes(8).toString("hex")}`;
  const target = path.join(workspaceRoot, name);
  const source = [
    'const fs=require("node:fs");',
    `try{fs.writeFileSync(${JSON.stringify(name)},"x");process.stdout.write("WRITTEN")}`,
    "catch(error){process.stdout.write(String(error.code))}",
  ].join("");
  const result = await runCommand(runner, "node", ["-e", source]);
  const absent = await access(target).then(
    () => false,
    () => true,
  );
  requireCase(result.stdout === "EROFS" && absent, "workspace_write_denied");
  return caseEvidence(
    "workspace_write_denied",
    "read_only_workspace_mount",
    result,
  );
}

async function outsideReadCase(privateRoot, runner) {
  const canary = randomBytes(32).toString("hex");
  const target = path.join(privateRoot, "outside.txt");
  await writeFile(target, canary);
  const source = [
    'const fs=require("node:fs");',
    `try{process.stdout.write(fs.readFileSync(${JSON.stringify(target)},"utf8"))}`,
    "catch(error){process.stdout.write(String(error.code))}",
  ].join("");
  const result = await runCommand(runner, "node", ["-e", source]);
  requireCase(
    result.stdout === "ENOENT" && !result.stdout.includes(canary),
    "outside_read_denied",
  );
  return caseEvidence(
    "outside_read_denied",
    "outside_path_not_mounted",
    result,
  );
}

async function secretInheritanceCase(runner) {
  const name = `NAPIER_PRIVATE_${randomBytes(8).toString("hex").toUpperCase()}`;
  const value = randomBytes(32).toString("hex");
  process.env[name] = value;
  try {
    const source = `process.stdout.write(process.env[${JSON.stringify(name)}]===undefined?"ABSENT":"LEAKED")`;
    const result = await runCommand(runner, "node", ["-e", source]);
    requireCase(
      result.stdout === "ABSENT" && !result.stdout.includes(value),
      "secret_inheritance_denied",
    );
    return caseEvidence(
      "secret_inheritance_denied",
      "fixed_secret_free_environment",
      result,
    );
  } finally {
    delete process.env[name];
  }
}

async function privateNetworkCase(runner) {
  const marker = randomBytes(32).toString("hex");
  const server = createServer((socket) => socket.end(marker));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    const source = [
      'const net=require("node:net");',
      `const socket=net.connect({host:"127.0.0.1",port:${String(address.port)}});`,
      "socket.setTimeout(1000);",
      'socket.on("connect",()=>{process.stdout.write("REACHED");socket.destroy()});',
      'socket.on("error",error=>process.stdout.write(String(error.code)));',
      'socket.on("timeout",()=>{process.stdout.write("TIMEOUT");socket.destroy()});',
    ].join("");
    const result = await runCommand(runner, "node", ["-e", source], 5_000);
    requireCase(
      result.stdout !== "REACHED" && !result.stdout.includes(marker),
      "private_network_denied",
    );
    return caseEvidence(
      "private_network_denied",
      "network_namespace_denied",
      result,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function temporaryStorageCase(runner) {
  const source = [
    'const fs=require("node:fs");',
    'const descriptor=fs.openSync("/tmp/fill","w");',
    "const chunk=Buffer.alloc(1024*1024);",
    'try{for(let index=0;index<80;index++)fs.writeSync(descriptor,chunk);process.stdout.write("WRITTEN")}',
    "catch(error){process.stdout.write(String(error.code))}",
    "finally{fs.closeSync(descriptor)}",
  ].join("");
  const result = await runCommand(runner, "node", ["-e", source], 15_000);
  requireCase(result.stdout === "ENOSPC", "temporary_storage_exhausted");
  return caseEvidence(
    "temporary_storage_exhausted",
    "tmpfs_size_limit",
    result,
  );
}

async function processLimitCase(runner) {
  const source = [
    'const {spawn}=require("node:child_process");',
    "(async()=>{",
    "const live=[];",
    "const results=await Promise.all(Array.from({length:400},()=>new Promise(resolve=>{",
    'const child=spawn("/bin/sleep",["10"],{stdio:"ignore"});',
    'child.once("spawn",()=>{live.push(child);resolve("spawned")});',
    'child.once("error",error=>resolve(String(error.code)));',
    "})));",
    'for(const child of live)try{child.kill("SIGKILL")}catch{}',
    "const counts={};for(const item of results)counts[item]=(counts[item]||0)+1;",
    "process.stdout.write(JSON.stringify(counts));",
    "})()",
  ].join("");
  const result = await runCommand(runner, "node", ["-e", source], 15_000);
  const counts = JSON.parse(result.stdout);
  requireCase(
    Number.isSafeInteger(counts.spawned) &&
      counts.spawned > 0 &&
      counts.spawned < 256 &&
      Number.isSafeInteger(counts.EAGAIN) &&
      counts.EAGAIN > 0 &&
      counts.spawned + counts.EAGAIN === 400,
    "process_limit_enforced",
  );
  return caseEvidence("process_limit_enforced", "pids_cgroup_limit", result, {
    observedCount: counts.spawned,
    rejectedCount: counts.EAGAIN,
  });
}

async function memoryLimitCase(runner) {
  const result = await runCommand(
    runner,
    "python",
    ["-I", "-B", "-S", "-c", "value=bytearray(1536*1024*1024)"],
    15_000,
  );
  requireCase(
    result.details.status === "failed" && result.details.exitCode === 137,
    "memory_limit_enforced",
  );
  return caseEvidence("memory_limit_enforced", "memory_cgroup_kill", result);
}

async function wallTimeCase(runner) {
  const result = await runCommand(
    runner,
    "node",
    ["-e", "setInterval(()=>{},1000)"],
    1_000,
  );
  requireCase(result.details.status === "timed_out", "wall_time_enforced");
  return caseEvidence("wall_time_enforced", "wall_time_limit", result);
}

async function outputLimitCase(runner) {
  const result = await runCommand(
    runner,
    "node",
    ["-e", 'process.stdout.write("x".repeat(40000))'],
    5_000,
  );
  requireCase(
    result.details.status === "output_capped" &&
      result.details.stdoutChars === 32_000 &&
      result.details.stdoutTruncated,
    "output_limit_enforced",
  );
  return caseEvidence(
    "output_limit_enforced",
    "output_character_limit",
    result,
  );
}

async function cancellationCase(runner) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300);
  try {
    await runner.run(
      {
        runtime: "node",
        args: ["-e", "setInterval(()=>{},1000)"],
        timeoutMs: 10_000,
      },
      controller.signal,
    );
    throw new Error("Sandbox cancellation was accepted as success");
  } catch (error) {
    requireCase(
      error instanceof Error &&
        error.message === "command execution was aborted",
      "cancellation_enforced",
    );
    const durationMs = Math.max(0, Date.now() - startedAt);
    return {
      id: "cancellation_enforced",
      status: "passed",
      reason: "abort_terminates_process",
      evidenceSha256: sha256(
        canonicalJson({ aborted: true, processGroupTermination: true }),
      ),
      durationMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function identityDriftCase(repoRoot, imageId) {
  const startedAt = Date.now();
  const identity = await resolveContainerImageIdentity(imageId);
  const sandbox = new OciContainerSandboxAdapter(imageId, {
    expectedIdentity: {
      clientExecutableSha256: identity.clientExecutableSha256,
      daemonEndpointSha256: identity.daemon.endpointSha256,
      userIdentitySha256: identity.user.identitySha256,
      identitySha256: "0".repeat(64),
    },
  });
  const runner = new CommandRunner({ workspaceRoot: repoRoot, sandbox });
  try {
    await runner.run({ runtime: "node", args: ["--version"] });
    throw new Error("Sandbox identity drift was accepted");
  } catch (error) {
    requireCase(
      error instanceof Error &&
        error.message === "Configured Sandbox runtime identity changed",
      "identity_drift_rejected",
    );
    return {
      id: "identity_drift_rejected",
      status: "passed",
      reason: "configured_identity_mismatch",
      evidenceSha256: sha256(
        canonicalJson({
          observedIdentitySha256: identity.identitySha256,
          expectedIdentitySha256: "0".repeat(64),
        }),
      ),
      durationMs: Math.max(0, Date.now() - startedAt),
    };
  }
}

async function runCommand(runner, runtime, args, timeoutMs = 10_000) {
  return runner.run({ runtime, args, timeoutMs });
}

function caseEvidence(id, reason, result, counts = {}) {
  return {
    id,
    status: "passed",
    reason,
    evidenceSha256: sha256(
      canonicalJson({
        status: result.details.status,
        exitCode: result.details.exitCode,
        signal: result.details.signal,
        resultSha256: result.details.resultSha256,
        resourceLimitsSha256: result.details.resourceLimitsSha256,
        stdoutSha256: result.details.stdoutSha256,
        stderrSha256: result.details.stderrSha256,
        stdoutTruncated: result.details.stdoutTruncated,
        stderrTruncated: result.details.stderrTruncated,
        ...counts,
      }),
    ),
    durationMs: result.details.durationMs,
    ...counts,
  };
}

async function snapshotResources() {
  const { execFile } = await import("node:child_process");
  const run = (args) =>
    new Promise((resolve, reject) =>
      execFile(
        "docker",
        args,
        {
          encoding: "utf8",
          env: dockerEnvironment(),
          timeout: 5_000,
          maxBuffer: 64 * 1024,
          windowsHide: true,
        },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      ),
    );
  const [containers, networks, scratch] = await Promise.all([
    run(["container", "ls", "--all", "--format", "{{.Names}}"]),
    run(["network", "ls", "--format", "{{.Name}}"]),
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

function snapshotDelta(before, after) {
  return {
    containerDeltaCount: symmetricDifference(
      before.containers,
      after.containers,
    ),
    networkDeltaCount: symmetricDifference(before.networks, after.networks),
    scratchDeltaCount: symmetricDifference(before.scratch, after.scratch),
  };
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

function requireCase(condition, id) {
  if (!condition) throw new Error(`Sandbox security case failed: ${id}`);
}
