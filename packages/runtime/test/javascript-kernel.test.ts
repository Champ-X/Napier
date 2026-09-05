import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createJavascriptKernelTool,
  JAVASCRIPT_KERNEL_OUTPUT_BUDGET_EXHAUSTED,
  JAVASCRIPT_KERNEL_WORKER_ARGUMENTS,
  JAVASCRIPT_KERNEL_WORKER_LOADER_SOURCE,
  JAVASCRIPT_KERNEL_WORKER_SOURCE,
  JavascriptKernelManager,
  LocalStore,
  MAX_JAVASCRIPT_KERNEL_CODE_BYTES,
  MAX_JAVASCRIPT_KERNEL_TOOL_OUTPUT_BYTES,
  MAX_JAVASCRIPT_KERNEL_WORKER_ARGUMENT_CHARS,
  parseJavascriptKernelResult,
  type OsSandboxAdapter,
  WorkspaceProcessManager,
} from "../src/index.js";
import { formatJavascriptKernelCodeBridgeResponse } from "../src/javascript-kernel-code-bridge.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("persistent JavaScript kernel", () => {
  it("reassembles bounded Code Bridge frames larger than one process input message", async () => {
    const harness = await createHarness();
    const kernel = await harness.kernels.start({
      threadId: harness.threadId,
      runId: harness.runId,
      timeoutMs: 20_000,
    });
    const largePayload = "x".repeat(48 * 1024);
    const evaluated = await harness.kernels.evaluate({
      threadId: harness.threadId,
      runId: harness.runId,
      processId: kernel.id,
      code: 'napier.call("large_result",{}).then(result=>result.details.payload.length)',
      codeBridge: async () => ({
        content: [],
        details: { payload: largePayload },
        isError: false,
      }),
    });

    expect(evaluated).toEqual(
      expect.objectContaining({ status: "ok", preview: "49152" }),
    );
    const session = (await harness.processes.list(harness.threadId)).find(
      ({ id }) => id === kernel.id,
    );
    expect(session?.stdinWriteCount).toBeGreaterThanOrEqual(4);
    await harness.kernels.cancel({
      threadId: harness.threadId,
      runId: harness.runId,
      processId: kernel.id,
    });
    await harness.close();
  }, 20_000);

  it("does not mix reordered, duplicate, or cross-evaluation response frames", async () => {
    const harness = await createHarness();
    const kernel = await harness.kernels.start({
      threadId: harness.threadId,
      runId: harness.runId,
      timeoutMs: 20_000,
    });
    const largePayload = "v".repeat(24 * 1024);
    const evaluated = await harness.kernels.evaluate({
      threadId: harness.threadId,
      runId: harness.runId,
      processId: kernel.id,
      code: 'napier.call("framed_result",{}).then(result=>result.details.payload.length)',
      codeBridge: async (call) => {
        const frames = formatJavascriptKernelCodeBridgeResponse({
          evaluationId: call.evaluationId,
          callId: call.callId,
          result: {
            content: [],
            details: { payload: largePayload },
            isError: false,
          },
        });
        const crossEvaluation = formatJavascriptKernelCodeBridgeResponse({
          evaluationId: "kernelrequest_00000000000000000000",
          callId: call.callId,
          result: {
            content: [],
            details: { payload: "injected" },
            isError: false,
          },
        })[0]!;
        for (const frame of [
          frames[1]!,
          frames[0]!,
          crossEvaluation,
          frames[0]!,
        ]) {
          await harness.processes.writePrivateProtocolInput({
            threadId: harness.threadId,
            runId: harness.runId,
            processId: kernel.id,
            text: frame,
            appendNewline: true,
            initiatedBy: "agent",
          });
        }
        return {
          content: [],
          details: { payload: largePayload },
          isError: false,
        };
      },
    });

    expect(evaluated).toEqual(
      expect.objectContaining({ status: "ok", preview: "24576" }),
    );
    await harness.kernels.cancel({
      threadId: harness.threadId,
      runId: harness.runId,
      processId: kernel.id,
    });
    await harness.close();
  }, 20_000);

  it("keeps state across evaluations and records only hash-bound process evidence", async () => {
    const harness = await createHarness();
    const kernel = await harness.kernels.start({
      threadId: harness.threadId,
      runId: harness.runId,
      timeoutMs: 20_000,
    });
    expect(kernel).toEqual(
      expect.objectContaining({
        outputAvailable: false,
        stdinOpen: false,
      }),
    );

    const seeded = await harness.kernels.evaluate({
      threadId: harness.threadId,
      runId: harness.runId,
      processId: kernel.id,
      code: 'const PRIVATE_VALUES = [1, 2, 3]; console.log("PRIVATE_SEED", PRIVATE_VALUES.length); PRIVATE_VALUES',
    });
    const reduced = await harness.kernels.evaluate({
      threadId: harness.threadId,
      runId: harness.runId,
      processId: kernel.id,
      code: "PRIVATE_VALUES.reduce((sum, value) => sum + value, 0)",
    });

    expect(seeded).toEqual(
      expect.objectContaining({
        status: "ok",
        terminal: false,
        processStatus: "running",
        valueType: "array",
        preview: "[1,2,3]",
        console: ['"PRIVATE_SEED" 3'],
      }),
    );
    expect(reduced).toEqual(
      expect.objectContaining({
        status: "ok",
        terminal: false,
        processStatus: "running",
        valueType: "number",
        preview: "6",
      }),
    );
    expect(await harness.processes.output(harness.threadId, kernel.id)).toEqual(
      expect.objectContaining({
        outputAvailable: false,
        chunks: [],
      }),
    );

    const cancelled = await harness.kernels.cancel({
      threadId: harness.threadId,
      runId: harness.runId,
      processId: kernel.id,
    });
    expect(cancelled).toEqual(
      expect.objectContaining({
        status: "cancelled",
        workspaceDeltaStatus: "unchanged",
      }),
    );
    const durable = JSON.stringify(
      await harness.store.listEvents(harness.threadId),
    );
    expect(durable).not.toContain("PRIVATE_VALUES");
    expect(durable).not.toContain("PRIVATE_SEED");
    expect(durable).not.toContain("[ 1, 2, 3 ]");
    await harness.close();
  }, 20_000);

  it("does not expose host functions through console or result rendering", async () => {
    const harness = await createHarness();
    const kernel = await harness.kernels.start({
      threadId: harness.threadId,
      runId: harness.runId,
      timeoutMs: 20_000,
    });
    for (const code of [
      'console.log.constructor("return process")()',
      'console.log.constructor.constructor("return process")()',
      'globalThis.constructor.constructor("return process")()',
      'Function("return process")()',
      'eval("1")',
    ]) {
      expect(
        await harness.kernels.evaluate({
          threadId: harness.threadId,
          runId: harness.runId,
          processId: kernel.id,
          code,
        }),
      ).toEqual(
        expect.objectContaining({
          status: "error",
          terminal: false,
          processStatus: "running",
          preview: expect.stringContaining(
            "Code generation from strings disallowed",
          ),
        }),
      );
    }
    expect(
      await harness.kernels.evaluate({
        threadId: harness.threadId,
        runId: harness.runId,
        processId: kernel.id,
        code: `({
          [Symbol.for("nodejs.util.inspect.custom")](
            _depth,
            _options,
            inspect,
          ) {
            return inspect.constructor("return process")().version;
          },
        })`,
      }),
    ).toEqual(
      expect.objectContaining({
        status: "ok",
        terminal: false,
        processStatus: "running",
        valueType: "object",
        preview: "{}",
      }),
    );
    expect(
      await harness.kernels.evaluate({
        threadId: harness.threadId,
        runId: harness.runId,
        processId: kernel.id,
        code: `Array.prototype.toJSON = () => {
          throw new Error("PRIVATE_OUTER_SERIALIZATION");
        };
        console.log("SAFE_IN_REALM_CONSOLE");
        1`,
      }),
    ).toEqual(
      expect.objectContaining({
        status: "ok",
        terminal: false,
        processStatus: "running",
        valueType: "number",
        preview: "1",
        console: ['"SAFE_IN_REALM_CONSOLE"'],
      }),
    );
    expect(
      await harness.kernels.evaluate({
        threadId: harness.threadId,
        runId: harness.runId,
        processId: kernel.id,
        code: `[typeof process, typeof require, typeof fetch,
          typeof SharedArrayBuffer, typeof Atomics,
          typeof FinalizationRegistry, typeof WeakRef,
          typeof WebAssembly, typeof ArrayBuffer].join("/")`,
      }),
    ).toEqual(
      expect.objectContaining({
        status: "ok",
        preview:
          '"undefined/undefined/undefined/undefined/undefined/undefined/undefined/undefined/function"',
      }),
    );
    await expect(
      harness.kernels.evaluate({
        threadId: harness.threadId,
        runId: harness.runId,
        processId: kernel.id,
        code: 'import("node:fs").catch(() => 1); 0',
      }),
    ).rejects.toThrow("dynamic import is unavailable");
    expect(
      await harness.kernels.evaluate({
        threadId: harness.threadId,
        runId: harness.runId,
        processId: kernel.id,
        code: `/* import("node:fs") */
          const importValue = "import('node:fs')";
          importValue`,
      }),
    ).toEqual(
      expect.objectContaining({
        status: "ok",
        preview: `"import('node:fs')"`,
      }),
    );
    await harness.kernels.cancel({
      threadId: harness.threadId,
      runId: harness.runId,
      processId: kernel.id,
    });
    await harness.close();
  }, 20_000);

  it("keeps synchronous errors visible but terminates uncertain async or timed-out state", async () => {
    const harness = await createHarness();
    const first = await harness.kernels.start({
      threadId: harness.threadId,
      runId: harness.runId,
      timeoutMs: 20_000,
    });
    const failed = await harness.kernels.evaluate({
      threadId: harness.threadId,
      runId: harness.runId,
      processId: first.id,
      code: 'globalThis.recovered = 7; throw new Error("PRIVATE_SYNC_ERROR")',
    });
    expect(failed).toEqual(
      expect.objectContaining({
        status: "error",
        terminal: false,
        processStatus: "running",
        preview: expect.stringContaining("PRIVATE_SYNC_ERROR"),
      }),
    );
    expect(
      await harness.kernels.evaluate({
        threadId: harness.threadId,
        runId: harness.runId,
        processId: first.id,
        code: "recovered",
      }),
    ).toEqual(expect.objectContaining({ status: "ok", preview: "7" }));
    await harness.kernels.cancel({
      threadId: harness.threadId,
      runId: harness.runId,
      processId: first.id,
    });

    const microtaskKernel = await harness.kernels.start({
      threadId: harness.threadId,
      runId: harness.runId,
      timeoutMs: 20_000,
    });
    expect(
      await harness.kernels.evaluate({
        threadId: harness.threadId,
        runId: harness.runId,
        processId: microtaskKernel.id,
        code: `globalThis.microtaskState = 0;
          Promise.resolve().then(() => {
            microtaskState = 1;
          });
          microtaskState`,
      }),
    ).toEqual(expect.objectContaining({ status: "ok", preview: "0" }));
    expect(
      await harness.kernels.evaluate({
        threadId: harness.threadId,
        runId: harness.runId,
        processId: microtaskKernel.id,
        code: "microtaskState",
      }),
    ).toEqual(expect.objectContaining({ status: "ok", preview: "1" }));
    expect(
      await harness.kernels.evaluate({
        threadId: harness.threadId,
        runId: harness.runId,
        processId: microtaskKernel.id,
        code: `Promise.resolve().then(function loop() {
          Promise.resolve().then(loop);
        });
        0`,
        timeoutMs: 10,
      }),
    ).toEqual(
      expect.objectContaining({
        status: "error",
        terminal: true,
        processStatus: "cancelled",
        preview: expect.stringContaining("timed out"),
      }),
    );

    const promiseKernel = await harness.kernels.start({
      threadId: harness.threadId,
      runId: harness.runId,
      timeoutMs: 20_000,
    });
    const promise = await harness.kernels.evaluate({
      threadId: harness.threadId,
      runId: harness.runId,
      processId: promiseKernel.id,
      code: "Promise.resolve(1)",
    });
    expect(promise).toEqual(
      expect.objectContaining({
        status: "error",
        terminal: true,
        processStatus: "cancelled",
        preview: "Promises are not supported",
      }),
    );
    await expect(
      harness.kernels.evaluate({
        threadId: harness.threadId,
        runId: harness.runId,
        processId: promiseKernel.id,
        code: "1",
      }),
    ).rejects.toThrow("does not belong");

    const timeoutKernel = await harness.kernels.start({
      threadId: harness.threadId,
      runId: harness.runId,
      timeoutMs: 20_000,
    });
    const timedOut = await harness.kernels.evaluate({
      threadId: harness.threadId,
      runId: harness.runId,
      processId: timeoutKernel.id,
      code: "while (true) {}",
      timeoutMs: 10,
    });
    expect(timedOut).toEqual(
      expect.objectContaining({
        status: "error",
        terminal: true,
        processStatus: "cancelled",
        preview: expect.stringContaining("timed out"),
      }),
    );

    const renderKernel = await harness.kernels.start({
      threadId: harness.threadId,
      runId: harness.runId,
      timeoutMs: 20_000,
    });
    const renderTimedOut = await harness.kernels.evaluate({
      threadId: harness.threadId,
      runId: harness.runId,
      processId: renderKernel.id,
      code: "({ toJSON() { while (true) {} } })",
    });
    expect(renderTimedOut).toEqual(
      expect.objectContaining({
        status: "error",
        terminal: true,
        processStatus: "cancelled",
        preview: "JavaScript kernel result rendering failed",
      }),
    );
    await harness.close();
  }, 20_000);

  it("serializes concurrent evaluations and caps live previews and console output", async () => {
    const harness = await createHarness();
    const kernel = await harness.kernels.start({
      threadId: harness.threadId,
      runId: harness.runId,
      timeoutMs: 20_000,
    });
    const concurrent = await Promise.all([
      harness.kernels.evaluate({
        threadId: harness.threadId,
        runId: harness.runId,
        processId: kernel.id,
        code: "globalThis.counter = (globalThis.counter ?? 0) + 1",
      }),
      harness.kernels.evaluate({
        threadId: harness.threadId,
        runId: harness.runId,
        processId: kernel.id,
        code: "globalThis.counter = (globalThis.counter ?? 0) + 1",
      }),
    ]);
    expect(concurrent.map((result) => result.preview).sort()).toEqual([
      "1",
      "2",
    ]);

    const bounded = await harness.kernels.evaluate({
      threadId: harness.threadId,
      runId: harness.runId,
      processId: kernel.id,
      code: 'Array.from({ length: 13 }, () => console.log("x".repeat(300))); "y".repeat(5000)',
    });
    expect(bounded).toEqual(
      expect.objectContaining({
        status: "ok",
        previewTruncated: true,
        consoleTruncated: true,
      }),
    );
    expect(bounded.preview.length).toBe(4_096);
    expect(bounded.console).toHaveLength(12);
    expect(bounded.console.every((entry) => entry.length <= 256)).toBe(true);

    const escapeKernel = await harness.kernels.start({
      threadId: harness.threadId,
      runId: harness.runId,
      timeoutMs: 20_000,
    });
    const escapeBounded = await harness.kernels.evaluate({
      threadId: harness.threadId,
      runId: harness.runId,
      processId: escapeKernel.id,
      code: `const protocolError = new Error("\\0".repeat(5_000));
        Array.from({ length: 13 }, () => console.log(protocolError));
        protocolError`,
    });
    expect(escapeBounded).toEqual(
      expect.objectContaining({
        status: "ok",
        processStatus: "running",
        previewTruncated: true,
        consoleTruncated: true,
      }),
    );
    expect(escapeBounded.preview).toHaveLength(4_096);
    expect(escapeBounded.console).toHaveLength(12);
    expect(
      await harness.kernels.evaluate({
        threadId: harness.threadId,
        runId: harness.runId,
        processId: escapeKernel.id,
        code: `Array.from(
          { length: 13 },
          () => console.log(protocolError),
        );
        protocolError`,
      }),
    ).toEqual(
      expect.objectContaining({
        status: "error",
        terminal: true,
        processStatus: "cancelled",
        preview: JAVASCRIPT_KERNEL_OUTPUT_BUDGET_EXHAUSTED,
      }),
    );

    expect(
      await harness.kernels.evaluate({
        threadId: harness.threadId,
        runId: harness.runId,
        processId: kernel.id,
        code: "[typeof process, typeof require, typeof fetch].join('/')",
      }),
    ).toEqual(
      expect.objectContaining({
        status: "ok",
        preview: '"undefined/undefined/undefined"',
      }),
    );
    expect(
      await harness.kernels.evaluate({
        threadId: harness.threadId,
        runId: harness.runId,
        processId: kernel.id,
        code: 'eval("1")',
      }),
    ).toEqual(
      expect.objectContaining({
        status: "error",
        terminal: false,
        preview: expect.stringContaining(
          "Code generation from strings disallowed",
        ),
      }),
    );
    await harness.kernels.cancel({
      threadId: harness.threadId,
      runId: harness.runId,
      processId: kernel.id,
    });
    await harness.close();
  }, 20_000);

  it("cancels the whole kernel when an evaluation is externally aborted", async () => {
    const harness = await createHarness();
    const kernel = await harness.kernels.start({
      threadId: harness.threadId,
      runId: harness.runId,
      timeoutMs: 20_000,
    });
    const controller = new AbortController();
    const pending = harness.kernels.evaluate({
      threadId: harness.threadId,
      runId: harness.runId,
      processId: kernel.id,
      code: "while (true) {}",
      timeoutMs: 2_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 10);

    await expect(pending).rejects.toThrow("poll was aborted");
    expect(
      (await harness.processes.list(harness.threadId)).find(
        (session) => session.id === kernel.id,
      ),
    ).toEqual(expect.objectContaining({ status: "cancelled" }));
    await expect(
      harness.kernels.evaluate({
        threadId: harness.threadId,
        runId: harness.runId,
        processId: kernel.id,
        code: "1",
      }),
    ).rejects.toThrow("does not belong");
    await harness.close();
  }, 20_000);

  it("rejects malformed, oversized, and cross-Run requests before reuse", async () => {
    const harness = await createHarness();
    const kernel = await harness.kernels.start({
      threadId: harness.threadId,
      runId: harness.runId,
      timeoutMs: 20_000,
    });
    await expect(
      harness.kernels.evaluate({
        threadId: harness.threadId,
        runId: "run_other1234",
        processId: kernel.id,
        code: "1",
      }),
    ).rejects.toThrow("does not belong");
    await expect(
      harness.kernels.evaluate({
        threadId: harness.threadId,
        runId: harness.runId,
        processId: kernel.id,
        code: "x".repeat(MAX_JAVASCRIPT_KERNEL_CODE_BYTES + 1),
      }),
    ).rejects.toThrow("UTF-8 bytes");
    await expect(
      harness.kernels.evaluate({
        threadId: harness.threadId,
        runId: harness.runId,
        processId: kernel.id,
        code: "1",
        timeoutMs: 2_001,
      }),
    ).rejects.toThrow("timeoutMs");
    const rawRequestId = "kernelrequest_12345678901234567890";
    await expect(
      harness.processes.writeInput({
        threadId: harness.threadId,
        runId: harness.runId,
        processId: kernel.id,
        text: "{}",
        appendNewline: true,
        initiatedBy: "agent",
      }),
    ).rejects.toThrow("private protocol session");
    await harness.processes.writePrivateProtocolInput({
      threadId: harness.threadId,
      runId: harness.runId,
      processId: kernel.id,
      text: JSON.stringify({
        kind: "napier.javascript-kernel-request",
        schemaVersion: 1,
        id: rawRequestId,
        codeBase64: Buffer.from(
          "x".repeat(MAX_JAVASCRIPT_KERNEL_CODE_BYTES + 1),
          "utf8",
        ).toString("base64"),
        timeoutMs: 1_000,
      }),
      appendNewline: true,
      initiatedBy: "agent",
    });
    expect(
      await harness.processes.outputPrivateProtocol(
        harness.threadId,
        kernel.id,
        {
          afterCursor: kernel.nextCursor,
          waitMs: 50,
        },
      ),
    ).toEqual(
      expect.objectContaining({
        status: "running",
        chunks: [],
      }),
    );
    expect(
      await harness.kernels.evaluate({
        threadId: harness.threadId,
        runId: harness.runId,
        processId: kernel.id,
        code: "1",
      }),
    ).toEqual(expect.objectContaining({ status: "ok", preview: "1" }));
    const escapeAmplifiedCode = `"${"\\\\".repeat(
      (MAX_JAVASCRIPT_KERNEL_CODE_BYTES - 2) / 2,
    )}"`;
    expect(Buffer.byteLength(escapeAmplifiedCode, "utf8")).toBe(
      MAX_JAVASCRIPT_KERNEL_CODE_BYTES,
    );
    expect(
      await harness.kernels.evaluate({
        threadId: harness.threadId,
        runId: harness.runId,
        processId: kernel.id,
        code: escapeAmplifiedCode,
      }),
    ).toEqual(
      expect.objectContaining({
        status: "ok",
        previewTruncated: true,
      }),
    );
    await harness.kernels.cancel({
      threadId: harness.threadId,
      runId: harness.runId,
      processId: kernel.id,
    });
    await harness.close();
  });

  it("does not adopt ephemeral state after kernel manager recreation", async () => {
    const harness = await createHarness();
    const kernel = await harness.kernels.start({
      threadId: harness.threadId,
      runId: harness.runId,
      timeoutMs: 20_000,
    });
    await harness.kernels.evaluate({
      threadId: harness.threadId,
      runId: harness.runId,
      processId: kernel.id,
      code: "globalThis.privateRuntimeState = 42",
    });

    const restartedManager = new JavascriptKernelManager(harness.processes);
    await expect(
      restartedManager.evaluate({
        threadId: harness.threadId,
        runId: harness.runId,
        processId: kernel.id,
        code: "privateRuntimeState",
      }),
    ).rejects.toThrow("does not belong");

    await harness.kernels.cancel({
      threadId: harness.threadId,
      runId: harness.runId,
      processId: kernel.id,
    });
    await harness.close();
  });

  it("keeps worst-case Unicode tool output within its byte budget", async () => {
    const harness = await createHarness();
    const tool = createJavascriptKernelTool(harness.kernels, {
      threadId: harness.threadId,
      runId: harness.runId,
    });
    const started = await tool.execute("kernel-start", {
      action: "start",
      sessionTimeoutMs: 20_000,
    });
    const evaluated = await tool.execute("kernel-evaluate", {
      action: "evaluate",
      processId: started.details.processId,
      code: `Array.from(
        { length: 13 },
        () => console.log("\\u0800".repeat(500)),
      );
      "\\u0800".repeat(5_000)`,
    });

    expect(evaluated.details).toEqual(
      expect.objectContaining({
        evaluationStatus: "ok",
        previewTruncated: true,
        consoleCount: 12,
        consoleTruncated: true,
      }),
    );
    expect(
      Buffer.byteLength(evaluated.content[0]?.text ?? "", "utf8"),
    ).toBeLessThanOrEqual(MAX_JAVASCRIPT_KERNEL_TOOL_OUTPUT_BYTES);

    await tool.execute("kernel-cancel", {
      action: "cancel",
      processId: started.details.processId,
    });
    await harness.close();
  });

  it("keeps every embedded worker argument within the explicit argv contract and parses exact results", () => {
    expect(JAVASCRIPT_KERNEL_WORKER_ARGUMENTS.slice(4).join("")).toBe(
      JAVASCRIPT_KERNEL_WORKER_SOURCE,
    );
    expect(JAVASCRIPT_KERNEL_WORKER_ARGUMENTS.slice(0, 4)).toEqual([
      "--max-old-space-size=64",
      "-e",
      JAVASCRIPT_KERNEL_WORKER_LOADER_SOURCE,
      "--",
    ]);
    expect(
      JAVASCRIPT_KERNEL_WORKER_ARGUMENTS.every(
        (argument) =>
          argument.length <= MAX_JAVASCRIPT_KERNEL_WORKER_ARGUMENT_CHARS,
      ),
    ).toBe(true);
    expect(
      JAVASCRIPT_KERNEL_WORKER_ARGUMENTS.reduce(
        (total, argument) => total + argument.length,
        0,
      ),
    ).toBeLessThanOrEqual(16_384);
    expect(JAVASCRIPT_KERNEL_WORKER_SOURCE).not.toMatch(
      /[\u0000-\u001f\u007f]/u,
    );
    const requestId = "kernelrequest_12345678901234567890";
    const result = {
      kind: "napier.javascript-kernel-result",
      schemaVersion: 1,
      id: requestId,
      status: "ok",
      terminal: false,
      valueType: "number",
      preview: "3",
      previewTruncated: false,
      console: [],
      consoleTruncated: false,
      durationMs: 2,
    };
    const wireResult = {
      kind: result.kind,
      schemaVersion: result.schemaVersion,
      id: result.id,
      status: result.status,
      terminal: result.terminal,
      valueType: result.valueType,
      previewUtf16Base64: Buffer.from(result.preview, "utf16le").toString(
        "base64",
      ),
      previewTruncated: result.previewTruncated,
      consoleUtf16Base64: result.console.map((entry) =>
        Buffer.from(entry, "utf16le").toString("base64"),
      ),
      consoleTruncated: result.consoleTruncated,
      durationMs: result.durationMs,
    };
    expect(
      parseJavascriptKernelResult(
        `NAPIER_JS_RESULT ${JSON.stringify(wireResult)}`,
        requestId,
      ),
    ).toEqual(result);
    expect(
      parseJavascriptKernelResult(
        `NAPIER_JS_RESULT ${JSON.stringify({
          ...wireResult,
          process: "leak",
        })}`,
        requestId,
      ),
    ).toBeUndefined();
    expect(
      parseJavascriptKernelResult(
        `NAPIER_JS_RESULT ${JSON.stringify({
          ...wireResult,
          previewUtf16Base64: "AA==",
        })}`,
        requestId,
      ),
    ).toBeUndefined();
  });
});

async function createHarness(): Promise<{
  store: LocalStore;
  processes: WorkspaceProcessManager;
  kernels: JavascriptKernelManager;
  threadId: string;
  runId: string;
  close(): Promise<void>;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-javascript-kernel-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({
    title: "JavaScript kernel test",
    agentId: agent.id,
  });
  const run = await store.createRun({
    threadId: thread.id,
    agentId: agent.id,
  });
  const processes = new WorkspaceProcessManager({
    store,
    workspaceRoot,
    sandbox: directSandbox(),
  });
  await processes.initialize();
  return {
    store,
    processes,
    kernels: new JavascriptKernelManager(processes),
    threadId: thread.id,
    runId: run.id,
    async close() {
      await processes.shutdown();
      store.close();
    },
  };
}

function directSandbox(): OsSandboxAdapter {
  return {
    id: "direct-javascript-kernel-test",
    async launch(request) {
      const child = spawn(request.command, request.args, {
        cwd: request.cwd,
        env: { ...request.env },
        detached: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const exit = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) =>
        child.once("exit", (code, signal) => resolve({ code, signal })),
      );
      return {
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        exit,
        async terminate() {
          if (child.exitCode === null && child.signalCode === null) {
            if (child.pid !== undefined) {
              try {
                process.kill(-child.pid, "SIGTERM");
              } catch {
                child.kill("SIGTERM");
              }
            }
          }
          await exit;
        },
      };
    },
  };
}
