import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ToolInvocationProtocolV2 } from "@napier/contracts";
import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";

import {
  permitsCapturedToolExecutionResultReplay,
  reconcileCapturedToolExecutionResult,
  repairDurableToolExecutionFromCapturedResult,
} from "../src/durable-tool-execution.js";
import { toolExecutionResultEffect } from "../src/tool-execution-result-effect.js";
import type { LocalStore } from "../src/store.js";
import {
  ToolProtocolRegistry,
  type OwnedToolRecordV2,
} from "../src/tool-protocol-registry.js";
import { defineReplayableTestReadTool } from "./self-describing-tool-test-support.js";

describe("durable tool result replay policy", () => {
  it("settles multimodal results even when exact-result replay declines them", () => {
    expect(
      toolExecutionResultEffect(
        "call_screenshot",
        {
          content: [
            { type: "text", text: "captured" },
            { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
          ],
          details: { action: "screenshot" },
        },
        false,
      ),
    ).toEqual(
      expect.objectContaining({
        outcome: "succeeded",
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
  });

  it("permits only an exact-result replay protocol", () => {
    const registry = new ToolProtocolRegistry([
      defineReplayableTestReadTool(tool("read_file")),
      tool("workspace_file_preview"),
      tool("workspace_file_apply"),
      tool("publish_release"),
    ]);
    const irreversible = withInvocationPolicy(
      registry.require("publish_release"),
      {
        sideEffect: "irreversible",
        idempotency: { key: "none", resultReplay: "never" },
      },
    );

    expect(
      permitsCapturedToolExecutionResultReplay({
        args: { path: "evidence.txt" },
        protocol: registry.require("read_file"),
      }),
    ).toBe(true);
    expect(
      permitsCapturedToolExecutionResultReplay({
        args: { action: "list_trash" },
        protocol: registry.require("workspace_file_preview"),
      }),
    ).toBe(false);
    expect(
      permitsCapturedToolExecutionResultReplay({
        args: { previewId: "filepreview_12345678" },
        protocol: registry.require("workspace_file_apply"),
      }),
    ).toBe(false);
    expect(
      permitsCapturedToolExecutionResultReplay({
        args: { release: "production" },
        protocol: irreversible,
      }),
    ).toBe(false);
  });

  it.each([
    ["native preview", "workspace_file_preview", { action: "list_trash" }],
    [
      "preview-token mutation",
      "workspace_file_apply",
      { previewId: "filepreview_12345678" },
    ],
  ])(
    "fails closed before reading evidence for %s",
    async (_label, name, args) => {
      const protocol = new ToolProtocolRegistry([tool(name)]).require(name);
      const listRunEvents = vi.fn();
      const input = {
        store: { listRunEvents } as unknown as LocalStore,
        run: { id: "run_replay_policy", threadId: "thread_replay_policy" },
        callId: `call_${name}`,
        toolName: name,
        args,
        protocol,
      };
      const captured = {
        result: {
          content: [{ type: "text" as const, text: "cached" }],
          details: {},
        },
        isError: false,
        resultEvidenceSha256: "a".repeat(64),
      };
      await expect(
        repairDurableToolExecutionFromCapturedResult(input, captured),
      ).resolves.toEqual({ disposition: "not_repairable" });
      await expect(
        reconcileCapturedToolExecutionResult(
          input,
          "terminal_replay",
          captured,
        ),
      ).resolves.toBe(false);
      expect(listRunEvents).not.toHaveBeenCalled();
    },
  );
});

function tool(name: string): AgentTool {
  return {
    name,
    label: name,
    description: name,
    parameters: Type.Object({}, { additionalProperties: true }),
    execute: async () => ({ content: [], details: {} }),
  };
}

function withInvocationPolicy(
  record: OwnedToolRecordV2,
  override: Pick<ToolInvocationProtocolV2, "idempotency" | "sideEffect">,
): OwnedToolRecordV2 {
  return {
    ...record,
    invocation: (input) => ({ ...record.invocation(input), ...override }),
  };
}
