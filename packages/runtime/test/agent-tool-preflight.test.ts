import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { claimedUnavailableCapabilityTools } from "../src/agent-tool-preflight.js";
import { unresolvedCapabilityClaim } from "../src/capability-availability-guard.js";

describe("Agent tool capability-block preflight", () => {
  it("maps the reported Chinese false blocker to recoverable tools", () => {
    expect(
      claimedUnavailableCapabilityTools({
        header: "能力受限",
        question:
          "工作区没有源码，且我当前没有网络/命令行拉取能力（web_search、web_fetch、run_command、apply_patch、git_* 均不可用）。",
        options: [],
      }),
    ).toEqual(
      expect.arrayContaining([
        "workspace_process",
        "web_search",
        "web_fetch",
        "browser",
        "run_command",
        "apply_patch",
        "git_inspect",
      ]),
    );
  });

  it("does not reinterpret a genuine product-scope decision as a capability blocker", () => {
    expect(
      claimedUnavailableCapabilityTools({
        header: "Scope",
        question: "Which scope should the implementation use?",
        options: [
          { label: "Runtime", description: "Implement the runtime only." },
          { label: "Product", description: "Implement the full product." },
        ],
      }),
    ).toEqual([]);
  });

  it("binds an unavailable assertion to the nearby capability instead of the whole message", () => {
    expect(
      claimedUnavailableCapabilityTools(
        "没有找到源码，但可以使用 workspace_process 和 web_search 继续。",
      ),
    ).toEqual([]);
    expect(
      claimedUnavailableCapabilityTools(
        "workspace_process is available, but the requested source file is missing.",
      ),
    ).toEqual([]);
    expect(
      claimedUnavailableCapabilityTools(
        "workspace_process is unavailable, but web_search is available.",
      ),
    ).toEqual(["workspace_process"]);
  });

  it("distinguishes policy blocks and permanent unavailability from correctable failures", () => {
    const base = {
      args: "workspace_process 不可用。",
      activeToolNames: new Set(["workspace_process"]),
      runtimeAvailableToolNames: new Set(["workspace_process"]),
    };
    expect(
      unresolvedCapabilityClaim({
        ...base,
        events: [terminal("tool.failed", { errorCode: "invalid_arguments" })],
      })?.usableNow,
    ).toEqual(["workspace_process"]);
    expect(
      unresolvedCapabilityClaim({
        ...base,
        events: [terminal("tool.blocked", { policyReason: "network denied" })],
      })?.usableNow,
    ).toEqual([]);
    expect(
      unresolvedCapabilityClaim({
        ...base,
        events: [
          terminal("tool.failed", { details: { status: "unavailable" } }),
        ],
      })?.usableNow,
    ).toEqual([]);
  });
});

function terminal(
  type: "tool.failed" | "tool.blocked",
  details: Record<string, unknown>,
): RunEvent {
  return {
    id: `event_${type}`,
    threadId: "thread_guard",
    runId: "run_guard",
    seq: 1,
    type,
    category: "tool",
    visibility: "user",
    createdAt: "2026-09-02T00:00:00.000Z",
    payload: {
      callId: "call_guard",
      toolName: "workspace_process",
      status: type === "tool.failed" ? "failed" : "blocked",
      ...details,
    },
  } as RunEvent;
}
