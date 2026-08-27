import { Hono, type Context } from "hono";
import {
  registerContextCompactionHttp,
  type ContextCompactionHttpServices,
} from "./context-compaction-http.js";

import {
  executeAgentMessageExperimentHttp,
  previewAgentMessageExperimentHttp,
  type AgentMessageExperimentHttpServices,
} from "./agent-message-experiment-http.js";
import { jsonError } from "./http-response-evidence.js";
import {
  readLimitedJson,
  RequestBodyTooLargeError,
} from "./http-request-body.js";
import {
  executeModelInvocationExperimentHttp,
  previewModelInvocationExperimentHttp,
  type ModelInvocationExperimentHttpServices,
} from "./model-invocation-experiment-http.js";
import {
  executeToolInvocationExperimentHttp,
  previewToolInvocationExperimentHttp,
  type ToolInvocationExperimentHttpServices,
} from "./tool-invocation-experiment-http.js";
import {
  executeWorkflowExperimentHttp,
  previewWorkflowExperimentHttp,
  type WorkflowExperimentHttpServices,
} from "./workflow-experiment-http.js";
import {
  executeWorkflowHttp,
  type WorkflowHttpServices,
} from "./workflow-http.js";

export interface ThreadWorkflowHttpServices
  extends
    WorkflowHttpServices,
    AgentMessageExperimentHttpServices,
    ModelInvocationExperimentHttpServices,
    ToolInvocationExperimentHttpServices,
    WorkflowExperimentHttpServices,
    ContextCompactionHttpServices {}

const HTTP_HELPERS = {
  readJson: readLimitedJson,
  jsonError: (
    context: Context,
    message: string,
    status: 400 | 409 | 413,
  ): Response => jsonError(context, message, status),
  isBodyTooLarge: (error: unknown): boolean =>
    error instanceof RequestBodyTooLargeError,
};

export function registerThreadWorkflowHttp(
  app: Hono,
  services: ThreadWorkflowHttpServices,
): void {
  registerContextCompactionHttp(app, services);
  app.post("/api/threads/:threadId/workflows", (context) =>
    executeWorkflowHttp(context, services, HTTP_HELPERS),
  );

  app.post("/api/threads/:threadId/agent-experiments/preview", (context) =>
    previewAgentMessageExperimentHttp(context, services, HTTP_HELPERS),
  );
  app.post("/api/threads/:threadId/agent-experiments", (context) =>
    executeAgentMessageExperimentHttp(context, services, HTTP_HELPERS),
  );

  app.post(
    "/api/threads/:threadId/model-invocation-experiments/preview",
    (context) =>
      previewModelInvocationExperimentHttp(context, services, HTTP_HELPERS),
  );
  app.post("/api/threads/:threadId/model-invocation-experiments", (context) =>
    executeModelInvocationExperimentHttp(context, services, HTTP_HELPERS),
  );

  app.post(
    "/api/threads/:threadId/tool-invocation-experiments/preview",
    (context) =>
      previewToolInvocationExperimentHttp(context, services, HTTP_HELPERS),
  );
  app.post("/api/threads/:threadId/tool-invocation-experiments", (context) =>
    executeToolInvocationExperimentHttp(context, services, HTTP_HELPERS),
  );

  app.post(
    "/api/threads/:threadId/workflows/:planId/experiments/preview",
    (context) => previewWorkflowExperimentHttp(context, services, HTTP_HELPERS),
  );
  app.post("/api/threads/:threadId/workflows/:planId/experiments", (context) =>
    executeWorkflowExperimentHttp(context, services, HTTP_HELPERS),
  );
}
