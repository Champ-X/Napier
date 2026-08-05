import type { ThreadDetail } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { activeRunViewState } from "../src/active-run-view-state";

describe("active Run Web state", () => {
  it("restores only the authoritative current running Run", () => {
    expect(
      activeRunViewState(
        detail("run_active", [
          run("run_old", "completed"),
          run("run_active", "running"),
        ]),
      ),
    ).toEqual({ activeRunId: "run_active", isRunning: true });
  });

  it("fails closed on stale, terminal, or absent current Run pointers", () => {
    expect(
      activeRunViewState(
        detail("run_terminal", [
          run("run_terminal", "completed"),
          run("run_other", "running"),
        ]),
      ),
    ).toEqual({ activeRunId: undefined, isRunning: false });
    expect(activeRunViewState(detail("run_missing", []))).toEqual({
      activeRunId: undefined,
      isRunning: false,
    });
    expect(activeRunViewState(undefined)).toEqual({
      activeRunId: undefined,
      isRunning: false,
    });
  });
});

function detail(
  currentRunId: string,
  runs: ThreadDetail["runs"],
): Pick<ThreadDetail, "thread" | "runs"> {
  return {
    thread: {
      id: "thread_active",
      title: "Active Run",
      agentId: "agent_active",
      status: "running",
      createdAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z",
      lastMessage: "",
      eventCount: 0,
      currentRunId,
      runIds: runs.map((candidate) => candidate.id),
    },
    runs,
  };
}

function run(
  id: string,
  status: "running" | "completed",
): ThreadDetail["runs"][number] {
  return {
    id,
    threadId: "thread_active",
    agentId: "agent_active",
    status,
    source: "user",
    startedAt: "2026-08-05T00:00:00.000Z",
    ...(status === "completed"
      ? { finishedAt: "2026-08-05T00:00:01.000Z" }
      : {}),
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    },
  };
}
