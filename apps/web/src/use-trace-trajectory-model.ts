import { useEffect, useMemo, useRef, useState } from "react";

import type { RunEvent, RunRecord } from "@napier/contracts";
import {
  createTraceTrajectoryModel,
  type TraceTrajectoryModel,
} from "./trace-trajectory-model";
import type {
  TraceTrajectoryWorkerRequest,
  TraceTrajectoryWorkerResponse,
} from "./trace-trajectory-worker";

export const TRACE_TRAJECTORY_WORKER_THRESHOLD = 5_000;

interface AsyncProjection {
  events: readonly RunEvent[];
  runs: readonly RunRecord[];
  model: TraceTrajectoryModel;
}

export interface TraceTrajectoryProjection {
  model: TraceTrajectoryModel | undefined;
  pending: boolean;
}

export function useTraceTrajectoryModel(
  events: RunEvent[],
  runs: RunRecord[],
): TraceTrajectoryProjection {
  const requestIdRef = useRef(0);
  const [asyncProjection, setAsyncProjection] = useState<AsyncProjection>();
  const synchronousModel = useMemo(
    () =>
      events.length < TRACE_TRAJECTORY_WORKER_THRESHOLD
        ? createTraceTrajectoryModel(events, runs)
        : undefined,
    [events, runs],
  );

  useEffect(() => {
    if (events.length < TRACE_TRAJECTORY_WORKER_THRESHOLD) {
      setAsyncProjection((current) =>
        current === undefined ? current : undefined,
      );
      return;
    }

    const requestId = ++requestIdRef.current;
    setAsyncProjection((current) =>
      current?.events === events && current.runs === runs ? current : undefined,
    );
    let active = true;
    let fallbackStarted = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    let worker: Worker | undefined;

    const finish = (model: TraceTrajectoryModel) => {
      if (!active || requestId !== requestIdRef.current) return;
      setAsyncProjection({ events, runs, model });
    };
    const fallback = () => {
      if (fallbackStarted) return;
      fallbackStarted = true;
      worker?.terminate();
      worker = undefined;
      fallbackTimer = setTimeout(() => {
        if (!active || requestId !== requestIdRef.current) return;
        finish(createTraceTrajectoryModel(events, runs));
      }, 0);
    };

    if (typeof Worker === "undefined") {
      fallback();
    } else {
      try {
        worker = new Worker(
          new URL("./trace-trajectory-worker.ts", import.meta.url),
          { type: "module", name: "napier-trace-projector" },
        );
        worker.onmessage = (
          event: MessageEvent<TraceTrajectoryWorkerResponse>,
        ) => {
          if (event.data.requestId !== requestId) return;
          if (!event.data.ok) {
            fallback();
            return;
          }
          worker?.terminate();
          worker = undefined;
          finish(event.data.model);
        };
        worker.onerror = (event) => {
          event.preventDefault();
          fallback();
        };
        const request: TraceTrajectoryWorkerRequest = {
          requestId,
          events,
          runs,
        };
        worker.postMessage(request);
      } catch {
        fallback();
      }
    }

    return () => {
      active = false;
      worker?.terminate();
      if (fallbackTimer !== undefined) clearTimeout(fallbackTimer);
    };
  }, [events, runs]);

  if (synchronousModel) return { model: synchronousModel, pending: false };
  if (asyncProjection?.events === events && asyncProjection.runs === runs) {
    return { model: asyncProjection.model, pending: false };
  }
  return { model: undefined, pending: true };
}
