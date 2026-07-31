import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createToolInvocationCapsule,
  createToolInvocationCapsuleReceipt,
} from "../src/tool-invocation-capsule.js";
import {
  MAX_TOOL_INVOCATION_RESULT_CAPSULES,
  ToolInvocationResultCapsuleStore,
} from "../src/tool-invocation-result-capsule-store.js";
import { createToolInvocationResultCapsule } from "../src/tool-invocation-result-capsule.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Tool invocation result capsule store", () => {
  it("rejects result details that JSON serialization would change", () => {
    const invocation = createToolInvocationCapsule({
      sourceThreadId: "thread_result12345678",
      sourceRunId: "run_result_12345678",
      callId: "call_result_non_json",
      toolName: "read_file",
      toolDefinitionSha256: "1".repeat(64),
      arguments: { path: "fixture.txt" },
    });
    expect(() =>
      createToolInvocationResultCapsule({
        sourceThreadId: invocation.sourceThreadId,
        sourceRunId: invocation.sourceRunId,
        invocation: createToolInvocationCapsuleReceipt(invocation),
        result: {
          content: [{ type: "text", text: "result" }],
          details: { value: Number.NaN },
        },
        isError: false,
      }),
    ).toThrow("non-finite");
    expect(() =>
      createToolInvocationResultCapsule({
        sourceThreadId: invocation.sourceThreadId,
        sourceRunId: invocation.sourceRunId,
        invocation: createToolInvocationCapsuleReceipt(invocation),
        result: {
          content: [{ type: "text", text: "result" }],
          details: { value: undefined },
        },
        isError: false,
      }),
    ).toThrow("not exact JSON");
  });

  it("keeps concurrent private results within the exact object bound", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-tool-result-capsules-"),
    );
    temporaryRoots.push(root);
    const store = new ToolInvocationResultCapsuleStore(root);
    const attempts = await Promise.allSettled(
      Array.from(
        { length: MAX_TOOL_INVOCATION_RESULT_CAPSULES + 8 },
        async (_, index) => {
          const callId = `call_result_${String(index).padStart(4, "0")}`;
          const invocation = createToolInvocationCapsule({
            sourceThreadId: "thread_result12345678",
            sourceRunId: "run_result_12345678",
            callId,
            toolName: "read_file",
            toolDefinitionSha256: "1".repeat(64),
            arguments: { path: `fixture-${String(index)}.txt` },
          });
          return store.put({
            sourceThreadId: invocation.sourceThreadId,
            sourceRunId: invocation.sourceRunId,
            invocation: createToolInvocationCapsuleReceipt(invocation),
            result: {
              content: [
                {
                  type: "text",
                  text: `private result ${String(index)}`,
                },
              ],
              details: { index },
            },
            isError: false,
          });
        },
      ),
    );
    expect(
      attempts.filter((attempt) => attempt.status === "fulfilled"),
    ).toHaveLength(MAX_TOOL_INVOCATION_RESULT_CAPSULES);
    expect(
      attempts.filter((attempt) => attempt.status === "rejected"),
    ).toHaveLength(8);
    const entries = await readdir(store.rootPath);
    expect(entries).toHaveLength(MAX_TOOL_INVOCATION_RESULT_CAPSULES);
    expect((await stat(store.rootPath)).mode & 0o777).toBe(0o700);
    for (const entry of entries.slice(0, 8)) {
      expect((await stat(path.join(store.rootPath, entry))).mode & 0o777).toBe(
        0o600,
      );
    }
  });
});
