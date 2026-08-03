import type { Context, Hono } from "hono";

import {
  createEvaluationCasebookQualificationReceipt,
  createEvaluationSuiteGateReceipt,
  type LocalStore,
} from "@napier/runtime";

type EvaluationCatalogStore = Pick<
  LocalStore,
  | "exportEvaluationCasebook"
  | "getEvaluationCasebook"
  | "getEvaluationCasebookCalibration"
  | "getThread"
  | "listEvaluationCasebookQualificationExecutions"
  | "listEvaluationCasebooks"
  | "listEvaluationQualificationBaselines"
  | "listEvaluationSuiteExecutions"
  | "listEvaluationSuites"
> &
  Parameters<typeof createEvaluationCasebookQualificationReceipt>[0] &
  Parameters<typeof createEvaluationSuiteGateReceipt>[0];

type StoreResult<Key extends keyof EvaluationCatalogStore> = ReturnType<
  EvaluationCatalogStore[Key]
>;

export interface EvaluationCatalogHttpResponses {
  setCasebookListHeaders(
    context: Context,
    value: StoreResult<"listEvaluationCasebooks">,
  ): void;
  setCasebookHeaders(
    context: Context,
    value: StoreResult<"getEvaluationCasebook">,
  ): void;
  setCalibrationHeaders(
    context: Context,
    value: StoreResult<"getEvaluationCasebookCalibration">,
  ): void;
  setArtifactHeaders(
    context: Context,
    value: StoreResult<"exportEvaluationCasebook">,
  ): void;
  setQualificationListHeaders(
    context: Context,
    casebookId: string,
    value: StoreResult<"listEvaluationCasebookQualificationExecutions">,
  ): void;
  setQualificationReceiptHeaders(
    context: Context,
    value: ReturnType<typeof createEvaluationCasebookQualificationReceipt>,
  ): void;
  setBaselineListHeaders(
    context: Context,
    casebookId: string,
    value: StoreResult<"listEvaluationQualificationBaselines">,
  ): void;
  setSuiteListHeaders(
    context: Context,
    threadId: string,
    value: StoreResult<"listEvaluationSuites">,
  ): void;
  setSuiteReceiptHeaders(
    context: Context,
    value: ReturnType<typeof createEvaluationSuiteGateReceipt>,
  ): void;
  setSuiteExecutionListHeaders(
    context: Context,
    threadId: string,
    suiteId: string | undefined,
    value: StoreResult<"listEvaluationSuiteExecutions">,
  ): void;
}

export function registerEvaluationCatalogHttp(
  app: Hono,
  store: EvaluationCatalogStore,
  responses: EvaluationCatalogHttpResponses,
): void {
  app.get("/api/evaluation-casebooks", (context) => {
    const casebooks = store.listEvaluationCasebooks();
    responses.setCasebookListHeaders(context, casebooks);
    return context.json(casebooks);
  });

  app.get("/api/evaluation-casebooks/:casebookId", (context) => {
    const casebook = store.getEvaluationCasebook(
      context.req.param("casebookId"),
    );
    responses.setCasebookHeaders(context, casebook);
    return context.json(casebook);
  });

  app.get("/api/evaluation-casebooks/:casebookId/calibration", (context) => {
    const report = store.getEvaluationCasebookCalibration(
      context.req.param("casebookId"),
    );
    responses.setCalibrationHeaders(context, report);
    return context.json(report);
  });

  app.get("/api/evaluation-casebooks/:casebookId/export", (context) => {
    const artifact = store.exportEvaluationCasebook(
      context.req.param("casebookId"),
    );
    responses.setArtifactHeaders(context, artifact);
    return context.json(artifact);
  });

  app.get("/api/evaluation-casebooks/:casebookId/qualifications", (context) => {
    const casebookId = context.req.param("casebookId");
    const qualifications =
      store.listEvaluationCasebookQualificationExecutions(casebookId);
    responses.setQualificationListHeaders(context, casebookId, qualifications);
    return context.json(qualifications);
  });

  app.get(
    "/api/evaluation-casebooks/:casebookId/qualification-receipt",
    (context) => {
      const receipt = createEvaluationCasebookQualificationReceipt(
        store,
        context.req.param("casebookId"),
      );
      responses.setQualificationReceiptHeaders(context, receipt);
      return context.json(receipt);
    },
  );

  app.get(
    "/api/evaluation-casebooks/:casebookId/qualification-baselines",
    (context) => {
      const casebookId = context.req.param("casebookId");
      const baselines = store.listEvaluationQualificationBaselines(casebookId);
      responses.setBaselineListHeaders(context, casebookId, baselines);
      return context.json(baselines);
    },
  );

  app.get("/api/threads/:threadId/evaluation-suites", (context) => {
    const threadId = context.req.param("threadId");
    store.getThread(threadId);
    const suites = store.listEvaluationSuites(threadId);
    responses.setSuiteListHeaders(context, threadId, suites);
    return context.json(suites);
  });

  app.get(
    "/api/threads/:threadId/evaluation-suites/:suiteId/receipt",
    (context) => {
      const receipt = createEvaluationSuiteGateReceipt(
        store,
        context.req.param("threadId"),
        context.req.param("suiteId"),
      );
      responses.setSuiteReceiptHeaders(context, receipt);
      return context.json(receipt);
    },
  );

  app.get("/api/threads/:threadId/evaluation-suite-executions", (context) => {
    const threadId = context.req.param("threadId");
    store.getThread(threadId);
    const suiteId = context.req.query("suite")?.trim() || undefined;
    const executions = store.listEvaluationSuiteExecutions(threadId, suiteId);
    responses.setSuiteExecutionListHeaders(
      context,
      threadId,
      suiteId,
      executions,
    );
    return context.json(executions);
  });
}
