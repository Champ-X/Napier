import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  parseAgentMessageExperimentPreviewParams,
  parseAgentMessageExperimentRunParams,
} from "../src/rpc-agent-message-experiments.js";
import {
  parseModelInvocationExperimentPreviewParams,
  parseModelInvocationExperimentRunParams,
} from "../src/rpc-model-invocation-experiments.js";
import {
  MAX_RPC_LINE_BYTES,
  parseAgentResumeParams,
  parseAgentRunParams,
  parseInitializeParams,
  parseJsonRpcMessage,
  parseWorkflowApprovalAnswerParams,
  parseWorkflowResumeParams,
  parseWorkflowRunParams,
  rpcError,
} from "../src/rpc-protocol.js";
import { readRpcLines, RpcOutputWriter } from "../src/rpc-transport.js";
import {
  parseWorkflowExperimentPreviewParams,
  parseWorkflowExperimentRunParams,
} from "../src/rpc-workflow-experiments.js";
import { defineRpcWorkflowManifest } from "./rpc-workflow-fixture.js";

describe("Napier JSON-RPC protocol", () => {
  it("strictly parses requests, notifications, and initialization", () => {
    expect(
      parseJsonRpcMessage(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"test","version":"1"}}}',
      ),
    ).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "test", version: "1" } },
    });
    expect(
      parseJsonRpcMessage(
        '{"jsonrpc":"2.0","method":"$/cancelRequest","params":{"id":"run-1"}}',
      ),
    ).toEqual({
      jsonrpc: "2.0",
      method: "$/cancelRequest",
      params: { id: "run-1" },
    });
    expect(parseInitializeParams({ clientInfo: { name: "editor" } })).toEqual({
      clientInfo: { name: "editor" },
    });
    expect(() => parseJsonRpcMessage("{")).toThrow("not valid JSON");
    expect(() =>
      parseJsonRpcMessage('{"jsonrpc":"2.0","id":null,"method":"initialize"}'),
    ).toThrow("shape is invalid");
    expect(() =>
      parseJsonRpcMessage(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","extra":true}',
      ),
    ).toThrow("shape is invalid");
    expect(() =>
      parseInitializeParams({ clientInfo: { name: "x", extra: true } }),
    ).toThrow("unknown fields");
  });

  it("validates Agent run and resume params before Runtime mutation", () => {
    expect(
      parseAgentRunParams({
        prompt: "Inspect this workspace.",
        title: "RPC task",
        model: { provider: "napier", id: "demo" },
      }),
    ).toEqual({
      prompt: "Inspect this workspace.",
      title: "RPC task",
      model: { provider: "napier", id: "demo" },
    });
    expect(
      parseAgentResumeParams({
        threadId: "thread_example",
        runId: "run_abcdefgh",
      }),
    ).toEqual({
      threadId: "thread_example",
      runId: "run_abcdefgh",
    });
    expect(() =>
      parseAgentRunParams({
        prompt: "x",
        threadId: "thread_example",
        title: "conflict",
      }),
    ).toThrow("title cannot");
    expect(() => parseAgentRunParams({ prompt: "x", unknown: true })).toThrow(
      "unknown fields",
    );
    expect(() =>
      parseAgentRunParams({
        prompt: "x",
        model: { provider: "INVALID", id: "demo" },
      }),
    ).toThrow("model is invalid");
    expect(() =>
      parseAgentResumeParams({ threadId: "thread_example", runId: "bad" }),
    ).toThrow("runId is invalid");
    expect(
      parseAgentMessageExperimentPreviewParams({
        sourceThreadId: "thread_example",
        sourceRunId: "run_abcdefgh",
        sourceMessageSeq: 12,
        model: { provider: "napier", id: "demo" },
        toolResultMode: "reuse_source",
      }),
    ).toEqual({
      sourceThreadId: "thread_example",
      sourceRunId: "run_abcdefgh",
      sourceMessageSeq: 12,
      model: { provider: "napier", id: "demo" },
      toolResultMode: "reuse_source",
    });
    expect(
      parseAgentMessageExperimentRunParams({
        sourceThreadId: "thread_example",
        sourceRunId: "run_abcdefgh",
        sourceMessageSeq: 12,
        expectedPreviewSha256: "a".repeat(64),
      }),
    ).toEqual({
      sourceThreadId: "thread_example",
      sourceRunId: "run_abcdefgh",
      sourceMessageSeq: 12,
      expectedPreviewSha256: "a".repeat(64),
    });
    expect(() =>
      parseAgentMessageExperimentPreviewParams({
        sourceThreadId: "thread_example",
        sourceRunId: "run_abcdefgh",
        sourceMessageSeq: 12,
        expectedPreviewSha256: "a".repeat(64),
      }),
    ).toThrow("cannot include execution confirmation");
    expect(() =>
      parseAgentMessageExperimentRunParams({
        sourceThreadId: "thread_example",
        sourceRunId: "run_abcdefgh",
        sourceMessageSeq: 12,
      }),
    ).toThrow("requires expectedPreviewSha256");
    expect(
      parseModelInvocationExperimentPreviewParams({
        sourceThreadId: "thread_example",
        sourceRunId: "run_abcdefgh",
        sourceTurnIndex: 0,
        model: { provider: "deepseek", id: "deepseek-chat" },
      }),
    ).toEqual({
      sourceThreadId: "thread_example",
      sourceRunId: "run_abcdefgh",
      sourceTurnIndex: 0,
      model: { provider: "deepseek", id: "deepseek-chat" },
    });
    expect(
      parseModelInvocationExperimentRunParams({
        sourceThreadId: "thread_example",
        sourceRunId: "run_abcdefgh",
        sourceTurnIndex: 0,
        expectedPreviewSha256: "b".repeat(64),
      }),
    ).toEqual({
      sourceThreadId: "thread_example",
      sourceRunId: "run_abcdefgh",
      sourceTurnIndex: 0,
      expectedPreviewSha256: "b".repeat(64),
    });
    expect(() =>
      parseModelInvocationExperimentPreviewParams({
        sourceThreadId: "thread_example",
        sourceRunId: "run_abcdefgh",
        sourceTurnIndex: 0,
        expectedPreviewSha256: "b".repeat(64),
      }),
    ).toThrow("cannot include execution confirmation");
    expect(() =>
      parseModelInvocationExperimentRunParams({
        sourceThreadId: "thread_example",
        sourceRunId: "run_abcdefgh",
        sourceTurnIndex: 0,
      }),
    ).toThrow("requires expectedPreviewSha256");
  });

  it("validates Workflow manifests and typed input before Runtime mutation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-rpc-protocol-"));
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "data");
    await mkdir(workspaceRoot);
    try {
      const manifest = await defineRpcWorkflowManifest({
        workspaceRoot,
        dataRoot,
      });
      expect(
        parseWorkflowRunParams({
          manifest,
          input: { text: "Protocol delivery" },
          title: "RPC Workflow",
        }),
      ).toEqual({
        manifest,
        input: { text: "Protocol delivery" },
        title: "RPC Workflow",
      });
      expect(
        parseWorkflowResumeParams({
          manifest,
          threadId: "thread_example",
          planId: "plan_example",
          retryBlocked: true,
        }),
      ).toEqual({
        manifest,
        threadId: "thread_example",
        planId: "plan_example",
        retryBlocked: true,
      });
      expect(
        parseWorkflowApprovalAnswerParams({
          manifest,
          threadId: "thread_example",
          planId: "plan_example",
          decisionId: "decision_example",
          expectedDecisionSha256: "a".repeat(64),
          answer: {
            selectedOptionIds: ["option_1"],
            customText: "Approve the bounded result.",
          },
        }),
      ).toEqual({
        manifest,
        threadId: "thread_example",
        planId: "plan_example",
        decisionId: "decision_example",
        expectedDecisionSha256: "a".repeat(64),
        answer: {
          selectedOptionIds: ["option_1"],
          customText: "Approve the bounded result.",
        },
      });
      expect(
        parseWorkflowExperimentPreviewParams({
          sourceThreadId: "thread_example",
          manifest,
          planId: "plan_abcdefgh",
          fromNodeId: "deliver",
          mode: "single_node",
        }),
      ).toEqual({
        sourceThreadId: "thread_example",
        manifest,
        planId: "plan_abcdefgh",
        fromNodeId: "deliver",
        mode: "single_node",
      });
      expect(
        parseWorkflowExperimentPreviewParams({
          sourceThreadId: "thread_example",
          manifest,
          planId: "plan_abcdefgh",
          fromNodeId: "prepare",
          mode: "simulate_node",
          simulatedOutput: { normalized: "RPC simulated" },
        }),
      ).toEqual({
        sourceThreadId: "thread_example",
        manifest,
        planId: "plan_abcdefgh",
        fromNodeId: "prepare",
        mode: "simulate_node",
        simulatedOutput: { normalized: "RPC simulated" },
      });
      expect(
        parseWorkflowExperimentRunParams({
          sourceThreadId: "thread_example",
          manifest,
          planId: "plan_abcdefgh",
          fromNodeId: "deliver",
          expectedPreviewSha256: "b".repeat(64),
        }),
      ).toEqual({
        sourceThreadId: "thread_example",
        manifest,
        planId: "plan_abcdefgh",
        fromNodeId: "deliver",
        expectedPreviewSha256: "b".repeat(64),
      });
      expect(() =>
        parseWorkflowRunParams({
          manifest,
          input: { text: "" },
        }),
      ).toThrow("manifest or input is invalid");
      expect(() =>
        parseWorkflowResumeParams({
          manifest: { ...manifest, contentSha256: "0".repeat(64) },
          threadId: "thread_example",
          planId: "plan_example",
        }),
      ).toThrow("manifest is invalid");
      expect(() =>
        parseWorkflowApprovalAnswerParams({
          manifest,
          threadId: "thread_example",
          planId: "plan_example",
          decisionId: "decision_example",
          expectedDecisionSha256: "stale",
          answer: { selectedOptionIds: ["option_3"] },
        }),
      ).toThrow("expectedDecisionSha256 is invalid");
      expect(() =>
        parseWorkflowApprovalAnswerParams({
          manifest,
          threadId: "thread_example",
          planId: "plan_example",
          decisionId: "decision_example",
          expectedDecisionSha256: "a".repeat(64),
          answer: { selectedOptionIds: ["option_3"] },
        }),
      ).toThrow("selectedOptionIds is invalid");
      expect(() =>
        parseWorkflowExperimentPreviewParams({
          sourceThreadId: "thread_example",
          manifest,
          planId: "plan_abcdefgh",
          fromNodeId: "deliver",
          expectedPreviewSha256: "b".repeat(64),
        }),
      ).toThrow("cannot include execution confirmation");
      expect(() =>
        parseWorkflowExperimentRunParams({
          sourceThreadId: "thread_example",
          manifest,
          planId: "plan_abcdefgh",
          fromNodeId: "deliver",
        }),
      ).toThrow("requires expectedPreviewSha256");
      expect(() =>
        parseWorkflowExperimentPreviewParams({
          sourceThreadId: "thread_example",
          manifest,
          planId: "plan_abcdefgh",
          fromNodeId: "deliver",
          mode: "unknown",
        }),
      ).toThrow("params are invalid");
      expect(() =>
        parseWorkflowExperimentPreviewParams({
          sourceThreadId: "thread_example",
          manifest,
          planId: "plan_abcdefgh",
          fromNodeId: "prepare",
          mode: "simulate_node",
        }),
      ).toThrow("params are invalid");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("frames split CRLF input and rejects oversized or invalid UTF-8 lines", async () => {
    const lines = await collectLines(
      Readable.from([
        Buffer.from('{"jsonrpc":"2.0",'),
        Buffer.from('"id":1,"method":"initialize"}\r\n'),
        Buffer.from(
          '{"jsonrpc":"2.0","method":"exit"}\n{"jsonrpc":"2.0","method":"tail"}',
        ),
      ]),
    );
    expect(lines).toEqual([
      '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
      '{"jsonrpc":"2.0","method":"exit"}',
      '{"jsonrpc":"2.0","method":"tail"}',
    ]);
    await expect(
      collectLines(Readable.from([Buffer.alloc(MAX_RPC_LINE_BYTES + 1, 0x61)])),
    ).rejects.toThrow("byte limit");
    await expect(
      collectLines(Readable.from([Buffer.from([0xc3, 0x28, 0x0a])])),
    ).rejects.toThrow("UTF-8");
  });

  it("releases the input iterator after a framing failure", async () => {
    let released = false;
    const input: AsyncIterable<Buffer> = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            return {
              done: false as const,
              value: Buffer.alloc(MAX_RPC_LINE_BYTES + 1, 0x61),
            };
          },
          async return() {
            released = true;
            return { done: true as const, value: undefined };
          },
        };
      },
    };

    await expect(collectLines(input)).rejects.toThrow("byte limit");
    expect(released).toBe(true);
  });

  it("serializes output with backpressure and hashes private errors", async () => {
    const output = new CaptureWritable();
    const writer = new RpcOutputWriter(output);
    await Promise.all([
      writer.write({ id: 1 }),
      writer.write({ id: 2 }),
      writer.write(rpcError(3, -32603, "Internal error", "PRIVATE_FAILURE")),
    ]);
    await writer.close();

    const values = output
      .text()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(values.map((value) => value["id"])).toEqual([1, 2, 3]);
    expect(output.text()).not.toContain("PRIVATE_FAILURE");
    expect(output.text()).toMatch(/[a-f0-9]{64}/u);
  });
});

async function collectLines(
  input: AsyncIterable<Buffer | string>,
): Promise<string[]> {
  const lines = [];
  for await (const line of readRpcLines(input)) lines.push(line);
  return lines;
}

class CaptureWritable extends Writable {
  private readonly chunks: string[] = [];

  constructor() {
    super({ highWaterMark: 1 });
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString("utf8"));
    setTimeout(callback, 0);
  }

  text(): string {
    return this.chunks.join("");
  }
}
