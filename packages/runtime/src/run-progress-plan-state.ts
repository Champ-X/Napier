import type { ExecutionPlan, JsonObject, JsonValue } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";

const SHA256 = /^[a-f0-9]{64}$/u;

export interface RunPlanProgressSnapshotV1 {
  kind: "napier.run-plan-progress-snapshot";
  schemaVersion: 1;
  planIdSha256: string;
  revision: number;
  status: ExecutionPlan["status"];
  steps: Array<{
    idSha256: string;
    status: ExecutionPlan["steps"][number]["status"];
  }>;
  artifacts: Array<{
    idSha256: string;
    status: ExecutionPlan["artifacts"][number]["status"];
  }>;
  contentSha256: string;
}

export function createRunPlanProgressSnapshot(
  plan: ExecutionPlan,
): RunPlanProgressSnapshotV1 {
  const content = {
    kind: "napier.run-plan-progress-snapshot" as const,
    schemaVersion: 1 as const,
    planIdSha256: sha256(plan.id),
    revision: plan.revision,
    status: plan.status,
    steps: plan.steps
      .map((step) => ({ idSha256: sha256(step.id), status: step.status }))
      .sort((left, right) => left.idSha256.localeCompare(right.idSha256)),
    artifacts: plan.artifacts
      .map((artifact) => ({
        idSha256: sha256(artifact.id),
        status: artifact.status,
      }))
      .sort((left, right) => left.idSha256.localeCompare(right.idSha256)),
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

export function decodeRunPlanProgressSnapshot(
  value: JsonValue | undefined,
): RunPlanProgressSnapshotV1 | undefined {
  if (!object(value)) return undefined;
  const expectedKeys = [
    "artifacts",
    "contentSha256",
    "kind",
    "planIdSha256",
    "revision",
    "schemaVersion",
    "status",
    "steps",
  ];
  if (
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify(expectedKeys) ||
    value["kind"] !== "napier.run-plan-progress-snapshot" ||
    value["schemaVersion"] !== 1 ||
    !hash(value["planIdSha256"]) ||
    !Number.isSafeInteger(value["revision"]) ||
    Number(value["revision"]) < 1 ||
    !planStatus(value["status"]) ||
    !Array.isArray(value["steps"]) ||
    !Array.isArray(value["artifacts"])
  ) {
    return undefined;
  }
  const steps = value["steps"].flatMap((candidate) => {
    if (
      !object(candidate) ||
      JSON.stringify(Object.keys(candidate).sort()) !==
        JSON.stringify(["idSha256", "status"])
    )
      return [];
    const idSha256 = hash(candidate["idSha256"]);
    const status = stepStatus(candidate["status"]);
    return idSha256 && status ? [{ idSha256, status }] : [];
  });
  const artifacts = value["artifacts"].flatMap((candidate) => {
    if (
      !object(candidate) ||
      JSON.stringify(Object.keys(candidate).sort()) !==
        JSON.stringify(["idSha256", "status"])
    )
      return [];
    const idSha256 = hash(candidate["idSha256"]);
    const status = artifactStatus(candidate["status"]);
    return idSha256 && status ? [{ idSha256, status }] : [];
  });
  if (
    steps.length !== value["steps"].length ||
    artifacts.length !== value["artifacts"].length ||
    new Set(steps.map((step) => step.idSha256)).size !== steps.length ||
    new Set(artifacts.map((artifact) => artifact.idSha256)).size !==
      artifacts.length ||
    steps.some(
      (step, index) => index > 0 && steps[index - 1]!.idSha256 >= step.idSha256,
    ) ||
    artifacts.some(
      (artifact, index) =>
        index > 0 && artifacts[index - 1]!.idSha256 >= artifact.idSha256,
    )
  ) {
    return undefined;
  }
  const content = {
    kind: value["kind"],
    schemaVersion: value["schemaVersion"],
    planIdSha256: value["planIdSha256"],
    revision: value["revision"],
    status: value["status"],
    steps,
    artifacts,
  } as const;
  if (value["contentSha256"] !== sha256(canonicalJson(content))) {
    return undefined;
  }
  return {
    ...content,
    contentSha256: value["contentSha256"] as string,
  } as RunPlanProgressSnapshotV1;
}

export function runPlanProgressEventPayload(plan: ExecutionPlan): JsonObject {
  return {
    runProgressSnapshot: createRunPlanProgressSnapshot(
      plan,
    ) as unknown as JsonObject,
  };
}

export function projectRunPlanState(plans: ExecutionPlan[]): {
  revisionTotal: number;
  planStatusCounts: Record<string, number>;
  stepStatusCounts: Record<string, number>;
  productScore: number;
  acceptanceScore: number;
  sha256: string;
} {
  return projectRunPlanSnapshotState(plans.map(createRunPlanProgressSnapshot));
}

export function projectRunPlanSnapshotState(
  snapshots: readonly RunPlanProgressSnapshotV1[],
): ReturnType<typeof projectRunPlanState> {
  const state = snapshots
    .map((snapshot) => ({
      idSha256: snapshot.planIdSha256,
      revision: snapshot.revision,
      status: snapshot.status,
      steps: snapshot.steps,
    }))
    .sort((left, right) => left.idSha256.localeCompare(right.idSha256));
  return {
    revisionTotal: snapshots.reduce(
      (total, snapshot) => total + snapshot.revision,
      0,
    ),
    planStatusCounts: statusCounts(
      snapshots.map((snapshot) => snapshot.status),
    ),
    stepStatusCounts: statusCounts(
      snapshots.flatMap((snapshot) =>
        snapshot.steps.map((step) => step.status),
      ),
    ),
    productScore: snapshots.reduce(
      (total, snapshot) =>
        total +
        snapshot.steps.reduce(
          (stepTotal, step) => stepTotal + stepProductRank(step.status),
          0,
        ),
      0,
    ),
    acceptanceScore:
      snapshots.filter((snapshot) => snapshot.status === "completed").length +
      snapshots.reduce(
        (total, snapshot) =>
          total +
          snapshot.steps.filter((step) => step.status === "completed").length,
        0,
      ),
    sha256: sha256(canonicalJson(state)),
  };
}

export function projectRunArtifactState(plans: ExecutionPlan[]): {
  artifactCount: number;
  candidateCount: number;
  statusCounts: Record<string, number>;
  productScore: number;
  acceptanceScore: number;
  sha256: string;
} {
  return projectRunArtifactSnapshotState(
    plans.map(createRunPlanProgressSnapshot),
  );
}

export function projectRunArtifactSnapshotState(
  snapshots: readonly RunPlanProgressSnapshotV1[],
): ReturnType<typeof projectRunArtifactState> {
  const artifacts = snapshots
    .flatMap((snapshot) =>
      snapshot.artifacts.map((artifact) => ({
        idSha256: sha256(`${snapshot.planIdSha256}:${artifact.idSha256}`),
        status: artifact.status,
      })),
    )
    .sort((left, right) => left.idSha256.localeCompare(right.idSha256));
  return {
    artifactCount: artifacts.length,
    candidateCount: artifacts.filter(
      (artifact) => artifact.status === "candidate",
    ).length,
    statusCounts: statusCounts(artifacts.map((artifact) => artifact.status)),
    productScore: snapshots.reduce(
      (total, snapshot) =>
        total +
        snapshot.artifacts.reduce(
          (artifactTotal, artifact) =>
            artifactTotal + artifactProductRank(artifact.status),
          0,
        ),
      0,
    ),
    acceptanceScore: snapshots.reduce(
      (total, snapshot) =>
        total +
        snapshot.artifacts.filter((artifact) => artifact.status === "verified")
          .length,
      0,
    ),
    sha256: sha256(canonicalJson(artifacts)),
  };
}

function object(
  value: JsonValue | undefined,
): value is Record<string, JsonValue> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hash(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && SHA256.test(value) ? value : undefined;
}

function planStatus(
  value: JsonValue | undefined,
): ExecutionPlan["status"] | undefined {
  return value === "active" ||
    value === "blocked" ||
    value === "completed" ||
    value === "cancelled"
    ? value
    : undefined;
}

function stepStatus(
  value: JsonValue | undefined,
): ExecutionPlan["steps"][number]["status"] | undefined {
  return value === "pending" ||
    value === "ready" ||
    value === "running" ||
    value === "partial" ||
    value === "completed" ||
    value === "blocked" ||
    value === "skipped"
    ? value
    : undefined;
}

function artifactStatus(
  value: JsonValue | undefined,
): ExecutionPlan["artifacts"][number]["status"] | undefined {
  return value === "expected" ||
    value === "candidate" ||
    value === "produced" ||
    value === "verified" ||
    value === "missing" ||
    value === "superseded"
    ? value
    : undefined;
}

function stepProductRank(
  status: ExecutionPlan["steps"][number]["status"],
): number {
  switch (status) {
    case "partial":
      return 1;
    case "completed":
      return 2;
    case "pending":
    case "ready":
    case "running":
    case "blocked":
    case "skipped":
      return 0;
  }
}

function artifactProductRank(
  status: ExecutionPlan["artifacts"][number]["status"],
): number {
  switch (status) {
    case "candidate":
      return 1;
    case "produced":
      return 2;
    case "verified":
      return 3;
    case "expected":
    case "missing":
    case "superseded":
      return 0;
  }
}

function statusCounts(values: string[]): Record<string, number> {
  return Object.fromEntries(
    [...new Set(values)]
      .sort()
      .map((status) => [
        status,
        values.filter((value) => value === status).length,
      ]),
  );
}
