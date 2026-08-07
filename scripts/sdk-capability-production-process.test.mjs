import { setImmediate as waitForImmediate } from "node:timers/promises";

import { describe, expect, test } from "vitest";

import {
  finalizeServerAndRoot,
  settleServerLifecycle,
} from "./sdk-capability-production-process.mjs";

const ZERO_EXIT = { code: 0, signal: null };

describe("production SDK process finalization", () => {
  test("consumes exit rejection while still awaiting close", async () => {
    const unhandled = [];
    const onUnhandled = (error) => unhandled.push(error);
    process.on("unhandledRejection", onUnhandled);
    try {
      await expect(
        settleServerLifecycle({
          child: {},
          childReceipt: childReceipt(),
          observed: observation({
            exit: Promise.reject(new Error("exit failed")),
            close: Promise.resolve(ZERO_EXIT),
          }),
          terminate: async () => undefined,
          timeoutMs: 100,
        }),
      ).rejects.toThrow("exit failed");
      await waitForImmediate();
      expect(unhandled).toEqual([]);
    } finally {
      process.removeListener("unhandledRejection", onUnhandled);
    }
  });

  test("awaits late close bytes before port checks and root cleanup", async () => {
    const events = [];
    const receipt = traceReceipt();
    const bytes = { stdout: 1, stderr: 2 };
    let resolveClose;
    const close = new Promise((resolve) => {
      resolveClose = resolve;
    });
    await expect(
      finalizeServerAndRoot({
        child: {},
        observed: observation({
          exit: Promise.resolve(ZERO_EXIT),
          close,
          bytes,
          onAccount: () => events.push("account"),
        }),
        origin: "http://127.0.0.1:1",
        receipt,
        terminate: async () => {
          events.push("terminate");
          setTimeout(() => {
            bytes.stdout = 5;
            bytes.stderr = 7;
            events.push("close");
            resolveClose(ZERO_EXIT);
          }, 0);
          throw new Error("termination failed");
        },
        timeoutMs: 100,
        checkClosedPort: async () => events.push("port"),
        checkPostExitFailure: async () => events.push("request"),
        cleanupRoot: async () => events.push("root"),
      }),
    ).rejects.toThrow("termination failed");
    expect(events).toEqual([
      "terminate",
      "close",
      "account",
      "port",
      "request",
      "root",
    ]);
    expect(receipt.child).toMatchObject({
      outputBounded: true,
      stdoutBytes: 5,
      stderrBytes: 7,
      totalOutputBytes: 12,
    });
  });

  test("aggregates lifecycle, port, request, and cleanup failures", async () => {
    const events = [];
    const failure = finalizeServerAndRoot({
      child: {},
      observed: observation({
        exit: Promise.reject(new Error("exit failed")),
        close: Promise.reject(new Error("close failed")),
      }),
      origin: "http://127.0.0.1:1",
      receipt: traceReceipt(),
      terminate: async () => {
        events.push("terminate");
        throw new Error("termination failed");
      },
      timeoutMs: 100,
      checkClosedPort: async () => {
        events.push("port");
        throw new Error("port failed");
      },
      checkPostExitFailure: async () => {
        events.push("request");
        throw new Error("request failed");
      },
      cleanupRoot: async () => {
        events.push("root");
        throw new Error("cleanup failed");
      },
    });
    await expect(failure).rejects.toBeInstanceOf(AggregateError);
    await expect(failure).rejects.toThrow("Server finalization failed");
    expect(events).toEqual(["terminate", "port", "request", "root"]);
  });
});

function observation(input) {
  const bytes = input.bytes ?? { stdout: 0, stderr: 0 };
  return {
    exit: input.exit,
    close: input.close,
    assertOutputBounded: () => input.onAccount?.(),
    stdoutBytes: () => bytes.stdout,
    stderrBytes: () => bytes.stderr,
    totalOutputBytes: () => bytes.stdout + bytes.stderr,
  };
}

function traceReceipt() {
  return {
    child: childReceipt(),
    portClosed: false,
    postExitSdkRequestFailed: false,
  };
}

function childReceipt() {
  return {
    outputBounded: false,
    gracefulZeroExit: false,
    forcedCleanup: false,
    stdoutBytes: 0,
    stderrBytes: 0,
    totalOutputBytes: 0,
  };
}
