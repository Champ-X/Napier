import { describe, expect, it } from "vitest";

import {
  nodeDebuggerToolCallArgumentsLedgerProjection,
  nodeDebuggerToolOutputLedgerProjection,
} from "../src/index.js";

describe("Node debugger Agent tool boundary", () => {
  it("projects paths, arguments, expressions, variables, and output as hashes only", () => {
    const path = "private/debug-target.mjs";
    const programPath = "private/dist/debug-target.js";
    const sourceMapPath = "private/dist/debug-target.js.map";
    const programArgument = "PRIVATE_PROGRAM_ARGUMENT";
    const expression = "PRIVATE_LOCAL + 1";
    const launch = nodeDebuggerToolCallArgumentsLedgerProjection({
      action: "launch",
      path,
      programPath,
      sourceMapPath,
      breakpoints: [{ line: 12 }],
      args: [programArgument],
      timeoutMs: 750,
      sessionTimeoutMs: 20_000,
    });
    const evaluate = nodeDebuggerToolCallArgumentsLedgerProjection({
      action: "evaluate",
      processId: "process_12345678901234567890",
      frameId: 1,
      expression,
    });
    const output = nodeDebuggerToolOutputLedgerProjection(
      "PRIVATE_DEBUG_VARIABLE=42",
      { details: { resultSha256: "a".repeat(64) } },
    );
    const durable = JSON.stringify({ launch, evaluate, output });

    expect(launch).toEqual(
      expect.objectContaining({
        action: "launch",
        sourcePathSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        sourceMapMode: "external",
        programPathSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        sourceMapPathSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        breakpointCount: 1,
        breakpointSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        argumentCount: 1,
        argumentSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(evaluate).toEqual(
      expect.objectContaining({
        action: "evaluate",
        processId: "process_12345678901234567890",
        frameId: 1,
        expressionBytes: Buffer.byteLength(expression),
        expressionSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(output).toEqual(
      expect.objectContaining({
        outputRedacted: true,
        outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        resultSha256: "a".repeat(64),
      }),
    );
    expect(durable).not.toContain(path);
    expect(durable).not.toContain(programPath);
    expect(durable).not.toContain(sourceMapPath);
    expect(durable).not.toContain(programArgument);
    expect(durable).not.toContain(expression);
    expect(durable).not.toContain("PRIVATE_DEBUG_VARIABLE");
  });
});
