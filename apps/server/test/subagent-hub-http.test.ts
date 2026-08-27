import { createHash } from "node:crypto";

import type {
  SubagentHubActionResultV1,
  SubagentHubProjectionV1,
} from "@napier/contracts/subagent-hub";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { registerThreadOperationsHttp } from "../src/thread-operations-http.js";

const THREAD_ID = "thread_hub_http";
const TASK_ID = "task_hub_http";

describe("Subagent Hub HTTP", () => {
  it.each([
    {
      action: "steer" as const,
      request: {
        kind: "napier.subagent-hub-steer-request",
        schemaVersion: 1,
        expectedTaskRevision: 4,
        messageKind: "steering",
        text: "Inspect the durable boundary.",
      },
    },
    {
      action: "cancel" as const,
      request: {
        kind: "napier.subagent-hub-cancel-request",
        schemaVersion: 1,
        expectedTaskRevision: 4,
        reason: "The requirement changed.",
      },
    },
    {
      action: "revive" as const,
      request: {
        kind: "napier.subagent-hub-revive-request",
        schemaVersion: 1,
        expectedTaskRevision: 4,
      },
    },
  ])(
    "returns a hash-bound refreshed Hub after $action",
    async ({ action, request }) => {
      const result = actionResult(action);
      const control = vi.fn(async () => result);
      const hub = projection();
      const services = servicesWith({ [action]: control, hub });
      const app = new Hono();
      registerThreadOperationsHttp(app, services as never);

      const response = await app.request(
        `/api/threads/${THREAD_ID}/subagents/${TASK_ID}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        },
      );
      const body = {
        kind: "napier.subagent-hub-action-response",
        schemaVersion: 1,
        result,
        hub,
      };

      expect(response.status).toBe(202);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-napier-content-sha256-mode")).toBe("body");
      expect(response.headers.get("x-napier-content-sha256")).toBe(
        createHash("sha256").update(JSON.stringify(body)).digest("hex"),
      );
      expect(response.headers.get("x-napier-subagent-action")).toBe(action);
      expect(response.headers.get("x-napier-subagent-task-id")).toBe(TASK_ID);
      expect(await response.json()).toEqual(body);
      expect(control).toHaveBeenCalledWith(THREAD_ID, TASK_ID, request);
      expect(
        services.kernel.conversationSubagents.projectHub,
      ).toHaveBeenCalledWith(THREAD_ID, expect.any(Function));
    },
  );

  it("rejects invalid bodies before control and maps stale revisions to conflict", async () => {
    const steer = vi.fn(async () => {
      throw new Error("Subagent task revision changed; refresh and retry");
    });
    const services = servicesWith({ steer });
    const app = new Hono();
    registerThreadOperationsHttp(app, services as never);
    const path = `/api/threads/${THREAD_ID}/subagents/${TASK_ID}/steer`;

    const invalid = await app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedTaskRevision: 0, text: "PRIVATE" }),
    });
    expect(invalid.status).toBe(400);
    expect(steer).not.toHaveBeenCalled();
    expect(JSON.stringify(await invalid.json())).not.toContain("PRIVATE");

    const stale = await app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "napier.subagent-hub-steer-request",
        schemaVersion: 1,
        expectedTaskRevision: 4,
        messageKind: "input",
        text: "Continue.",
      }),
    });
    expect(stale.status).toBe(409);
    expect(stale.headers.get("cache-control")).toBe("no-store");
  });
});

function servicesWith(input: {
  steer?: ReturnType<typeof vi.fn>;
  cancel?: ReturnType<typeof vi.fn>;
  revive?: ReturnType<typeof vi.fn>;
  hub?: SubagentHubProjectionV1;
}) {
  return {
    store: {},
    models: {},
    workspaceFileMutations: {},
    kernel: {
      conversationSubagents: {
        projectHub: vi.fn(async () => ({ view: input.hub ?? projection() })),
      },
    },
    subagentHubControls: {
      availability: vi.fn(() => ({
        steer: false,
        cancel: false,
        revive: false,
      })),
      steer: input.steer ?? vi.fn(async () => actionResult("steer")),
      cancel: input.cancel ?? vi.fn(async () => actionResult("cancel")),
      revive: input.revive ?? vi.fn(async () => actionResult("revive")),
    },
  };
}

function actionResult(
  action: SubagentHubActionResultV1["action"],
): SubagentHubActionResultV1 {
  return {
    kind: "napier.subagent-hub-action-result",
    schemaVersion: 1,
    action,
    sourceTaskId: TASK_ID,
    sourceTaskRevision: 4,
    taskId: TASK_ID,
    acceptedAt: "2026-08-26T00:00:00.000Z",
  };
}

function projection(): SubagentHubProjectionV1 {
  return {
    kind: "napier.subagent-hub-projection",
    schemaVersion: 1,
    threadId: THREAD_ID,
    taskCount: 0,
    selectedTaskCount: 0,
    activeTaskCount: 0,
    terminalTaskCount: 0,
    orphanedTaskCount: 0,
    omittedTaskCount: 0,
    eventWatermark: 0,
    tasks: [],
  };
}
