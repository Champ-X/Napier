import type {
  ExecutionPlan,
  ExecutionPlanWorkflowManifest,
  RunEvent,
} from "@napier/contracts";

const HASH = /^[a-f0-9]{64}$/u;
const NODE_ID = /^[a-z][a-z0-9_-]{0,63}$/u;

export interface OpenWorkflowBreakpoint {
  planId: string;
  manifestSha256: string;
  nodeId: string;
  breakpointIndex: number;
  breakpointCount: number;
  reachedEventSeq: number;
  bindingContextSha256: string;
  planRevision: number;
  breakBeforeNodeIds: string[];
}

export type WorkflowBreakpointProjection =
  | { status: "none" }
  | { status: "invalid"; reason: WorkflowBreakpointProjectionError }
  | { status: "open"; breakpoint: OpenWorkflowBreakpoint };

export type WorkflowBreakpointProjectionError =
  | "plan_ambiguous"
  | "start_ambiguous"
  | "start_invalid"
  | "evidence_invalid"
  | "evidence_ambiguous"
  | "plan_drift";

interface RecoveredBreakpoint {
  breakpoint: OpenWorkflowBreakpoint;
  continued: boolean;
}

export function projectWorkflowBreakpoint(
  plans: ExecutionPlan[],
  events: RunEvent[],
): WorkflowBreakpointProjection {
  const activePlans = plans.filter(
    (candidate) => candidate.status === "active",
  );
  if (activePlans.length > 1) {
    return { status: "invalid", reason: "plan_ambiguous" };
  }
  const plan = activePlans[0];
  if (!plan) return { status: "none" };
  if (
    events.some(
      (event) =>
        event.type.startsWith("workflow.breakpoint.") &&
        workflowPlanId(event) === undefined,
    )
  ) {
    return { status: "invalid", reason: "evidence_invalid" };
  }
  const relevant = events.filter(
    (event) =>
      workflowPlanId(event) === plan.id &&
      (event.type === "workflow.started" ||
        event.type === "workflow.breakpoint.reached" ||
        event.type === "workflow.breakpoint.continued"),
  );
  const breakpointEvents = relevant.filter((event) =>
    event.type.startsWith("workflow.breakpoint."),
  );
  if (breakpointEvents.length === 0) return { status: "none" };
  const starts = relevant.filter((event) => event.type === "workflow.started");
  if (starts.length !== 1) {
    return {
      status: "invalid",
      reason: starts.length === 0 ? "start_invalid" : "start_ambiguous",
    };
  }
  const startEvent = starts[0]!;
  const start = workflowStart(startEvent);
  if (!start) return { status: "invalid", reason: "start_invalid" };
  if (breakpointEvents.some((event) => event.seq <= startEvent.seq)) {
    return { status: "invalid", reason: "evidence_ambiguous" };
  }

  const recovered = new Map<string, RecoveredBreakpoint>();
  for (const event of breakpointEvents.toSorted(
    (left, right) => left.seq - right.seq,
  )) {
    const evidence = workflowBreakpointEvidence(event, plan.id, start);
    if (!evidence) {
      return { status: "invalid", reason: "evidence_invalid" };
    }
    const current = recovered.get(evidence.nodeId);
    if (event.type === "workflow.breakpoint.reached") {
      if (current) {
        return { status: "invalid", reason: "evidence_ambiguous" };
      }
      recovered.set(evidence.nodeId, {
        breakpoint: {
          planId: plan.id,
          manifestSha256: start.manifestSha256,
          nodeId: evidence.nodeId,
          breakpointIndex: evidence.breakpointIndex,
          breakpointCount: start.breakBeforeNodeIds.length,
          reachedEventSeq: event.seq,
          bindingContextSha256: evidence.bindingContextSha256,
          planRevision: evidence.planRevision,
          breakBeforeNodeIds: [...start.breakBeforeNodeIds],
        },
        continued: false,
      });
      continue;
    }
    if (
      !current ||
      current.continued ||
      evidence.reachedEventSeq !== current.breakpoint.reachedEventSeq ||
      event.seq <= current.breakpoint.reachedEventSeq ||
      evidence.planRevision !== current.breakpoint.planRevision ||
      evidence.bindingContextSha256 !== current.breakpoint.bindingContextSha256
    ) {
      return { status: "invalid", reason: "evidence_ambiguous" };
    }
    current.continued = true;
  }
  const open = [...recovered.values()].filter((item) => !item.continued);
  if (open.length === 0) return { status: "none" };
  if (open.length !== 1) {
    return { status: "invalid", reason: "evidence_ambiguous" };
  }
  const breakpoint = open[0]!.breakpoint;
  const step = plan.steps.find(
    (candidate) => candidate.id === breakpoint.nodeId,
  );
  if (
    plan.revision !== breakpoint.planRevision ||
    step?.status !== "ready" ||
    plan.readyStepIds.includes(step.id) === false
  ) {
    return { status: "invalid", reason: "plan_drift" };
  }
  return { status: "open", breakpoint };
}

export function workflowBreakpointManifestMatches(
  breakpoint: OpenWorkflowBreakpoint,
  manifest: ExecutionPlanWorkflowManifest,
): boolean {
  if (manifest.contentSha256 !== breakpoint.manifestSha256) return false;
  const configured = manifest.nodes.flatMap((node) =>
    breakpoint.breakBeforeNodeIds.includes(node.id) ? [node.id] : [],
  );
  return (
    configured.length === breakpoint.breakBeforeNodeIds.length &&
    configured.every(
      (nodeId, index) => nodeId === breakpoint.breakBeforeNodeIds[index],
    ) &&
    manifest.nodes.some((node) => node.id === breakpoint.nodeId)
  );
}

function workflowStart(event: RunEvent):
  | {
      manifestSha256: string;
      breakBeforeNodeIds: string[];
    }
  | undefined {
  const payload = record(event.payload);
  const nodeIds = nodeIdArray(payload?.["breakBeforeNodeIds"]);
  if (
    event.category !== "plan" ||
    event.visibility !== "user" ||
    payload?.["schemaVersion"] !== 1 ||
    typeof payload["manifestSha256"] !== "string" ||
    !HASH.test(payload["manifestSha256"]) ||
    !nodeIds
  ) {
    return undefined;
  }
  return {
    manifestSha256: payload["manifestSha256"],
    breakBeforeNodeIds: nodeIds,
  };
}

function workflowBreakpointEvidence(
  event: RunEvent,
  planId: string,
  start: { manifestSha256: string; breakBeforeNodeIds: string[] },
):
  | {
      nodeId: string;
      breakpointIndex: number;
      bindingContextSha256: string;
      planRevision: number;
      reachedEventSeq?: number;
    }
  | undefined {
  const payload = record(event.payload);
  const nodeId = payload?.["nodeId"];
  const breakpointIndex = payload?.["breakpointIndex"];
  const bindingContextSha256 = payload?.["bindingContextSha256"];
  const planRevision = payload?.["planRevision"];
  const reachedEventSeq = payload?.["reachedEventSeq"];
  if (
    event.category !== "plan" ||
    event.visibility !== "user" ||
    payload?.["schemaVersion"] !== 1 ||
    payload["planId"] !== planId ||
    payload["manifestSha256"] !== start.manifestSha256 ||
    typeof nodeId !== "string" ||
    !NODE_ID.test(nodeId) ||
    start.breakBeforeNodeIds.indexOf(nodeId) !== breakpointIndex ||
    payload["breakpointCount"] !== start.breakBeforeNodeIds.length ||
    typeof bindingContextSha256 !== "string" ||
    !HASH.test(bindingContextSha256) ||
    !positiveInteger(planRevision) ||
    (event.type === "workflow.breakpoint.continued" &&
      !positiveInteger(reachedEventSeq))
  ) {
    return undefined;
  }
  return {
    nodeId,
    breakpointIndex: Number(breakpointIndex),
    bindingContextSha256,
    planRevision: Number(planRevision),
    ...(event.type === "workflow.breakpoint.continued"
      ? { reachedEventSeq: Number(reachedEventSeq) }
      : {}),
  };
}

function workflowPlanId(event: RunEvent): string | undefined {
  const payload = record(event.payload);
  return typeof payload?.["planId"] === "string"
    ? payload["planId"]
    : undefined;
}

function nodeIdArray(input: unknown): string[] | undefined {
  if (
    !Array.isArray(input) ||
    input.length < 1 ||
    input.length > 16 ||
    input.some((value) => typeof value !== "string" || !NODE_ID.test(value)) ||
    new Set(input).size !== input.length
  ) {
    return undefined;
  }
  return [...input] as string[];
}

function positiveInteger(input: unknown): boolean {
  return Number.isSafeInteger(input) && Number(input) > 0;
}

function record(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;
}
