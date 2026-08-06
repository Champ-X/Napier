import type {
  AgentProfile,
  AgentProfileRevision,
  AgentProfileRollbackResult,
  ModelRef,
} from "@napier/contracts";
import {
  changedAgentFields,
  createId,
  type LocalStore,
  type ModelRegistry,
} from "@napier/runtime";
import { Hono, type Context } from "hono";

import {
  parseRollbackAgentProfileRequest,
  parseUpdateAgentProfileRequest,
} from "./agent-profile-http-validation.js";
import {
  errorMessage,
  jsonError,
  setBodyContentSha256Header,
} from "./http-response-evidence.js";
import {
  readLimitedJson,
  RequestBodyTooLargeError,
} from "./http-request-body.js";
import { assertAvailableModel } from "./model-http-availability.js";
import { registerAgentCapabilityHttp } from "./agent-capability-http.js";

const MAX_AGENT_PROFILE_REQUEST_BYTES = 32 * 1024;

type AgentProfileHttpStore = Pick<
  LocalStore,
  | "appendEvent"
  | "getAgent"
  | "getAgentRevision"
  | "getThread"
  | "listAgentRevisions"
  | "rollbackAgent"
  | "updateAgent"
>;

export interface AgentProfileHttpServices {
  store: AgentProfileHttpStore;
  models: ModelRegistry;
  agentCapabilities: import("@napier/runtime").LocalAgentRuntimeServices["agentCapabilities"];
}

export function registerAgentProfileHttp(
  app: Hono,
  services: AgentProfileHttpServices,
): void {
  registerAgentCapabilityHttp(app, services);
  app.put("/api/agents/:agentId", async (context) => {
    const agentId = context.req.param("agentId");
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_AGENT_PROFILE_REQUEST_BYTES,
        "Agent profile request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseUpdateAgentProfileRequest(input);
    if (!body) {
      return jsonError(context, "Agent profile request is invalid", 400);
    }
    if (body.threadId) {
      const thread = services.store.getThread(body.threadId);
      if (thread.agentId !== agentId) {
        return jsonError(
          context,
          "Audit thread does not use the target Agent",
          400,
        );
      }
    }
    const before = services.store.getAgent(agentId);
    const requestedModel = body.model
      ? {
          provider: body.model.provider.trim().toLowerCase(),
          id: body.model.id.trim(),
        }
      : undefined;
    try {
      if (requestedModel) {
        await assertAvailableModel(services, requestedModel);
      }
      await assertAdvisorReviewModel(
        services,
        requestedModel ?? before.model,
        body.modelAdvisor !== undefined
          ? body.modelAdvisor.reviewModel
          : before.modelAdvisor?.reviewModel,
      );
    } catch (error) {
      return jsonError(context, errorMessage(error), 400);
    }
    let updated: AgentProfile;
    try {
      updated = await services.store.updateAgent(agentId, {
        ...body,
        ...(requestedModel ? { model: requestedModel } : {}),
      });
    } catch (error) {
      return jsonError(context, errorMessage(error), 400);
    }
    const changedFields = changedAgentFields(before, updated);
    const revision = services.store.getAgentRevision(agentId, updated.revision);
    if (body.threadId && changedFields.length > 0) {
      await services.store.appendEvent({
        threadId: body.threadId,
        runId: createId("runctl"),
        type: "agent.updated",
        category: "system",
        visibility: "user",
        payload: {
          agentId,
          revision: updated.revision,
          changedFields,
          profileRevisionSha256: revision.contentSha256,
        },
      });
    }
    setAgentProfileHeaders(context, updated, revision, changedFields.length);
    return context.json(updated);
  });

  app.get("/api/agents/:agentId/revisions", (context) => {
    const agentId = context.req.param("agentId");
    const revisions = services.store.listAgentRevisions(agentId);
    setAgentRevisionListHeaders(context, agentId, revisions);
    return context.json(revisions);
  });

  app.post("/api/agents/:agentId/rollback", async (context) => {
    const agentId = context.req.param("agentId");
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_AGENT_PROFILE_REQUEST_BYTES,
        "Agent rollback request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseRollbackAgentProfileRequest(input);
    if (!body) {
      return jsonError(context, "Agent rollback request is invalid", 400);
    }
    const thread = services.store.getThread(body.threadId);
    if (thread.agentId !== agentId) {
      return jsonError(
        context,
        "Audit thread does not use the target Agent",
        400,
      );
    }
    const target = services.store.getAgentRevision(agentId, body.revision);
    try {
      await assertAvailableModel(services, target.profile.model);
      await assertAdvisorReviewModel(
        services,
        target.profile.model,
        target.profile.modelAdvisor?.reviewModel,
      );
    } catch (error) {
      return jsonError(context, errorMessage(error), 400);
    }
    const result = await services.store.rollbackAgent(agentId, body.revision);
    await services.store.appendEvent({
      threadId: body.threadId,
      runId: createId("runctl"),
      type: "agent.rolled_back",
      category: "system",
      visibility: "user",
      payload: {
        agentId,
        revision: result.agent.revision,
        restoredFromRevision: body.revision,
        changedFields: result.revision.changedFields,
        profileRevisionSha256: result.revision.contentSha256,
        restoredSnapshotSha256: target.contentSha256,
      },
    });
    setAgentRollbackHeaders(context, result, target);
    return context.json(result);
  });
}

async function assertAdvisorReviewModel(
  services: AgentProfileHttpServices,
  primaryModel: ModelRef,
  reviewModel: ModelRef | undefined,
): Promise<void> {
  if (!reviewModel) return;
  const primaryProvider = primaryModel.provider.trim().toLowerCase();
  const primaryId = primaryModel.id.trim();
  const reviewerProvider = reviewModel.provider.trim().toLowerCase();
  const reviewerId = reviewModel.id.trim();
  if (reviewerProvider === primaryProvider && reviewerId === primaryId) {
    throw new Error(
      "Model Advisor review model must differ from the primary model",
    );
  }
  if (reviewerProvider === "napier" && reviewerId === "demo") {
    throw new Error("Model Advisor review model must use a live model");
  }
  await assertAvailableModel(services, {
    provider: reviewerProvider,
    id: reviewerId,
  });
}

function setAgentProfileHeaders(
  context: Context,
  agent: AgentProfile,
  revision: AgentProfileRevision,
  changedFieldCount?: number,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, agent);
  context.header("X-Napier-Agent-Id", agent.id);
  context.header("X-Napier-Agent-Revision", String(agent.revision));
  context.header(
    "X-Napier-Agent-Profile-Revision-SHA256",
    revision.contentSha256,
  );
  context.header("X-Napier-System-Prompt-SHA256", revision.systemPromptSha256);
  if (changedFieldCount !== undefined) {
    context.header(
      "X-Napier-Agent-Changed-Field-Count",
      String(changedFieldCount),
    );
  }
}

function setAgentRevisionListHeaders(
  context: Context,
  agentId: string,
  revisions: readonly AgentProfileRevision[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, revisions);
  context.header("X-Napier-Agent-Id", agentId);
  context.header("X-Napier-Agent-Revision-Count", String(revisions.length));
  const latest = revisions[0];
  if (latest) {
    context.header("X-Napier-Agent-Revision", String(latest.revision));
    context.header(
      "X-Napier-Agent-Profile-Revision-SHA256",
      latest.contentSha256,
    );
    context.header("X-Napier-System-Prompt-SHA256", latest.systemPromptSha256);
  }
}

function setAgentRollbackHeaders(
  context: Context,
  result: AgentProfileRollbackResult,
  restoredSnapshot: AgentProfileRevision,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header("X-Napier-Agent-Id", result.agent.id);
  context.header("X-Napier-Agent-Revision", String(result.agent.revision));
  context.header(
    "X-Napier-Agent-Restored-From-Revision",
    String(restoredSnapshot.revision),
  );
  context.header(
    "X-Napier-Agent-Profile-Revision-SHA256",
    result.revision.contentSha256,
  );
  context.header(
    "X-Napier-Agent-Restored-Snapshot-SHA256",
    restoredSnapshot.contentSha256,
  );
  context.header(
    "X-Napier-System-Prompt-SHA256",
    result.revision.systemPromptSha256,
  );
  context.header(
    "X-Napier-Agent-Changed-Field-Count",
    String(result.revision.changedFields.length),
  );
}
