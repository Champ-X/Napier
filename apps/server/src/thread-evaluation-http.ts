import type { LocalStore } from "@napier/runtime";
import { Hono } from "hono";

import {
  setContextCheckpointCalibrationHeaders,
  setEvaluationAdjudicationListHeaders,
  setEvaluationCalibrationHeaders,
  setRunEvaluationListHeaders,
} from "./thread-evaluation-http-response.js";

type ThreadEvaluationHttpStore = Pick<
  LocalStore,
  | "getContextCheckpointCalibration"
  | "getEvaluationCalibration"
  | "getThread"
  | "listEvaluationAdjudications"
  | "listRunEvaluations"
>;

export function registerThreadEvaluationHttp(
  app: Hono,
  store: ThreadEvaluationHttpStore,
): void {
  app.get("/api/threads/:threadId/evaluations", (context) => {
    const threadId = context.req.param("threadId");
    store.getThread(threadId);
    const evaluations = store.listRunEvaluations(threadId);
    setRunEvaluationListHeaders(context, threadId, evaluations);
    return context.json(evaluations);
  });

  app.get("/api/threads/:threadId/evaluation-adjudications", (context) => {
    const threadId = context.req.param("threadId");
    store.getThread(threadId);
    const adjudications = store.listEvaluationAdjudications(threadId);
    setEvaluationAdjudicationListHeaders(context, threadId, adjudications);
    return context.json(adjudications);
  });

  app.get("/api/threads/:threadId/evaluation-calibration", (context) => {
    const report = store.getEvaluationCalibration(
      context.req.param("threadId"),
    );
    setEvaluationCalibrationHeaders(context, report);
    return context.json(report);
  });

  app.get(
    "/api/threads/:threadId/context-checkpoint-calibration",
    async (context) => {
      const report = await store.getContextCheckpointCalibration(
        context.req.param("threadId"),
      );
      setContextCheckpointCalibrationHeaders(context, report);
      return context.json(report);
    },
  );
}
