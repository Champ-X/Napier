import { parseHTML } from "linkedom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RunEvent, RunRecord } from "@napier/contracts";
import { createTraceTrajectoryModel } from "../src/trace-trajectory-model";
import type {
  TraceTrajectoryWorkerRequest,
  TraceTrajectoryWorkerResponse,
} from "../src/trace-trajectory-worker";
import {
  TRACE_TRAJECTORY_WORKER_THRESHOLD,
  useTraceTrajectoryModel,
} from "../src/use-trace-trajectory-model";

const roots: Root[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useTraceTrajectoryModel", () => {
  it("projects small traces synchronously without creating a Worker", async () => {
    const Worker = vi.fn();
    vi.stubGlobal("Worker", Worker);
    const probe = await mountProbe(createEvents(4));

    expect(probe.read()).toEqual({ pending: false, eventCount: 4 });
    expect(Worker).not.toHaveBeenCalled();
  });

  it("routes traces above the threshold through the dedicated Worker", async () => {
    const instances: FakeWorker[] = [];
    class FakeWorker {
      onmessage:
        | ((event: MessageEvent<TraceTrajectoryWorkerResponse>) => void)
        | null = null;
      onerror: (() => void) | null = null;
      request: TraceTrajectoryWorkerRequest | undefined;
      terminated = false;

      constructor() {
        instances.push(this);
      }

      postMessage(request: TraceTrajectoryWorkerRequest) {
        this.request = request;
      }

      terminate() {
        this.terminated = true;
      }
    }
    vi.stubGlobal("Worker", FakeWorker);
    const events = createEvents(TRACE_TRAJECTORY_WORKER_THRESHOLD);
    const probe = await mountProbe(events);

    expect(probe.read()).toEqual({ pending: true, eventCount: 0 });
    expect(instances).toHaveLength(1);
    expect(instances[0]?.request?.events).toBe(events);

    const requestId = instances[0]?.request?.requestId;
    const model = createTraceTrajectoryModel(events, [run]);
    await act(async () => {
      instances[0]?.onmessage?.({
        data: { requestId: requestId!, ok: true, model },
      } as MessageEvent<TraceTrajectoryWorkerResponse>);
    });

    expect(probe.read()).toEqual({
      pending: false,
      eventCount: TRACE_TRAJECTORY_WORKER_THRESHOLD,
    });
    expect(instances[0]?.terminated).toBe(true);
  });

  it("falls back asynchronously when Worker is unavailable", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", undefined);
    const events = createEvents(TRACE_TRAJECTORY_WORKER_THRESHOLD);
    const probe = await mountProbe(events);

    expect(probe.read()).toEqual({ pending: true, eventCount: 0 });
    await act(async () => vi.runAllTimers());
    expect(probe.read()).toEqual({
      pending: false,
      eventCount: TRACE_TRAJECTORY_WORKER_THRESHOLD,
    });
  });
});

const run: RunRecord = {
  id: "run_trace_worker",
  threadId: "thread_trace_worker",
  agentId: "agent_trace_worker",
  status: "completed",
  startedAt: "2026-08-27T08:00:00.000Z",
  finishedAt: "2026-08-27T08:01:00.000Z",
  usage: {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  },
};

async function mountProbe(events: RunEvent[]) {
  const container = installDom();
  const root = createRoot(container);
  const runs = [run];
  roots.push(root);

  function Probe() {
    const projection = useTraceTrajectoryModel(events, runs);
    return (
      <div
        data-pending={String(projection.pending)}
        data-event-count={String(projection.model?.eventCount ?? 0)}
      />
    );
  }

  await act(async () => root.render(<Probe />));
  return {
    read: () => ({
      pending:
        container.firstElementChild?.getAttribute("data-pending") === "true",
      eventCount: Number(
        container.firstElementChild?.getAttribute("data-event-count"),
      ),
    }),
  };
}

function createEvents(count: number): RunEvent[] {
  const startedAt = Date.parse(run.startedAt);
  return Array.from({ length: count }, (_, offset) => ({
    id: `event_worker_${String(offset + 1)}`,
    threadId: run.threadId,
    runId: run.id,
    seq: offset + 1,
    type: "context.prepared",
    category: "model",
    visibility: "debug",
    createdAt: new Date(startedAt + offset).toISOString(),
    payload: { sequence: offset + 1 },
  }));
}

function installDom(): HTMLElement {
  const { document, window } = parseHTML(
    "<!doctype html><html><body><div id=app></div></body></html>",
  );
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Event", window.Event);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  return document.getElementById("app") as unknown as HTMLElement;
}
