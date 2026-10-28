import type { ExecutionPlanWorkflowRuntime } from "@napier/runtime/workflow";
import type { Hono } from "hono";

import { jsonError } from "./http-response-evidence.js";
import {
  readLimitedJson,
  RequestBodyTooLargeError,
} from "./http-request-body.js";

export function registerWorkflowRecoveryHttp(
  app: Hono,
  services: {
    workflows: Pick<
      ExecutionPlanWorkflowRuntime,
      "recoveryCheckpoint" | "recover"
    >;
  },
): void {
  app.get(
    "/api/threads/:threadId/workflows/:planId/recovery",
    async (context) => {
      context.header("Cache-Control", "no-store");
      return context.json(
        await services.workflows.recoveryCheckpoint(
          context.req.param("threadId"),
          context.req.param("planId"),
        ),
      );
    },
  );
  app.post(
    "/api/threads/:threadId/workflows/:planId/recovery",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          1024,
          "Workflow recovery request",
        );
      } catch (error) {
        return jsonError(
          context,
          "Workflow recovery request is invalid",
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        Object.keys(input).length !== 1 ||
        !("checkpointSha256" in input) ||
        typeof input.checkpointSha256 !== "string" ||
        !/^[a-f0-9]{64}$/u.test(input.checkpointSha256)
      ) {
        return jsonError(context, "Workflow recovery request is invalid", 400);
      }
      try {
        const result = await services.workflows.recover({
          threadId: context.req.param("threadId"),
          planId: context.req.param("planId"),
          request: { checkpointSha256: input.checkpointSha256 },
          signal: context.req.raw.signal,
        });
        context.header("Cache-Control", "no-store");
        return context.json({
          checkpointSha256: input.checkpointSha256,
          result,
        });
      } catch {
        // Refresh the durable state after any uncertain response. Never turn a
        // retry into consent for a new checkpoint or echo private manifest data.
        return jsonError(
          context,
          "Workflow state changed or recovery stopped; refresh before continuing",
          409,
        );
      }
    },
  );
}
