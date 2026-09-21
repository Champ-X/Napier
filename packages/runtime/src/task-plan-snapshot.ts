import type { ExecutionPlan } from "@napier/contracts";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { canonicalJson, sha256 } from "./ed25519.js";

const LIMIT = 32;
const id = Type.String({ minLength: 1, maxLength: 128 });
const ids = Type.Array(id, { maxItems: LIMIT });
const positive = Type.Integer({ minimum: 1 });
const statuses = (values: string[]) =>
  Type.Union(values.map((value) => Type.Literal(value)));
const schema = Type.Object(
  {
    kind: Type.Literal("napier.task-plan-snapshot"),
    schemaVersion: Type.Literal(1),
    planId: id,
    threadId: id,
    revision: positive,
    status: statuses(["active", "completed", "blocked", "cancelled"]),
    steps: Type.Array(
      Type.Object(
        {
          id,
          status: statuses([
            "pending",
            "ready",
            "running",
            "partial",
            "completed",
            "blocked",
            "skipped",
          ]),
        },
        { additionalProperties: false },
      ),
      { maxItems: LIMIT },
    ),
    artifacts: Type.Array(
      Type.Object(
        {
          id,
          status: statuses([
            "expected",
            "candidate",
            "produced",
            "verified",
            "missing",
            "superseded",
          ]),
          path: Type.String({ maxLength: 512 }),
          pathTruncated: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
      { maxItems: LIMIT },
    ),
    latestReplan: Type.Union([
      Type.Null(),
      Type.Object(
        {
          id,
          fromRevision: positive,
          toRevision: positive,
          reason: Type.String({ maxLength: 512 }),
          reasonTruncated: Type.Boolean(),
          supersededStepIds: ids,
          supersededArtifactIds: ids,
          addedStepIds: ids,
          addedArtifactIds: ids,
        },
        { additionalProperties: false },
      ),
    ]),
    stepCount: Type.Integer({ minimum: 0 }),
    artifactCount: Type.Integer({ minimum: 0 }),
    truncated: Type.Boolean(),
    contentSha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  },
  { additionalProperties: false },
);

/** Plan metadata is a proposal/coordination state, never completion or scope
 * authority. Include consumed IDs and supersession so a compacted Agent does
 * not accidentally reuse an artifact ID or an earlier revision. */
export function createTaskPlanSnapshot(plan: ExecutionPlan) {
  const replan = plan.replans.at(-1);
  const replacementFields = replan
    ? {
        supersededStepIds: replan.supersededStepIds.slice(0, LIMIT),
        supersededArtifactIds: replan.supersededArtifactIds.slice(0, LIMIT),
        addedStepIds: replan.addedStepIds.slice(0, LIMIT),
        addedArtifactIds: replan.addedArtifactIds.slice(0, LIMIT),
      }
    : undefined;
  const content = {
    kind: "napier.task-plan-snapshot" as const,
    schemaVersion: 1 as const,
    planId: plan.id,
    threadId: plan.threadId,
    revision: plan.revision,
    status: plan.status,
    steps: plan.steps.slice(0, LIMIT).map(({ id, status }) => ({ id, status })),
    artifacts: plan.artifacts
      .slice(0, LIMIT)
      .map(({ id, status, path }) => ({
        id,
        status,
        path: path.slice(0, 512),
        pathTruncated: path.length > 512,
      })),
    latestReplan: replan
      ? {
          id: replan.id,
          fromRevision: replan.fromRevision,
          toRevision: replan.toRevision,
          reason: replan.reason.slice(0, 512),
          reasonTruncated: replan.reason.length > 512,
          ...replacementFields!,
        }
      : null,
    stepCount: plan.steps.length,
    artifactCount: plan.artifacts.length,
    truncated:
      plan.steps.length > LIMIT ||
      plan.artifacts.length > LIMIT ||
      Boolean(
        replan &&
        [
          replan.supersededStepIds,
          replan.supersededArtifactIds,
          replan.addedStepIds,
          replan.addedArtifactIds,
        ].some((ids) => ids.length > LIMIT),
      ),
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

export function parseTaskPlanSnapshot(
  value: unknown,
): ReturnType<typeof createTaskPlanSnapshot> | undefined {
  if (!Value.Check(schema, value)) return undefined;
  const snapshot = value as ReturnType<typeof createTaskPlanSnapshot>;
  const { contentSha256, ...content } = snapshot;
  if (
    contentSha256 !== sha256(canonicalJson(content)) ||
    new Set(snapshot.steps.map((item) => item.id)).size !==
      snapshot.steps.length ||
    new Set(snapshot.artifacts.map((item) => item.id)).size !==
      snapshot.artifacts.length ||
    snapshot.stepCount < snapshot.steps.length ||
    snapshot.artifactCount < snapshot.artifacts.length ||
    (!snapshot.truncated &&
      (snapshot.stepCount !== snapshot.steps.length ||
        snapshot.artifactCount !== snapshot.artifacts.length))
  )
    return undefined;
  if (
    snapshot.latestReplan &&
    (snapshot.latestReplan.toRevision !==
      snapshot.latestReplan.fromRevision + 1 ||
      snapshot.latestReplan.toRevision > snapshot.revision)
  )
    return undefined;
  return structuredClone(snapshot);
}
