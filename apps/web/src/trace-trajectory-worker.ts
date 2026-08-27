import type { RunEvent, RunRecord } from "@napier/contracts";

import {
  createTraceTrajectoryModel,
  type TraceTrajectoryModel,
} from "./trace-trajectory-model";

export interface TraceTrajectoryWorkerRequest {
  requestId: number;
  events: RunEvent[];
  runs: RunRecord[];
}

export type TraceTrajectoryWorkerResponse =
  | {
      requestId: number;
      ok: true;
      model: TraceTrajectoryModel;
    }
  | {
      requestId: number;
      ok: false;
      error: string;
    };

interface TraceTrajectoryWorkerScope {
  onmessage:
    | ((event: MessageEvent<TraceTrajectoryWorkerRequest>) => void)
    | null;
  postMessage(message: TraceTrajectoryWorkerResponse): void;
}

const workerScope = globalThis as unknown as TraceTrajectoryWorkerScope;

workerScope.onmessage = ({ data }) => {
  try {
    workerScope.postMessage({
      requestId: data.requestId,
      ok: true,
      model: createTraceTrajectoryModel(data.events, data.runs),
    });
  } catch (error) {
    workerScope.postMessage({
      requestId: data.requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
