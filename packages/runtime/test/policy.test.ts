import { describe, expect, it } from "vitest";

import { assessToolCall, isPathInsideWorkspace } from "../src/policy.js";

describe("workspace policy", () => {
  it("confines addressed paths to the workspace", () => {
    expect(isPathInsideWorkspace("src/index.ts", "/workspace")).toBe(true);
    expect(isPathInsideWorkspace("../secrets.txt", "/workspace")).toBe(false);
    expect(isPathInsideWorkspace("/etc/passwd", "/workspace")).toBe(false);
  });

  it("allows reads and blocks writes in observe mode", () => {
    expect(
      assessToolCall(
        "observe",
        "read_file",
        { path: "README.md" },
        "/workspace",
      ).allowed,
    ).toBe(true);
    expect(
      assessToolCall(
        "observe",
        "apply_patch",
        { path: "README.md" },
        "/workspace",
      ).allowed,
    ).toBe(false);
    expect(
      assessToolCall(
        "workspace",
        "apply_patch",
        { path: "README.md" },
        "/workspace",
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        risk: "medium",
        reason: "workspace-scoped write",
      }),
    );
    expect(
      assessToolCall(
        "workspace",
        "apply_patch",
        { path: "../README.md" },
        "/workspace",
      ).allowed,
    ).toBe(false);
    expect(
      assessToolCall(
        "observe",
        "workspace_process",
        { action: "start", runtime: "node", args: ["--version"] },
        "/workspace",
      ).allowed,
    ).toBe(false);
    expect(
      assessToolCall(
        "workspace",
        "workspace_process",
        {
          action: "start",
          runtime: "node",
          args: ["--version"],
          cwd: "packages/runtime",
        },
        "/workspace",
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        risk: "high",
        reason: "bounded background Process Session lifecycle",
      }),
    );
    expect(
      assessToolCall(
        "workspace",
        "apply_patch",
        { path: ".git/config" },
        "/workspace",
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: false,
        risk: "high",
        reason: expect.stringContaining("protected path segment"),
      }),
    );
    expect(assessToolCall("observe", "create_plan", {}, "/workspace")).toEqual(
      expect.objectContaining({
        allowed: true,
        risk: "low",
        reason: "internal durable-ledger update",
      }),
    );
    expect(
      assessToolCall("observe", "record_run_milestone", {}, "/workspace"),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        risk: "low",
        reason: "internal durable-ledger update",
      }),
    );
    expect(
      assessToolCall(
        "observe",
        "verify_workspace",
        { kind: "typecheck" },
        "/workspace",
      ).allowed,
    ).toBe(false);
    expect(
      assessToolCall(
        "workspace",
        "verify_workspace",
        { kind: "test", cwd: "packages/runtime" },
        "/workspace",
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        risk: "medium",
        reason: "read-only sandboxed verification",
      }),
    );
    expect(
      assessToolCall(
        "observe",
        "run_command",
        { runtime: "node", args: ["--version"] },
        "/workspace",
      ).allowed,
    ).toBe(false);
    expect(
      assessToolCall(
        "workspace",
        "run_command",
        { runtime: "node", args: ["--version"], cwd: "packages/runtime" },
        "/workspace",
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        risk: "medium",
        reason: "read-only sandboxed command execution",
      }),
    );
    expect(
      assessToolCall(
        "workspace",
        "run_command",
        { runtime: "node", args: ["--version"], cwd: "../outside" },
        "/workspace",
      ).allowed,
    ).toBe(false);
    expect(
      assessToolCall(
        "workspace",
        "verify_workspace",
        { kind: "test", cwd: "../outside" },
        "/workspace",
      ).allowed,
    ).toBe(false);
  });

  it("blocks destructive shell commands even in unrestricted mode", () => {
    const decision = assessToolCall(
      "unrestricted",
      "bash",
      { command: "git reset --hard HEAD~1" },
      "/workspace",
    );
    expect(decision.allowed).toBe(false);
    expect(decision.risk).toBe("critical");
  });
});
