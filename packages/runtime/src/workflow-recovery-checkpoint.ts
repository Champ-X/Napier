import type { WorkflowRecoveryCheckpoint } from "@napier/contracts/workflow-recovery";
import type {
  ExecutionPlanWorkflowManifest,
  AgentProfileRevision,
  OperatorDecision,
  RunEvent,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { RuntimeStorePort } from "./store-port.js";
import { workflowManifestStore } from "./workflow-manifest-store.js";
import { assertWorkflowPlanMatchesManifest } from "./workflow-runtime-model.js";

interface WorkflowRecoveryStore extends Pick<
  RuntimeStorePort,
  "getPlan" | "getThread" | "listEvents" | "listRuns"
> {
  dataRoot: string;
  workspaceRoot: string;
  listOperatorDecisions(threadId: string): Promise<OperatorDecision[]>;
  getAgentRevision(agentId: string, revision: number): AgentProfileRevision;
}
interface WorkflowStartReader {
  recoverWorkflowStart(
    threadId: string,
    planId: string,
    manifest: ExecutionPlanWorkflowManifest,
    maxConcurrency: number,
  ): Promise<{ agentId: string; agentRevision: number }>;
}

export const WORKFLOW_RECOVERY_CHECKPOINT = Symbol(
  "workflowRecoveryCheckpoint",
);

class RecoveryUnavailable extends Error {
  constructor(
    readonly reason: NonNullable<WorkflowRecoveryCheckpoint["reason"]>,
  ) {
    super("Workflow recovery evidence is unavailable");
  }
}

export async function loadWorkflowRecoveryManifest(
  store: WorkflowRecoveryStore,
  threadId: string,
  planId: string,
  ledger: WorkflowStartReader,
): Promise<ExecutionPlanWorkflowManifest> {
  const plan = store.getPlan(planId);
  if (plan.threadId !== threadId)
    throw new Error("Workflow Thread binding is invalid");
  const events = await store.listEvents(threadId);
  const starts = events.filter(
    (event) =>
      event.type === "workflow.started" &&
      payload(event)?.["planId"] === planId,
  );
  const start = starts[0];
  const hash = start && payload(start)?.["manifestSha256"];
  if (
    starts.length !== 1 ||
    start?.category !== "plan" ||
    start.visibility !== "user" ||
    typeof hash !== "string"
  ) {
    throw new Error("Workflow start evidence is unavailable or duplicated");
  }
  const manifest = await workflowManifestStore(store.dataRoot)
    .read(hash)
    .catch(() => {
      throw new RecoveryUnavailable("definition_unavailable");
    });
  const originalPayload = payload(start!);
  if (
    originalPayload?.["blueprintSha256"] !== manifest.blueprint.contentSha256 ||
    originalPayload["workflowVersion"] !== manifest.version ||
    originalPayload["nodeCount"] !== manifest.nodeCount ||
    originalPayload["outputNodeId"] !== manifest.outputNodeId ||
    originalPayload["inputSchemaSha256"] !==
      sha256(canonicalJson(manifest.inputSchema)) ||
    originalPayload["outputSchemaSha256"] !==
      sha256(canonicalJson(manifest.outputSchema))
  ) {
    throw new RecoveryUnavailable("binding_mismatch");
  }
  assertWorkflowPlanMatchesManifest(plan, manifest);
  const original = await ledger.recoverWorkflowStart(
    threadId,
    planId,
    manifest,
    manifest.maxConcurrency ?? 1,
  );
  if (store.getThread(threadId).agentId !== original.agentId)
    throw new Error("Workflow Agent binding is invalid");
  store.getAgentRevision(original.agentId, original.agentRevision);
  return manifest;
}

export async function workflowRecoveryCheckpoint(
  store: WorkflowRecoveryStore,
  threadId: string,
  planId: string,
  ledger: WorkflowStartReader,
): Promise<WorkflowRecoveryCheckpoint> {
  const base = { schemaVersion: 1 as const, threadId, planId };
  try {
    const manifest = await loadWorkflowRecoveryManifest(
      store,
      threadId,
      planId,
      ledger,
    );
    const plan = store.getPlan(planId);
    const events = await store.listEvents(threadId);
    const runs = store.listRuns(threadId);
    const decisions = await store.listOperatorDecisions(threadId);
    const identified = {
      ...base,
      name: manifest.name,
      manifestSha256: manifest.contentSha256,
    };
    if (plan.status === "completed")
      return { ...identified, status: "completed" };
    if (
      events.length > 10000 ||
      new Set(events.map((event) => event.seq)).size !== events.length
    ) {
      return { ...identified, status: "unavailable", reason: "evidence_limit" };
    }
    if (runs.some((run) => run.status === "running" || run.status === "queued"))
      return { ...identified, status: "busy" };
    const planRunIds = new Set(
      events
        .filter((event) => payload(event)?.["planId"] === planId)
        .map((event) => event.runId),
    );
    const pending = decisions.find(
      (decision) =>
        planRunIds.has(decision.runId) && decision.status === "pending",
    );
    if (pending)
      return {
        ...identified,
        status: "waiting_answer",
        decisionId: pending.id,
      };
    const reached = events.filter(
      (event) =>
        event.type === "workflow.breakpoint.reached" &&
        payload(event)?.["planId"] === planId,
    );
    const open = reached.filter(
      (event) =>
        !events.some(
          (continued) =>
            continued.type === "workflow.breakpoint.continued" &&
            payload(continued)?.["planId"] === planId &&
            payload(continued)?.["reachedEventSeq"] === event.seq,
        ),
    );
    if (open.length > 1)
      return {
        ...identified,
        status: "unavailable",
        reason: "ambiguous_breakpoint",
      };
    const action =
      open.length === 1
        ? "continue_breakpoint"
        : plan.status === "blocked"
          ? "retry_blocked"
          : "resume";
    // Include the authoritative snapshots as well as events: an interrupted Run or
    // saved answer can change without a new workflow terminal event.
    const checkpointSha256 = sha256(
      canonicalJson({
        workspaceRoot: store.workspaceRoot,
        dataRoot: store.dataRoot,
        threadId,
        plan,
        events,
        runs,
        decisions,
        manifestSha256: manifest.contentSha256,
        action,
      }),
    );
    return { ...identified, status: "ready", action, checkpointSha256 };
  } catch (error) {
    return {
      ...base,
      status: "unavailable",
      reason:
        error instanceof RecoveryUnavailable
          ? error.reason
          : "binding_mismatch",
    };
  }
}

function payload(event: RunEvent) {
  return event.payload &&
    typeof event.payload === "object" &&
    !Array.isArray(event.payload)
    ? event.payload
    : undefined;
}
