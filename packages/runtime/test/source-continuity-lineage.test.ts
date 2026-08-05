import type { RunRecord, ThreadImportProvenance } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  SOURCE_CONTINUITY_RETENTION_MS,
  sourceContinuityPredecessor,
} from "../src/source-continuity-lineage.js";

const THREAD_ID = "thread_continuity";
const AGENT_ID = "agent_continuity";

describe("Source continuity lineage", () => {
  it("selects an interrupted recovery parent", () => {
    const parent = run("run_parent0001", "interrupted", "user", 0);
    const current = run("run_current001", "running", "recovery", 2, {
      parentRunId: parent.id,
    });

    expect(predecessor([parent, current], current.id)).toEqual(parent);
  });

  it("rejects a cross-Agent recovery parent without blocking explicit imported recovery", () => {
    const parent = run("run_parent0002", "interrupted", "user", 0);
    const current = run("run_current008", "running", "recovery", 2, {
      parentRunId: parent.id,
    });

    expect(() =>
      predecessor([parent, { ...current, agentId: "agent_other" }], current.id),
    ).toThrow("Source continuity recovery parent is invalid");
    expect(
      predecessor([parent, current], current.id, importProvenance()),
    ).toEqual(parent);
  });

  it("selects only the immediately previous recent completed user lineage", () => {
    const previous = run("run_previous01", "completed", "user", 0, {
      finishedAt: iso(1),
    });
    const current = run("run_current002", "running", "user", 2);

    expect(predecessor([previous, current], current.id)).toEqual(previous);
    expect(
      predecessor(
        [
          previous,
          run("run_workflow003", "completed", "workflow", 1, {
            finishedAt: iso(1.5),
          }),
          current,
        ],
        current.id,
      ),
    ).toBeUndefined();
  });

  it("allows settled current Runs only for Replay validation", () => {
    const previous = run("run_previous03", "completed", "user", 0, {
      finishedAt: iso(1),
    });
    const current = run("run_current006", "completed", "user", 2, {
      finishedAt: iso(3),
    });

    expect(predecessor([previous, current], current.id)).toBeUndefined();
    expect(
      predecessor([previous, current], current.id, undefined, {
        allowSettledCurrent: true,
      }),
    ).toEqual(previous);
    expect(
      predecessor(
        [previous, run("run_current007", "queued", "user", 2)],
        "run_current007",
        undefined,
        { allowSettledCurrent: true },
      ),
    ).toBeUndefined();
  });

  it("rejects expired, imported, parented, and cross-Agent continuations", () => {
    const expired = run("run_expired001", "completed", "user", 0, {
      finishedAt: new Date(
        Date.parse(iso(2)) - SOURCE_CONTINUITY_RETENTION_MS - 1,
      ).toISOString(),
    });
    const current = run("run_current003", "running", "user", 2);
    expect(predecessor([expired, current], current.id)).toBeUndefined();

    const previous = run("run_previous02", "completed", "user", 0, {
      finishedAt: iso(1),
    });
    expect(
      predecessor([previous, current], current.id, importProvenance()),
    ).toBeUndefined();
    expect(
      predecessor(
        [
          previous,
          run("run_current004", "running", "user", 2, {
            parentRunId: previous.id,
          }),
        ],
        "run_current004",
      ),
    ).toBeUndefined();
    expect(
      predecessor(
        [
          { ...previous, agentId: "agent_other" },
          run("run_current005", "running", "user", 2),
        ],
        "run_current005",
      ),
    ).toBeUndefined();
  });
});

function predecessor(
  runs: RunRecord[],
  runId: string,
  importState?: ThreadImportProvenance,
  options?: { allowSettledCurrent?: boolean },
) {
  return sourceContinuityPredecessor(
    {
      listRuns: () => runs,
      getThread: () => ({
        ...(importState ? { importProvenance: importState } : {}),
      }),
    },
    { threadId: THREAD_ID, runId },
    options,
  );
}

function run(
  id: string,
  status: RunRecord["status"],
  source: NonNullable<RunRecord["source"]>,
  hour: number,
  overrides: Partial<RunRecord> = {},
): RunRecord {
  return {
    id,
    threadId: THREAD_ID,
    agentId: AGENT_ID,
    status,
    source,
    startedAt: iso(hour),
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    },
    ...overrides,
  };
}

function iso(hour: number): string {
  return new Date(Date.UTC(2026, 7, 5, hour)).toISOString();
}

function importProvenance(): ThreadImportProvenance {
  return {
    sourceThreadId: "thread_source",
    sourceApiVersion: "0.1.0",
    sourceContentSha256: "a".repeat(64),
    sourceEventStreamSha256: "b".repeat(64),
    sourceEventCount: 1,
    importedAt: iso(0),
  };
}
