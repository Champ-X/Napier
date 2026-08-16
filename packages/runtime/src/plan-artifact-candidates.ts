import { access, lstat, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

import type {
  ArtifactManifestEntry,
  JsonValue,
  RunEvent,
  RunRecord,
} from "@napier/contracts";

import type { EventSink } from "./event-sink.js";
import { createPlanArtifactEventPayload } from "./plans.js";
import { isPathInsideWorkspace } from "./policy.js";
import type { LocalStore } from "./store.js";

export async function registerPlanArtifactCandidates(input: {
  store: LocalStore;
  run: Pick<RunRecord, "id" | "threadId">;
  onEvent?: EventSink;
}): Promise<void> {
  const runEvents = (await input.store.listEvents(input.run.threadId)).filter(
    (event) => event.runId === input.run.id,
  );
  const plans = input.store
    .listPlans(input.run.threadId)
    .filter(
      (plan) =>
        (plan.status === "active" || plan.status === "blocked") &&
        belongsToRun(plan.id, plan.steps, input.run.id, runEvents),
    );
  for (const plan of plans) {
    for (const artifact of plan.artifacts) {
      if (!(await isCandidate(input.store.workspaceRoot, artifact))) continue;
      const updated = await input.store.updatePlanArtifact(
        plan.id,
        artifact.id,
        {
          status: "candidate",
          sourceRunId: input.run.id,
          evidence:
            "Deterministic finalization found the declared workspace Artifact; verification remains pending.",
        },
      );
      const candidate = updated.artifacts.find(
        (entry) => entry.id === artifact.id,
      )!;
      const event = await input.store.appendEvent({
        threadId: input.run.threadId,
        runId: input.run.id,
        type: "plan.artifact.candidate",
        category: "plan",
        visibility: "user",
        payload: createPlanArtifactEventPayload(updated, candidate),
      });
      if (input.onEvent) {
        try {
          await input.onEvent(event);
        } catch {
          // Durable candidate registration survives a disconnected stream.
        }
      }
    }
  }
}

function belongsToRun(
  planId: string,
  steps: Array<{ runId?: string }>,
  runId: string,
  events: RunEvent[],
): boolean {
  return (
    steps.some((step) => step.runId === runId) ||
    events.some((event) => recordValue(event.payload)?.["planId"] === planId)
  );
}

async function isCandidate(
  workspaceRoot: string,
  artifact: ArtifactManifestEntry,
): Promise<boolean> {
  if (
    artifact.status !== "expected" ||
    (artifact.kind !== "file" && artifact.kind !== "directory")
  ) {
    return false;
  }
  const target = path.resolve(workspaceRoot, artifact.path);
  try {
    const link = await lstat(target);
    if (link.isSymbolicLink()) return false;
    const [root, resolved, info] = await Promise.all([
      realpath(workspaceRoot),
      realpath(target),
      stat(target),
      access(target, constants.R_OK),
    ]);
    if (!isPathInsideWorkspace(resolved, root)) return false;
    return artifact.kind === "file" ? info.isFile() : info.isDirectory();
  } catch {
    return false;
  }
}

function recordValue(value: JsonValue): Record<string, JsonValue> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}
