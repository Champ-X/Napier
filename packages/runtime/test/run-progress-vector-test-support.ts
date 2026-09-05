import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ExecutionPlan, JsonValue } from "@napier/contracts";
import type {
  ToolProgressContribution,
  ToolProgressOperation,
  ToolProgressScope,
} from "@napier/contracts/tool-protocol";
import { Type } from "typebox";

import { sha256 } from "../src/ed25519.js";
import { RunProgressTracker } from "../src/run-progress-vector.js";
import { LocalStore } from "../src/store.js";
import {
  defineToolProgress,
  progressSemantics,
} from "../src/tool-progress-semantics.js";

const roots: string[] = [];

export async function cleanupProgressFixtures(): Promise<void> {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
}

export async function supportTrace(
  label: string,
  prompt: string,
  toolName: string,
) {
  const fixture = await createFixture(label);
  const run = await createRun(fixture);
  const tracker = await RunProgressTracker.create(
    fixture.store,
    run,
    undefined,
    { prompt, toolNames: [toolName] },
  );
  const resource = hash("invariant-resource");
  for (const [index, state] of ["a", "a", "b", "a", "a"].entries()) {
    await supportTurn(
      fixture.store,
      run,
      tracker,
      `${toolName}-${String(index)}`,
      toolName,
      resource,
      hash(state),
    );
  }
  const requested = (await fixture.store.listRunEvents(run.id)).find(
    (candidate) => candidate.type === "run.progress.convergence_requested",
  );
  const result = {
    reason: requested?.payload["reason"],
    turnIndex: requested?.payload["turnIndex"],
    acquisitionAttemptCount: requested?.payload["acquisitionAttemptCount"],
    supportCount: requested?.payload["supportCount"],
  };
  fixture.store.close();
  return result;
}

export async function supportTurn(
  store: LocalStore,
  run: { id: string; threadId: string },
  tracker: RunProgressTracker,
  callId: string,
  toolName: string,
  resourceKeySha256: string,
  stateSha256: string,
  details: Record<string, JsonValue> = {},
) {
  await toolEvent(store, run, "tool.started", {
    callId,
    toolName,
    progress: receipt("acquire", "supporting", resourceKeySha256),
  });
  await toolEvent(store, run, "tool.admitted", {
    callId,
    toolName,
    progress: receipt("acquire", "supporting", resourceKeySha256),
  });
  await toolEvent(store, run, "tool.completed", {
    callId,
    toolName,
    progress: receipt("acquire", "supporting", resourceKeySha256, stateSha256),
    details,
  });
  await event(store, run, "turn.completed", {});
  return tracker.recordTurn();
}

export async function productTurn(
  store: LocalStore,
  run: { id: string; threadId: string },
  tracker: RunProgressTracker,
  callId: string,
  resourceKeySha256: string,
  stateSha256: string,
) {
  await toolEvent(store, run, "tool.started", {
    callId,
    toolName: "renamed_writer",
    progress: receipt("mutate", "product", resourceKeySha256),
  });
  await toolEvent(store, run, "tool.completed", {
    callId,
    toolName: "renamed_writer",
    progress: receipt("mutate", "product", resourceKeySha256, stateSha256),
  });
  await event(store, run, "turn.completed", {});
  return tracker.recordTurn();
}

export async function failureTurn(
  store: LocalStore,
  run: { id: string; threadId: string },
  tracker: RunProgressTracker,
  failures: ReturnType<typeof failureEvent>[],
) {
  for (const failure of failures) {
    await toolEvent(store, run, "tool.started", {
      callId: failure.callId,
      toolName: failure.toolName,
      progress: failure.progress,
    });
    await toolEvent(store, run, "tool.admitted", {
      callId: failure.callId,
      toolName: failure.toolName,
      progress: failure.progress,
    });
    await event(store, run, "tool.failed", {
      callId: failure.callId,
      toolName: failure.toolName,
      status: "failed",
      toolProtocol: { progress: failure.progress },
      toolFailure: failure.toolFailure,
    });
  }
  await event(store, run, "turn.completed", {});
  return tracker.recordTurn();
}

export function failureEvent(callId: string, toolName: string, domain: string) {
  return {
    callId,
    toolName,
    progress: receipt(
      "acquire",
      "supporting",
      hash(`${domain}:resource`),
      undefined,
      hash(domain),
    ),
    toolFailure: timeoutFailure(callId),
  };
}

export function timeoutFailure(seed: string): JsonValue {
  return {
    class: "timeout",
    scope: "origin",
    disposition: "alternate_route",
    fatalToSession: false,
    diagnosticSha256: hash(seed),
  };
}

export function receipt(
  operation: ToolProgressOperation,
  contribution: ToolProgressContribution,
  resourceKeySha256: string,
  stateSha256?: string,
  failureDomainKeySha256?: string,
) {
  const scope: ToolProgressScope =
    contribution === "product" || contribution === "verification"
      ? "workspace"
      : "external";
  return {
    kind: "napier.tool-progress-semantics" as const,
    schemaVersion: 1 as const,
    availability: "declared" as const,
    operation,
    scope,
    contribution,
    resourceKeySha256,
    ...(failureDomainKeySha256 ? { failureDomainKeySha256 } : {}),
    ...(stateSha256 ? { stateSha256 } : {}),
  };
}

export function declaredTool(
  name: string,
  operations: ToolProgressOperation[],
  failureDomain = name,
  fixedContribution?: ToolProgressContribution,
) {
  return defineToolProgress(
    {
      name,
      label: name,
      description: `${name} fixture`,
      parameters: Type.Object({}, { additionalProperties: true }),
      async execute(): Promise<AgentToolResult<Record<string, never>>> {
        return { content: [{ type: "text", text: "ok" }], details: {} };
      },
    },
    {
      schemaVersion: 1,
      classificationVersion: "1.0.0",
      modes: operations.map((operation) => ({
        modeId: operation,
        operation,
        scope:
          fixedContribution === "product" ||
          fixedContribution === "verification" ||
          operation === "mutate" ||
          operation === "verify"
            ? ("workspace" as const)
            : ("external" as const),
        contribution:
          fixedContribution ??
          (operation === "mutate"
            ? ("product" as const)
            : operation === "verify"
              ? ("verification" as const)
              : ("supporting" as const)),
      })),
      resolve: (input) => {
        const action =
          input && typeof input === "object" && "action" in input
            ? String(input.action)
            : "";
        const operation = operations.includes(action as ToolProgressOperation)
          ? (action as ToolProgressOperation)
          : operations[0]!;
        const contribution: ToolProgressContribution =
          fixedContribution ??
          (operation === "mutate"
            ? "product"
            : operation === "verify"
              ? "verification"
              : "supporting");
        return {
          semantics: progressSemantics(
            operation,
            contribution === "product" || contribution === "verification"
              ? "workspace"
              : "external",
            contribution,
          ),
          resourceKey: { name, input },
          failureDomainKey: { failureDomain },
        };
      },
    },
  );
}

export async function toolEvent(
  store: LocalStore,
  run: { id: string; threadId: string },
  type: "tool.started" | "tool.admitted" | "tool.completed",
  input: {
    callId: string;
    toolName: string;
    progress: ReturnType<typeof receipt>;
    details?: Record<string, JsonValue>;
  },
) {
  return event(store, run, type, {
    callId: input.callId,
    toolName: input.toolName,
    status:
      type === "tool.completed"
        ? "completed"
        : type === "tool.admitted"
          ? "admitted"
          : "started",
    toolProtocol: { progress: input.progress },
    ...(input.details ? { details: input.details } : {}),
  });
}

export async function createFixture(label: string) {
  const root = await mkdtemp(path.join(tmpdir(), `napier-progress-${label}-`));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const agentId = store.listAgents()[0]!.id;
  const thread = await store.createThread({
    title: "Run progress vector",
    agentId,
  });
  return { store, threadId: thread.id, agentId };
}

export function createRun(fixture: Awaited<ReturnType<typeof createFixture>>) {
  return fixture.store.createRun({
    threadId: fixture.threadId,
    agentId: fixture.agentId,
  });
}

export function event(
  store: LocalStore,
  run: { id: string; threadId: string },
  type: Parameters<LocalStore["appendEvent"]>[0]["type"],
  payload: Parameters<LocalStore["appendEvent"]>[0]["payload"],
) {
  const tool = type.startsWith("tool.");
  const message = type.startsWith("message.");
  return store.appendEvent({
    threadId: run.threadId,
    runId: run.id,
    type,
    category: tool ? "tool" : message ? "message" : "lifecycle",
    visibility: tool || message ? "user" : "debug",
    payload,
  });
}

export function hash(value: string): string {
  return sha256(value);
}

export function plan(
  stepStatus: ExecutionPlan["steps"][number]["status"],
  artifactStatus: ExecutionPlan["artifacts"][number]["status"],
  status: ExecutionPlan["status"],
): ExecutionPlan {
  return {
    id: "plan_fixture",
    threadId: "thread_fixture",
    objective: "Fixture",
    status,
    revision: 1,
    steps: [
      {
        id: "step_fixture",
        title: "Step",
        description: "Step",
        verification: "Verify",
        dependsOn: [],
        status: stepStatus,
        evidence: "",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    artifacts: [
      {
        id: "artifact_fixture",
        path: "artifact.txt",
        description: "Artifact",
        status: artifactStatus,
      },
    ],
    replans: [],
    replanRecommendation: null,
    criticalPathStepIds: ["step_fixture"],
    readyStepIds: [],
    blockedStepIds: [],
    phaseWaves: [],
    activePhaseIndex: null,
    parallelReadyStepIds: [],
    phaseProjectionSha256: hash("phase"),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as ExecutionPlan;
}
