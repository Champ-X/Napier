import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";

import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
} from "@earendil-works/pi-ai";

import { createHarnessLedgerRunEvidence } from "../packages/runtime/dist/agent-harness-acceptance.js";
import { LocalStore } from "../packages/runtime/dist/store.js";

export async function createEvidenceStore(root, label) {
  const workspaceRoot = path.join(root, label, "workspace");
  const dataRoot = path.join(root, label, "data");
  await mkdir(workspaceRoot, { recursive: true });
  const store = new LocalStore({ workspaceRoot, dataRoot });
  await store.initialize();
  return { store, workspaceRoot, dataRoot };
}

export async function reopenEvidenceStore(input) {
  await input.store.shutdown();
  const store = new LocalStore({
    workspaceRoot: input.workspaceRoot,
    dataRoot: input.dataRoot,
  });
  await store.initialize();
  return { ...input, store };
}

export async function ledgerRun(store, threadId, runId, eventTypes) {
  const run = store.listRuns(threadId).find((item) => item.id === runId);
  if (!run)
    throw new Error(`Evidence Run is unavailable after restart: ${runId}`);
  const selected = (await store.listEvents(threadId)).filter(
    (event) => event.runId === runId && eventTypes.has(event.type),
  );
  return createHarnessLedgerRunEvidence(run, selected);
}

export function addLedgerRun(collection, run) {
  if (!collection.some((item) => item.contentSha256 === run.contentSha256)) {
    collection.push(run);
  }
  return run.contentSha256;
}

export function terminalStream(model, stopReason, text) {
  const stream = createAssistantMessageEventStream();
  const message = modelMessage(model, stopReason === "stop" ? text : "", {
    stopReason,
    ...(stopReason === "error" ? { errorMessage: text } : {}),
  });
  stream.push({ type: "start", partial: message });
  stream.push(
    stopReason === "stop"
      ? { type: "done", reason: "stop", message }
      : { type: "error", reason: "error", error: message },
  );
  return stream;
}

export function visibleFailureStream(model, diagnostic) {
  const stream = createAssistantMessageEventStream();
  const partial = modelMessage(model, "partial");
  const failure = modelMessage(model, "", {
    stopReason: "error",
    errorMessage: diagnostic,
  });
  stream.push({ type: "start", partial });
  stream.push({ type: "text_start", contentIndex: 0, partial });
  stream.push({
    type: "text_delta",
    contentIndex: 0,
    delta: "partial",
    partial,
  });
  stream.push({ type: "error", reason: "error", error: failure });
  return stream;
}

export async function collectStream(stream) {
  for await (const _event of stream) {
    // Draining the real stream drives the route state machine.
  }
  return stream.result();
}

export function readinessSandbox(id = "agent-harness-acceptance") {
  return {
    id,
    async launch(request) {
      if (
        !request.args.some((argument) =>
          argument.includes("napier_shell_probe_v1"),
        )
      ) {
        throw new Error(
          "Acceptance sandbox cannot launch non-readiness commands",
        );
      }
      return settledProcess("napier_shell_probe_v1");
    },
  };
}

export function directSandbox(id = "agent-harness-code-bridge") {
  return {
    id,
    async launch(request) {
      const child = spawn(request.command, request.args, {
        cwd: request.cwd,
        env: { ...request.env },
        detached: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const exit = new Promise((resolve) =>
        child.once("exit", (code, signal) => resolve({ code, signal })),
      );
      return {
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        exit,
        async terminate() {
          if (child.exitCode === null && child.signalCode === null) {
            try {
              process.kill(-child.pid, "SIGTERM");
            } catch {
              child.kill("SIGTERM");
            }
          }
          await exit;
        },
      };
    },
  };
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function modelMessage(model, text, options = {}) {
  return {
    ...fauxAssistantMessage(text, options),
    api: model.api,
    provider: model.provider,
    model: model.id,
  };
}

function settledProcess(stdoutText) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  queueMicrotask(() => {
    stdout.end(stdoutText);
    stderr.end();
  });
  return {
    stdin,
    stdout,
    stderr,
    exit: Promise.resolve({ code: 0, signal: null }),
    terminate: async () => undefined,
  };
}
