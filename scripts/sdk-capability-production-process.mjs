import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { connect } from "node:net";
import path from "node:path";

import { createNapierManagementClient } from "../packages/sdk/dist/management.js";

const EXAMPLE_ENTRY = path.resolve(
  "packages/sdk/examples/effective-capabilities.mjs",
);
export const MAX_CHILD_OUTPUT_BYTES = 64 * 1024;
export const CHILD_EXIT_TIMEOUT_MS = 10_000;
const EXAMPLE_TIMEOUT_MS = 10_000;

export function observeServer(child) {
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let totalOutputBytes = 0;
  let stdoutText = "";
  let outputError;
  let settleOrigin;
  let rejectOrigin;
  const origin = new Promise((resolve, reject) => {
    settleOrigin = resolve;
    rejectOrigin = reject;
  });
  const exit = waitForExit(child);
  const close = waitForClose(child);
  child.once("error", rejectOrigin);
  child.stdout.on("data", (chunk) => {
    stdoutBytes += chunk.byteLength;
    totalOutputBytes += chunk.byteLength;
    if (totalOutputBytes > MAX_CHILD_OUTPUT_BYTES) {
      outputError ??= new Error(
        "Production server output exceeded its total bound",
      );
      rejectOrigin(outputError);
      return;
    }
    stdoutText += chunk.toString("utf8");
    const match = stdoutText.match(
      /(?:^|\n)Napier is listening on (http:\/\/127\.0\.0\.1:[1-9][0-9]*)(?:\n|$)/u,
    );
    if (match) settleOrigin(match[1]);
  });
  child.stderr.on("data", (chunk) => {
    stderrBytes += chunk.byteLength;
    totalOutputBytes += chunk.byteLength;
    if (totalOutputBytes > MAX_CHILD_OUTPUT_BYTES) {
      outputError ??= new Error(
        "Production server output exceeded its total bound",
      );
      rejectOrigin(outputError);
    }
  });
  void exit.then(
    ({ code, signal }) => {
      if (!stdoutText.includes("Napier is listening on")) {
        rejectOrigin(
          new Error(
            `Production server exited before readiness (${String(code)}/${String(signal)})`,
          ),
        );
      }
    },
    () => undefined,
  );
  return {
    origin,
    exit,
    close,
    assertOutputBounded: () => {
      if (outputError) throw outputError;
      assert.ok(totalOutputBytes <= MAX_CHILD_OUTPUT_BYTES);
    },
    stdoutBytes: () => stdoutBytes,
    stderrBytes: () => stderrBytes,
    totalOutputBytes: () => totalOutputBytes,
  };
}

export async function settleServerLifecycle(input) {
  const errors = [];
  const exitBarrier = observedPromise(input.observed.exit);
  const closeBarrier = observedPromise(input.observed.close);
  let exit;
  let closed;
  try {
    await (input.terminate ?? terminateServer)(
      input.child,
      input.childReceipt,
      input.observed.exit,
    );
  } catch (error) {
    errors.push(error);
  }
  const exitOutcome = await boundedOutcome(
    exitBarrier,
    input.timeoutMs ?? CHILD_EXIT_TIMEOUT_MS,
    "Production server exit barrier timed out",
  );
  if (exitOutcome.ok) exit = exitOutcome.value;
  else errors.push(exitOutcome.error);
  const closeOutcome = await boundedOutcome(
    closeBarrier,
    input.timeoutMs ?? CHILD_EXIT_TIMEOUT_MS,
    "Production server stdio did not close after exit",
  );
  if (closeOutcome.ok) {
    closed = closeOutcome.value;
    try {
      input.observed.assertOutputBounded();
      input.childReceipt.stdoutBytes = input.observed.stdoutBytes();
      input.childReceipt.stderrBytes = input.observed.stderrBytes();
      input.childReceipt.totalOutputBytes = input.observed.totalOutputBytes();
      input.childReceipt.outputBounded = true;
    } catch (error) {
      errors.push(error);
    }
  } else {
    errors.push(closeOutcome.error);
  }
  if (exit && closed) {
    try {
      assert.deepEqual(closed, exit);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) throw combinedError(errors, "Server lifecycle failed");
  assert.deepEqual(exit, { code: 0, signal: null });
  input.childReceipt.gracefulZeroExit = true;
}

export async function finalizeServerAndRoot(input) {
  const errors = [];
  if (input.child && input.observed) {
    try {
      await (input.settleLifecycle ?? settleServerLifecycle)({
        child: input.child,
        childReceipt: input.receipt.child,
        observed: input.observed,
        ...(input.terminate ? { terminate: input.terminate } : {}),
        ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
      });
    } catch (error) {
      errors.push(error);
    }
  }
  if (input.origin) {
    try {
      await (input.checkClosedPort ?? assertClosedPort)(input.origin);
      input.receipt.portClosed = true;
    } catch (error) {
      errors.push(error);
    }
    try {
      await (input.checkPostExitFailure ?? assertPostExitFailure)(input.origin);
      input.receipt.postExitSdkRequestFailed = true;
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    await input.cleanupRoot();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0) {
    throw combinedError(errors, "Server finalization failed");
  }
}

export async function runExample(origin, childTempRoot) {
  const child = spawn(
    process.execPath,
    [EXAMPLE_ENTRY, origin, "agent_napier"],
    {
      cwd: process.cwd(),
      env: { LANG: "C", TMPDIR: childTempRoot, TZ: "UTC" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = Buffer.alloc(0);
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let totalOutputBytes = 0;
  let outputExceeded = false;
  let forcedCleanup = false;
  const exitPromise = waitForExit(child);
  const closePromise = waitForClose(child);
  child.stdout.on("data", (chunk) => {
    stdoutBytes += chunk.byteLength;
    totalOutputBytes += chunk.byteLength;
    if (totalOutputBytes <= MAX_CHILD_OUTPUT_BYTES) {
      stdout = Buffer.concat([stdout, Buffer.from(chunk)]);
    } else {
      outputExceeded = true;
      child.kill("SIGTERM");
    }
  });
  child.stderr.on("data", (chunk) => {
    stderrBytes += chunk.byteLength;
    totalOutputBytes += chunk.byteLength;
    if (totalOutputBytes > MAX_CHILD_OUTPUT_BYTES) {
      outputExceeded = true;
      child.kill("SIGTERM");
    }
  });
  let operationError;
  let cleanupError;
  let exit;
  try {
    exit = await withTimeout(
      exitPromise,
      EXAMPLE_TIMEOUT_MS,
      "SDK example timed out",
    );
  } catch (error) {
    operationError = error;
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      try {
        await withTimeout(
          exitPromise,
          CHILD_EXIT_TIMEOUT_MS,
          "SDK example did not exit after SIGTERM",
        );
      } catch {
        forcedCleanup = true;
        child.kill("SIGKILL");
        try {
          await withTimeout(
            exitPromise,
            CHILD_EXIT_TIMEOUT_MS,
            "SDK example did not exit after SIGKILL",
          );
        } catch (error) {
          cleanupError = error;
        }
      }
    }
    try {
      const closed = await withTimeout(
        closePromise,
        CHILD_EXIT_TIMEOUT_MS,
        "SDK example stdio did not close after exit",
      );
      if (exit) assert.deepEqual(closed, exit);
    } catch (error) {
      cleanupError = cleanupError
        ? new AggregateError(
            [cleanupError, error],
            "SDK example cleanup failed",
          )
        : error;
    }
  }
  if (operationError && cleanupError) {
    throw new AggregateError(
      [operationError, cleanupError],
      "SDK example operation and cleanup both failed",
    );
  }
  if (operationError) throw operationError;
  if (cleanupError) throw cleanupError;
  assert.equal(forcedCleanup, false);
  assert.equal(outputExceeded, false);
  assert.ok(totalOutputBytes <= MAX_CHILD_OUTPUT_BYTES);
  assert.deepEqual(exit, { code: 0, signal: null });
  assert.equal(stderrBytes, 0);
  return {
    result: JSON.parse(stdout.toString("utf8")),
    process: {
      timeoutBounded: true,
      outputBounded: true,
      gracefulZeroExit: true,
      forcedCleanup,
      stdoutBytes,
      stderrBytes,
      totalOutputBytes,
      maximumOutputBytes: MAX_CHILD_OUTPUT_BYTES,
    },
  };
}

export async function terminateServer(child, childReceipt, exitPromise) {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
  }
  try {
    return await withTimeout(
      exitPromise,
      CHILD_EXIT_TIMEOUT_MS,
      "Production server did not exit after SIGTERM",
    );
  } catch (error) {
    childReceipt.forcedCleanup = true;
    child.kill("SIGKILL");
    await withTimeout(
      exitPromise,
      CHILD_EXIT_TIMEOUT_MS,
      "Production server did not exit after SIGKILL",
    );
    throw error;
  }
}

export async function assertPostExitFailure(origin) {
  const client = createNapierManagementClient({
    baseUrl: origin,
    requestTimeoutMs: 500,
  });
  await assert.rejects(
    client.getEffectiveAgentCapabilities({ agentId: "agent_napier" }),
    (error) =>
      error?.data?.kind === "transport" &&
      error.data.reason === "network_failure",
  );
}

export async function assertClosedPort(origin) {
  const parsed = new URL(origin);
  await new Promise((resolve, reject) => {
    const socket = connect({
      host: parsed.hostname,
      port: Number(parsed.port),
    });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("Loopback port closure check timed out"));
    }, 500);
    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.destroy();
      reject(new Error("Production server loopback port remains open"));
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      socket.destroy();
      if (error && error.code === "ECONNREFUSED") resolve();
      else reject(error);
    });
  });
}

export async function withTimeout(promise, timeoutMs, message) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function observedPromise(promise) {
  return promise.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  );
}

async function boundedOutcome(promise, timeoutMs, message) {
  try {
    return await withTimeout(promise, timeoutMs, message);
  } catch (error) {
    return { ok: false, error };
  }
}

function combinedError(errors, message) {
  return errors.length === 1 ? errors[0] : new AggregateError(errors, message);
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function waitForClose(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}
