import { execFile as execFileWithCallback } from "node:child_process";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { promisify } from "node:util";

import { runCli } from "../apps/cli/dist/cli.js";
import {
  VerificationRunner,
  canonicalJson,
  createLocalAgentRuntime,
  sha256,
} from "../packages/runtime/dist/index.js";
import { runSandboxFirstUseCodingAcceptance } from "./sandbox-first-use-coding-acceptance.mjs";
import { runSandboxImageRepairAcceptance } from "./sandbox-image-repair-acceptance.mjs";
import { runSandboxInvalidBindingRepairAcceptance } from "./sandbox-invalid-binding-repair-acceptance.mjs";

const execFile = promisify(execFileWithCallback);
const CONTAINER_NAME = /^napier-[a-f0-9]{32}$/u;
const NETWORK_NAME = /^napier-network-[a-f0-9]{32}$/u;
const SCRATCH_NAME = /^napier-process-sandbox-[A-Za-z0-9]{6}$/u;
const SCRATCH_TOMBSTONE =
  /^napier-process-sandbox-[A-Za-z0-9]{6}\.[a-f0-9]{16}\.guardian-remove$/u;
const SERVICE_PATH = "/__napier_acceptance_ready";
const SERVICE_MARKER = "napier_product_acceptance_ready";

export async function runSandboxProductAcceptance(input) {
  const baseline = await snapshotResources();
  const dataRoot = await mkdtemp(
    path.join(tmpdir(), "napier-product-acceptance-"),
  );
  let services;
  try {
    const setupPreview = await runJsonCli(
      [
        "setup",
        "--workspace",
        input.repoRoot,
        "--data-root",
        dataRoot,
        "--component",
        "sandbox",
        "--jsonl",
      ],
      input.repoRoot,
    );
    requireValue(
      setupPreview.code === 0 &&
        setupPreview.value.status === "ready" &&
        setupPreview.value.active === false,
      "Sandbox acceptance setup preview failed",
    );
    const setupApply = await runJsonCli(
      [
        "setup",
        "--workspace",
        input.repoRoot,
        "--data-root",
        dataRoot,
        "--component",
        "sandbox",
        "--expected-preview",
        setupPreview.value.contentSha256,
        "--apply",
        "--jsonl",
      ],
      input.repoRoot,
    );
    const checkCodes = Object.values(setupApply.value.checks ?? {});
    requireValue(
      setupApply.code === 0 &&
        setupApply.value.status === "ready" &&
        setupApply.value.action === "reused" &&
        checkCodes.length === 9,
      "Sandbox acceptance setup apply failed",
    );

    const doctor = await runJsonCli(
      [
        "doctor",
        "--workspace",
        input.repoRoot,
        "--data-root",
        dataRoot,
        "--model",
        "napier/demo",
        "--offline",
        "--jsonl",
      ],
      input.repoRoot,
    );
    const sandboxCheck = doctor.value.checks.find(
      (check) => check.id === "sandbox",
    );
    const verificationCheck = doctor.value.checks.find(
      (check) => check.id === "verification",
    );
    const browserUseLocalCheck = doctor.value.checks.find(
      (check) => check.id === "browser_use_local",
    );
    requireValue(
      doctor.code === 0 &&
        doctor.value.status === "degraded" &&
        doctor.value.checkCount === 15 &&
        doctor.value.passedCount === 11 &&
        doctor.value.warningCount === 1 &&
        doctor.value.skippedCount === 3 &&
        browserUseLocalCheck?.status === "warning" &&
        [
          "browser_use_local_missing",
          "browser_use_local_unsupported",
        ].includes(browserUseLocalCheck.code) &&
        sandboxCheck?.code === "sandbox_ready" &&
        verificationCheck?.code === "verification_ready",
      "Sandbox acceptance Doctor result is invalid",
    );

    services = await createLocalAgentRuntime({
      workspaceRoot: input.repoRoot,
      dataRoot,
    });
    requireValue(
      services.sandbox.id === "oci-container",
      "Sandbox acceptance did not activate OCI",
    );
    const runner = new VerificationRunner({
      workspaceRoot: input.repoRoot,
      sandbox: services.sandbox,
    });
    const typecheck = await runner.run({
      kind: "typecheck",
      target: "packages/contracts/tsconfig.json",
      timeoutMs: 120_000,
    });
    const test = await runner.run({
      kind: "test",
      target: "packages/contracts/test/agent-capability-contract.test.ts",
      timeoutMs: 120_000,
    });
    requireVerification(typecheck, "5.9.3");
    requireVerification(test, "4.1.9");

    const agent = services.store.listAgents()[0];
    const thread = await services.store.createThread({
      title: "Sandbox product acceptance",
      agentId: agent.id,
    });
    const run = await services.store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    const service = await services.workspaceProcesses.start({
      threadId: thread.id,
      runId: run.id,
      command: {
        runtime: "node",
        args: ["-e", serviceSource()],
        timeoutMs: 30_000,
      },
      localService: {
        protocol: "http",
        containerPort: 31_879,
        healthPath: SERVICE_PATH,
      },
    });
    const binding = service.localService;
    requireValue(
      service.status === "running" &&
        binding?.status === "ready" &&
        binding.host === "127.0.0.1",
      "Sandbox acceptance service did not become ready",
    );
    const healthUrl = new URL(SERVICE_PATH, binding.url).href;
    requireValue(
      (await requestHealth(healthUrl)) === SERVICE_MARKER,
      "Sandbox acceptance service health failed",
    );
    const cancelled = await services.workspaceProcesses.cancel(
      thread.id,
      service.id,
    );
    requireValue(
      cancelled.status === "cancelled" &&
        cancelled.localService?.status === "closed",
      "Sandbox acceptance service cancellation failed",
    );
    await waitForEndpointClosed(healthUrl);

    const hanging = await services.workspaceProcesses.start({
      threadId: thread.id,
      runId: run.id,
      command: {
        runtime: "node",
        args: ["-e", "setInterval(()=>{},1000)"],
        timeoutMs: 30_000,
      },
    });
    requireValue(
      hanging.status === "running",
      "Sandbox acceptance restart process did not start",
    );
    await services.shutdown();
    services = undefined;
    const reopened = await createLocalAgentRuntime({
      workspaceRoot: input.repoRoot,
      dataRoot,
    });
    let restarted;
    let staleOutput;
    try {
      restarted = (await reopened.workspaceProcesses.list(thread.id)).find(
        (candidate) => candidate.id === hanging.id,
      );
      staleOutput = await reopened.workspaceProcesses.output(
        thread.id,
        hanging.id,
      );
    } finally {
      await reopened.shutdown();
    }
    requireValue(
      restarted?.status === "interrupted" &&
        typeof restarted.interruptionReason === "string" &&
        restarted.interruptionReason.length > 0 &&
        staleOutput.status === "interrupted" &&
        staleOutput.outputAvailable === false &&
        staleOutput.chunks.length === 0,
      "Sandbox acceptance restart reconciliation failed",
    );

    const uninstallPreview = await runJsonCli(
      [
        "setup",
        "--workspace",
        input.repoRoot,
        "--data-root",
        dataRoot,
        "--component",
        "sandbox",
        "--uninstall",
        "--jsonl",
      ],
      input.repoRoot,
    );
    requireValue(
      uninstallPreview.code === 0 &&
        uninstallPreview.value.status === "installed" &&
        uninstallPreview.value.active === true,
      "Sandbox acceptance uninstall preview failed",
    );
    const uninstall = await runJsonCli(
      [
        "setup",
        "--workspace",
        input.repoRoot,
        "--data-root",
        dataRoot,
        "--component",
        "sandbox",
        "--uninstall",
        "--expected-preview",
        uninstallPreview.value.contentSha256,
        "--apply",
        "--jsonl",
      ],
      input.repoRoot,
    );
    const bindingRemoved = await access(
      path.join(dataRoot, "sandbox.json"),
    ).then(
      () => false,
      () => true,
    );
    requireValue(
      uninstall.code === 0 &&
        uninstall.value.status === "removed" &&
        uninstall.value.imageRetained === true &&
        bindingRemoved,
      "Sandbox acceptance uninstall apply failed",
    );

    const firstUse = await runSandboxFirstUseCodingAcceptance({
      repoRoot: input.repoRoot,
    });
    const invalidBindingRepair = await runSandboxInvalidBindingRepairAcceptance(
      {
        repoRoot: input.repoRoot,
      },
    );
    const imageRepair = await runSandboxImageRepairAcceptance({
      repoRoot: input.repoRoot,
    });
    const finalSnapshot = await snapshotResources();
    const resourceClosure = resourceDelta(baseline, finalSnapshot);
    requireValue(
      Object.values(resourceClosure).every((value) => value === 0),
      "Sandbox acceptance did not restore resource baseline",
    );
    return {
      setup: {
        previewStatus: setupPreview.value.status,
        previewActive: setupPreview.value.active,
        previewSha256: setupPreview.value.contentSha256,
        applyAction: setupApply.value.action,
        status: setupApply.value.status,
        checkCount: checkCodes.length,
        checkCodes,
        installationSha256: setupApply.value.installationSha256,
        resultSha256: setupApply.value.contentSha256,
      },
      doctor: {
        status: doctor.value.status,
        checkCount: doctor.value.checkCount,
        passedCount: doctor.value.passedCount,
        warningCount: doctor.value.warningCount,
        skippedCount: doctor.value.skippedCount,
        browserUseLocalCode: browserUseLocalCheck.code,
        sandboxCode: sandboxCheck.code,
        verificationCode: verificationCheck.code,
        reportSha256: doctor.value.contentSha256,
      },
      verification: {
        sandbox: typecheck.details.sandbox,
        typecheck: verificationEvidence(typecheck),
        test: verificationEvidence(test),
      },
      service: {
        ready: true,
        healthChecked: true,
        cancelled: true,
        endpointClosed: true,
        identitySha256: binding.identitySha256,
        endpointSha256: sha256(healthUrl),
      },
      restart: {
        preRestartStatus: hanging.status,
        reopenedStatus: restarted.status,
        unknownOutcome: true,
        staleOutputExposed: false,
        processSha256: sha256(hanging.id),
      },
      uninstall: {
        previewStatus: uninstallPreview.value.status,
        active: uninstallPreview.value.active,
        previewSha256: uninstallPreview.value.contentSha256,
        status: uninstall.value.status,
        imageRetained: uninstall.value.imageRetained,
        bindingRemoved,
        resultSha256: uninstall.value.contentSha256,
      },
      firstUse,
      invalidBindingRepair,
      imageRepair,
      resourceClosure: {
        exactBaselineRestored: true,
        ...resourceClosure,
      },
    };
  } finally {
    await services?.shutdown().catch(() => undefined);
    await rm(dataRoot, { recursive: true, force: true });
  }
}

async function runJsonCli(args, cwd) {
  const stdout = new CaptureWritable();
  const stderr = new CaptureWritable();
  const code = await runCli(args, {
    cwd,
    env: process.env,
    stdout,
    stderr,
  });
  if (stderr.text !== "") {
    throw new Error(`Sandbox acceptance CLI failed (${sha256(stderr.text)})`);
  }
  const lines = stdout.text.trim().split("\n").filter(Boolean);
  if (lines.length !== 1) {
    throw new Error("Sandbox acceptance CLI emitted invalid JSONL");
  }
  return { code, value: JSON.parse(lines[0]) };
}

class CaptureWritable extends Writable {
  text = "";

  _write(chunk, _encoding, callback) {
    this.text += chunk.toString();
    callback();
  }
}

function requireVerification(result, version) {
  requireValue(
    result.details.status === "passed" &&
      result.details.sandbox === "oci-container" &&
      result.details.verifierVersion === version &&
      /^[a-f0-9]{64}$/u.test(result.details.runtimeIdentitySha256 ?? ""),
    "Sandbox acceptance verification failed",
  );
}

function verificationEvidence(result) {
  return {
    status: result.details.status,
    verifierVersion: result.details.verifierVersion,
    verifierSha256: result.details.verifierSha256,
    runtimeIdentitySha256: result.details.runtimeIdentitySha256,
    resultSha256: result.details.resultSha256,
  };
}

function serviceSource() {
  return [
    'const http=require("node:http");',
    "http.createServer((request,response)=>{",
    `response.statusCode=request.url===${JSON.stringify(SERVICE_PATH)}?200:404;`,
    `response.end(${JSON.stringify(SERVICE_MARKER)});`,
    '}).listen(31879,"0.0.0.0");',
  ].join("");
}

async function requestHealth(urlValue) {
  return new Promise((resolve, reject) => {
    const request = get(urlValue, { timeout: 1_000 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
        if (body.length > 128) request.destroy();
      });
      response.on("end", () => {
        if (response.statusCode !== 200) {
          reject(new Error("Sandbox acceptance service status is invalid"));
          return;
        }
        resolve(body);
      });
    });
    request.once("timeout", () => request.destroy());
    request.once("error", reject);
  });
}

async function waitForEndpointClosed(urlValue) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const closed = await requestHealth(urlValue).then(
      () => false,
      () => true,
    );
    if (closed) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Sandbox acceptance endpoint remained open");
}

async function snapshotResources() {
  const run = async (args) =>
    (
      await execFile("docker", args, {
        encoding: "utf8",
        timeout: 5_000,
        maxBuffer: 64 * 1024,
        windowsHide: true,
      })
    ).stdout;
  const [containers, networks, scratch] = await Promise.all([
    run(["container", "ls", "--all", "--format", "{{.Names}}"]),
    run(["network", "ls", "--format", "{{.Name}}"]),
    readdir(tmpdir()).catch(() => []),
  ]);
  return {
    containers: names(containers, /^napier-[a-f0-9]{32}$/u),
    networks: names(networks, /^napier-network-[a-f0-9]{32}$/u),
    scratch: scratch
      .filter(
        (name) =>
          /^napier-process-sandbox-[A-Za-z0-9]{6}$/u.test(name) ||
          /^napier-process-sandbox-[A-Za-z0-9]{6}\.[a-f0-9]{16}\.guardian-remove$/u.test(
            name,
          ),
      )
      .sort(),
  };
}

function resourceDelta(before, after) {
  return {
    containerDeltaCount: difference(before.containers, after.containers),
    networkDeltaCount: difference(before.networks, after.networks),
    scratchDeltaCount: difference(before.scratch, after.scratch),
  };
}

function difference(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    left.filter((value) => !rightSet.has(value)).length +
    right.filter((value) => !leftSet.has(value)).length
  );
}

function names(text, pattern) {
  return text
    .trim()
    .split("\n")
    .filter((name) => pattern.test(name))
    .sort();
}

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}
