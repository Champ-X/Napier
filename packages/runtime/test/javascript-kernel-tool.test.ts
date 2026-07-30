import { describe, expect, it } from "vitest";

import {
  javascriptKernelToolCallArgumentsLedgerProjection,
  javascriptKernelToolOutputLedgerProjection,
} from "../src/index.js";

describe("JavaScript kernel Agent tool boundary", () => {
  it("projects code, cwd, and live output as hashes only", () => {
    const code = "const PRIVATE_VALUE = 21; PRIVATE_VALUE * 2";
    const cwd = "private/data";
    const call = javascriptKernelToolCallArgumentsLedgerProjection({
      action: "evaluate",
      processId: "process_12345678901234567890",
      code,
      timeoutMs: 750,
    });
    const start = javascriptKernelToolCallArgumentsLedgerProjection({
      action: "start",
      cwd,
      sessionTimeoutMs: 20_000,
    });
    const output = javascriptKernelToolOutputLedgerProjection(
      "PRIVATE_KERNEL_OUTPUT",
      { details: { resultSha256: "a".repeat(64) } },
    );
    const durable = JSON.stringify({ call, start, output });

    expect(call).toEqual(
      expect.objectContaining({
        action: "evaluate",
        processId: "process_12345678901234567890",
        codeBytes: Buffer.byteLength(code),
        codeSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        timeoutMs: 750,
        inputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(start).toEqual(
      expect.objectContaining({
        action: "start",
        cwdPathSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        sessionTimeoutMs: 20_000,
      }),
    );
    expect(output).toEqual(
      expect.objectContaining({
        outputRedacted: true,
        outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        outputBytes: 21,
        resultSha256: "a".repeat(64),
      }),
    );
    expect(durable).not.toContain(code);
    expect(durable).not.toContain(cwd);
    expect(durable).not.toContain("PRIVATE_KERNEL_OUTPUT");
  });
});
