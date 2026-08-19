import { describe, expect, it } from "vitest";

import { EnvironmentDegradationNotice } from "../src/EnvironmentDegradationNotice";
import {
  environmentDegradationView,
  parseEnvironmentDegradationEvent,
} from "../src/environment-degradation-view";

describe("Environment degradation task notice", () => {
  it("parses strict receipt evidence and renders the L0 fallback", () => {
    const event = degradationEvent();
    const detail = {
      thread: { currentRunId: "run_degraded" },
      runs: [{ id: "run_degraded" }],
      events: [event],
    } as never;
    const view = environmentDegradationView(detail);
    const text = visibleText(EnvironmentDegradationNotice({ detail }));

    expect(view).toEqual(
      expect.objectContaining({
        activeToolCount: 14,
        configuredToolCount: 42,
        omittedToolCount: 28,
        sandboxId: "unsupported",
      }),
    );
    expect(text).toContain("Read-only environment fallback");
    expect(text).toContain("14 / 42 tools active");
    expect(text).toContain("Run options → Sandbox setup");
    expect(text).not.toContain("run_command");
  });

  it("rejects count drift instead of presenting untrusted evidence", () => {
    const event = degradationEvent();
    const payload = event.payload as Record<string, unknown>;
    expect(
      parseEnvironmentDegradationEvent({
        ...event,
        payload: { ...payload, configuredToolCount: 43 },
      } as never),
    ).toBeUndefined();
  });
});

function degradationEvent() {
  return {
    type: "run.environment.negotiated",
    runId: "run_degraded",
    payload: {
      kind: "napier.environment-capability-negotiation",
      schemaVersion: 1,
      status: "degraded_read_only",
      executionMode: "environment_degraded_read_only",
      reason: "sandbox_unavailable",
      sandboxId: "unsupported",
      readinessId: "sandbox:unsupported",
      readinessDetailSha256: "a".repeat(64),
      configuredToolCount: 42,
      activeToolCount: 14,
      activeToolNames: Array.from(
        { length: 14 },
        (_, index) => `read_${index}`,
      ),
      omittedToolNames: Array.from(
        { length: 28 },
        (_, index) => `tool_${index}`,
      ),
      repairComponent: "sandbox",
      repairCommand:
        "napier setup --workspace 'WORKSPACE_PATH' --component sandbox",
      contentSha256: "b".repeat(64),
    },
  };
}

function visibleText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(visibleText).join("");
  if (!value || typeof value !== "object") return "";
  const props = (value as { props?: { children?: unknown } }).props;
  return props ? visibleText(props.children) : "";
}
