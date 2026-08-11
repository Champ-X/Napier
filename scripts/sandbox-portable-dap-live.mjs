import { execFile as execFileWithCallback } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  LocalStore,
  NodeDebuggerManager,
  OciContainerSandboxAdapter,
  WorkspaceProcessManager,
  canonicalJson,
  sha256,
} from "../packages/runtime/dist/index.js";
import { createNodeDebuggerProtocolSourceBinding } from "../packages/runtime/dist/node-debugger-protocol-path-binding.js";
import { PORTABLE_CONTAINER_USER_IDS } from "../packages/runtime/dist/sandbox-container-runtime.js";

const execFile = promisify(execFileWithCallback);
const CONTAINER_NAME = /^napier-[a-f0-9]{32}$/u;
const NETWORK_NAME = /^napier-network-[a-f0-9]{32}$/u;
const SCRATCH_NAME = /^napier-process-sandbox-[A-Za-z0-9]{6}$/u;
const SCRATCH_TOMBSTONE =
  /^napier-process-sandbox-[A-Za-z0-9]{6}\.[a-f0-9]{16}\.guardian-remove$/u;

export async function runSandboxPortableDapAcceptance(input) {
  const snapshot = input.dependencies?.snapshot ?? snapshotResources;
  const baseline = await snapshot();
  const temporaryRoot = await mkdtemp(
    path.join(homedir(), ".napier-portable-dap-"),
  );
  let result;
  let failure;
  try {
    const workspaceRoot = path.join(temporaryRoot, "workspace");
    await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, "src/target.mjs"),
      debugSource(),
      "utf8",
    );
    const protocolBinding = controlledProtocolBinding(workspaceRoot);
    const host = await runArm(
      workspaceRoot,
      path.join(temporaryRoot, "host-data"),
      input.imageId,
    );
    const portable = await runArm(
      workspaceRoot,
      path.join(temporaryRoot, "portable-data"),
      input.imageId,
      PORTABLE_CONTAINER_USER_IDS,
    );
    result = {
      protocolBinding,
      productionParity: parityEvidence(host, portable),
    };
  } catch (error) {
    failure = error;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true }).catch((error) => {
      failure ??= error;
    });
  }
  const [finalSnapshot, temporaryRootRemoved] = await Promise.all([
    snapshot(),
    access(temporaryRoot).then(
      () => false,
      () => true,
    ),
  ]);
  const delta = resourceDelta(baseline, finalSnapshot);
  if (
    Object.values(delta).some((count) => count !== 0) ||
    !temporaryRootRemoved
  ) {
    failure ??= new Error("Sandbox portable DAP did not restore resources");
  }
  if (failure) throw failure;
  return {
    ...result,
    resourceClosure: {
      exactBaselineRestored: true,
      ...delta,
      temporaryRootRemoved,
    },
  };
}

async function runArm(workspaceRoot, dataRoot, imageId, userIds) {
  await mkdir(dataRoot, { recursive: true });
  const store = new LocalStore({ workspaceRoot, dataRoot });
  await store.initialize();
  const sandbox = new OciContainerSandboxAdapter(imageId, {
    ...(userIds ? { userIds } : {}),
  });
  const processes = new WorkspaceProcessManager({
    store,
    workspaceRoot,
    sandbox,
  });
  await processes.initialize();
  const manager = new NodeDebuggerManager(processes, workspaceRoot);
  const thread = store.listThreads()[0];
  const run = store.listRuns(thread.id)[0];
  try {
    const launched = await manager.launch({
      threadId: thread.id,
      runId: run.id,
      path: "src/target.mjs",
      breakpoints: [{ line: 2 }],
      actionTimeoutMs: 5_000,
      sessionTimeoutMs: 20_000,
    });
    const evaluated = await manager.evaluate({
      threadId: thread.id,
      runId: run.id,
      processId: launched.processId,
      frameId: launched.frames[0].id,
      expression: "input",
    });
    const completed = await manager.resume({
      threadId: thread.id,
      runId: run.id,
      processId: launched.processId,
      action: "continue",
    });
    return {
      launch: {
        state: launched.state,
        reason: launched.reason,
        frames: launched.frames.map((frame) => ({
          pathSha256: sha256(frame.path ?? ""),
          line: frame.line,
          column: frame.column,
        })),
        resultSha256: launched.resultSha256,
      },
      evaluation: {
        status: evaluated.evaluation?.status,
        resultSha256: sha256(evaluated.evaluation?.result ?? ""),
        type: evaluated.evaluation?.type,
        variablesReference: evaluated.evaluation?.variablesReference,
        actionResultSha256: evaluated.resultSha256,
      },
      completion: {
        state: completed.state,
        exitCode: completed.exitCode,
        resultSha256: completed.resultSha256,
      },
    };
  } finally {
    await processes.shutdown();
    store.close();
  }
}

function parityEvidence(host, portable) {
  const expectedSourcePathSha256 = sha256("src/target.mjs");
  const breakpointExpected =
    host.launch.frames[0]?.pathSha256 === expectedSourcePathSha256 &&
    host.launch.frames[0]?.line === 2;
  const evaluationExpected =
    host.evaluation.status === "ok" &&
    host.evaluation.resultSha256 === sha256("20") &&
    host.evaluation.type === "number";
  const completionExpected =
    host.completion.state === "terminated" && host.completion.exitCode === 0;
  const frameProjectionSha256 = sha256(canonicalJson(host.launch.frames));
  const evaluationProjectionSha256 = sha256(
    canonicalJson({
      status: host.evaluation.status,
      resultSha256: host.evaluation.resultSha256,
      type: host.evaluation.type,
      variablesReference: host.evaluation.variablesReference,
    }),
  );
  const completionProjectionSha256 = sha256(
    canonicalJson({
      state: host.completion.state,
      exitCode: host.completion.exitCode,
    }),
  );
  const portableFrameSha256 = sha256(canonicalJson(portable.launch.frames));
  const portableEvaluationSha256 = sha256(
    canonicalJson({
      status: portable.evaluation.status,
      resultSha256: portable.evaluation.resultSha256,
      type: portable.evaluation.type,
      variablesReference: portable.evaluation.variablesReference,
    }),
  );
  const portableCompletionSha256 = sha256(
    canonicalJson({
      state: portable.completion.state,
      exitCode: portable.completion.exitCode,
    }),
  );
  const content = {
    hostPlatform: process.platform,
    sandbox: "oci-container",
    sameTarget: true,
    launchState: host.launch.state,
    pauseReason: host.launch.reason,
    breakpointExpected,
    evaluationExpected,
    completionExpected,
    frameProjectionEqual: frameProjectionSha256 === portableFrameSha256,
    evaluationProjectionEqual:
      evaluationProjectionSha256 === portableEvaluationSha256,
    completionProjectionEqual:
      completionProjectionSha256 === portableCompletionSha256,
    allEqual:
      frameProjectionSha256 === portableFrameSha256 &&
      evaluationProjectionSha256 === portableEvaluationSha256 &&
      completionProjectionSha256 === portableCompletionSha256,
    frameProjectionSha256,
    evaluationProjectionSha256,
    completionProjectionSha256,
    hostResultSetSha256: sha256(
      canonicalJson([
        host.launch.resultSha256,
        host.evaluation.actionResultSha256,
        host.completion.resultSha256,
      ]),
    ),
    portableResultSetSha256: sha256(
      canonicalJson([
        portable.launch.resultSha256,
        portable.evaluation.actionResultSha256,
        portable.completion.resultSha256,
      ]),
    ),
  };
  if (
    content.launchState !== "paused" ||
    content.pauseReason !== "breakpoint" ||
    !content.breakpointExpected ||
    !content.evaluationExpected ||
    !content.completionExpected ||
    !content.allEqual
  ) {
    throw new Error("Sandbox portable DAP parity failed");
  }
  return {
    ...content,
    evidenceSha256: sha256(canonicalJson(content)),
  };
}

function controlledProtocolBinding(workspaceRoot) {
  const source = {
    workspaceRoot,
    target: path.join(workspaceRoot, "src/target.mjs"),
    path: "src/target.mjs",
  };
  const portable = createNodeDebuggerProtocolSourceBinding(
    { source, program: source },
    "/workspace",
  );
  let escapeRejected = false;
  try {
    createNodeDebuggerProtocolSourceBinding(
      {
        source: {
          ...source,
          target: path.resolve(workspaceRoot, "../outside.mjs"),
        },
        program: source,
      },
      "/workspace",
    );
  } catch {
    escapeRejected = true;
  }
  const content = {
    protocolWorkspaceRoot: "/workspace",
    workspaceRootMapped: portable.workspaceRoot === "/workspace",
    sourceTargetMapped: portable.sourceTarget === "/workspace/src/target.mjs",
    programTargetMapped: portable.programTarget === "/workspace/src/target.mjs",
    relativeEvidencePaths: source.path === "src/target.mjs",
    escapeRejected,
  };
  if (
    Object.entries(content).some(([name, value]) =>
      name === "protocolWorkspaceRoot"
        ? value !== "/workspace"
        : value !== true,
    )
  ) {
    throw new Error("Sandbox portable DAP protocol binding failed");
  }
  return {
    ...content,
    bindingSha256: sha256(canonicalJson(content)),
  };
}

function debugSource() {
  return [
    "function calculate(input) {",
    "  const doubled = input * 2;",
    "  return doubled + 1;",
    "}",
    "globalThis.DEBUG_RESULT = calculate(20);",
  ].join("\n");
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
