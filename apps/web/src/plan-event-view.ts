import type { RunEvent } from "@napier/contracts";

export interface PlanEventTraceView {
  action: string;
  planId?: string;
  stepId?: string;
  artifactId?: string;
  replanId?: string;
  runId?: string;
  sourceRunId?: string;
  blueprintRecordId?: string;
  blueprintSourcePlanId?: string;
  status?: string;
  planStatus?: string;
  strategy?: string;
  blueprintQualificationStatus?: string;
  stepCount?: number;
  artifactCount?: number;
  criticalPathStepCount?: number;
  readyStepCount?: number;
  blockedStepCount?: number;
  parallelReadyStepCount?: number;
  addedStepCount?: number;
  addedArtifactCount?: number;
  supersededStepCount?: number;
  supersededArtifactCount?: number;
  dependencyUpdatedStepCount?: number;
  fromRevision?: number;
  toRevision?: number;
  activePhaseIndex?: number;
  phaseWaveCount?: number;
  sizeBytes?: number;
  blueprintSourcePlanRevision?: number;
  phaseProjectionSha256?: string;
  replanSha256?: string;
  addedStepsSha256?: string;
  addedArtifactsSha256?: string;
  dependencyUpdatesSha256?: string;
  artifactSha256?: string;
  artifactPathSha256?: string;
  artifactEvidenceSha256?: string;
  blueprintSha256?: string;
  blueprintSourceArchiveSha256?: string;
  blueprintQualificationSha256?: string;
  blueprintQualificationDiagnosticsSha256?: string;
  blueprintPreviewSha256?: string;
}

const PLAN_EVENT =
  /^plan\.(created|replanned|audit|step\.(started|completed|blocked|skipped|reopened)|artifact\.(expected|produced|verified|missing|superseded))$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,160}$/u;
const PLAN_RECEIPT_SUMMARY = "plan receipt";

export function planEventTraceView(
  event: RunEvent,
): PlanEventTraceView | undefined {
  if (!PLAN_EVENT.test(event.type)) return undefined;
  if (
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return undefined;
  }
  return {
    action: event.type.slice("plan.".length),
    ...safeIdField(event.payload, "planId"),
    ...safeIdField(event.payload, "stepId"),
    ...safeIdField(event.payload, "artifactId"),
    ...safeIdField(event.payload, "replanId"),
    ...safeIdField(event.payload, "runId"),
    ...safeIdField(event.payload, "sourceRunId"),
    ...safeIdField(event.payload, "blueprintRecordId"),
    ...safeIdField(event.payload, "blueprintSourcePlanId"),
    ...safeTokenField(event.payload, "status"),
    ...safeTokenField(event.payload, "planStatus"),
    ...safeTokenField(event.payload, "strategy"),
    ...safeTokenField(event.payload, "blueprintQualificationStatus"),
    ...integerField(event.payload, "stepCount"),
    ...integerField(event.payload, "artifactCount"),
    ...arrayCountField(event.payload, "criticalPathStepIds", "criticalPathStepCount"),
    ...arrayCountField(event.payload, "readyStepIds", "readyStepCount"),
    ...arrayCountField(event.payload, "blockedStepIds", "blockedStepCount"),
    ...arrayCountField(
      event.payload,
      "parallelReadyStepIds",
      "parallelReadyStepCount",
    ),
    ...arrayCountField(event.payload, "addedStepIds", "addedStepCount"),
    ...arrayCountField(event.payload, "addedArtifactIds", "addedArtifactCount"),
    ...arrayCountField(
      event.payload,
      "supersededStepIds",
      "supersededStepCount",
    ),
    ...arrayCountField(
      event.payload,
      "supersededArtifactIds",
      "supersededArtifactCount",
    ),
    ...arrayCountField(
      event.payload,
      "dependencyUpdatedStepIds",
      "dependencyUpdatedStepCount",
    ),
    ...integerField(event.payload, "fromRevision"),
    ...integerField(event.payload, "toRevision"),
    ...integerField(event.payload, "activePhaseIndex"),
    ...integerField(event.payload, "phaseWaveCount"),
    ...integerField(event.payload, "sizeBytes"),
    ...integerField(event.payload, "blueprintSourcePlanRevision"),
    ...shaField(event.payload, "phaseProjectionSha256"),
    ...shaField(event.payload, "replanSha256"),
    ...shaField(event.payload, "addedStepsSha256"),
    ...shaField(event.payload, "addedArtifactsSha256"),
    ...shaField(event.payload, "dependencyUpdatesSha256"),
    ...shaAliasField(event.payload, "sha256", "artifactSha256"),
    ...shaAliasField(event.payload, "pathSha256", "artifactPathSha256"),
    ...shaAliasField(
      event.payload,
      "evidenceSha256",
      "artifactEvidenceSha256",
    ),
    ...shaField(event.payload, "blueprintSha256"),
    ...shaField(event.payload, "blueprintSourceArchiveSha256"),
    ...shaField(event.payload, "blueprintQualificationSha256"),
    ...shaField(event.payload, "blueprintQualificationDiagnosticsSha256"),
    ...shaField(event.payload, "blueprintPreviewSha256"),
  };
}

export function planEventTraceSummary(event: RunEvent): string | undefined {
  if (!event.type.startsWith("plan.")) return undefined;
  if (!PLAN_EVENT.test(event.type)) return event.category;
  const view = planEventTraceView(event);
  if (!view) return PLAN_RECEIPT_SUMMARY;
  return [
    `plan / ${view.action}`,
    ...idSummaries(view),
    ...(view.status ? [`status ${view.status}`] : []),
    ...(view.planStatus ? [`plan-status ${view.planStatus}`] : []),
    ...(view.strategy ? [`strategy ${view.strategy}`] : []),
    ...(view.blueprintQualificationStatus
      ? [`blueprint-qualification ${view.blueprintQualificationStatus}`]
      : []),
    ...countSummaries(view),
    ...revisionSummaries(view),
    ...(view.sizeBytes !== undefined ? [`size-bytes ${view.sizeBytes}`] : []),
    ...hashSummaries(view),
  ].join(" / ");
}

function idSummaries(view: PlanEventTraceView): string[] {
  return [
    ...idSummary("plan", view.planId),
    ...idSummary("step", view.stepId),
    ...idSummary("artifact", view.artifactId),
    ...idSummary("replan", view.replanId),
    ...idSummary("run", view.runId),
    ...idSummary("source-run", view.sourceRunId),
    ...idSummary("blueprint-record", view.blueprintRecordId),
    ...idSummary("blueprint-source-plan", view.blueprintSourcePlanId),
  ];
}

function countSummaries(view: PlanEventTraceView): string[] {
  return [
    ...(view.stepCount !== undefined ? [`steps ${view.stepCount}`] : []),
    ...(view.artifactCount !== undefined
      ? [`artifacts ${view.artifactCount}`]
      : []),
    ...(view.criticalPathStepCount !== undefined
      ? [`critical ${view.criticalPathStepCount}`]
      : []),
    ...(view.readyStepCount !== undefined ? [`ready ${view.readyStepCount}`] : []),
    ...(view.blockedStepCount !== undefined
      ? [`blocked ${view.blockedStepCount}`]
      : []),
    ...(view.parallelReadyStepCount !== undefined
      ? [`parallel-ready ${view.parallelReadyStepCount}`]
      : []),
    ...(view.addedStepCount !== undefined
      ? [`added-steps ${view.addedStepCount}`]
      : []),
    ...(view.addedArtifactCount !== undefined
      ? [`added-artifacts ${view.addedArtifactCount}`]
      : []),
    ...(view.supersededStepCount !== undefined
      ? [`superseded-steps ${view.supersededStepCount}`]
      : []),
    ...(view.supersededArtifactCount !== undefined
      ? [`superseded-artifacts ${view.supersededArtifactCount}`]
      : []),
    ...(view.dependencyUpdatedStepCount !== undefined
      ? [`dependency-updates ${view.dependencyUpdatedStepCount}`]
      : []),
    ...(view.activePhaseIndex !== undefined
      ? [`active-phase ${view.activePhaseIndex}`]
      : []),
    ...(view.phaseWaveCount !== undefined
      ? [`phase-waves ${view.phaseWaveCount}`]
      : []),
  ];
}

function revisionSummaries(view: PlanEventTraceView): string[] {
  return [
    ...(view.fromRevision !== undefined ? [`from r${view.fromRevision}`] : []),
    ...(view.toRevision !== undefined ? [`to r${view.toRevision}`] : []),
    ...(view.blueprintSourcePlanRevision !== undefined
      ? [`blueprint-source-r${view.blueprintSourcePlanRevision}`]
      : []),
  ];
}

function hashSummaries(view: PlanEventTraceView): string[] {
  return [
    ...hashSummary("phase", view.phaseProjectionSha256),
    ...hashSummary("replan", view.replanSha256),
    ...hashSummary("added-steps", view.addedStepsSha256),
    ...hashSummary("added-artifacts", view.addedArtifactsSha256),
    ...hashSummary("dependency-updates", view.dependencyUpdatesSha256),
    ...hashSummary("artifact", view.artifactSha256),
    ...hashSummary("artifact-path", view.artifactPathSha256),
    ...hashSummary("artifact-evidence", view.artifactEvidenceSha256),
    ...hashSummary("blueprint", view.blueprintSha256),
    ...hashSummary("blueprint-source-archive", view.blueprintSourceArchiveSha256),
    ...hashSummary("blueprint-qualification", view.blueprintQualificationSha256),
    ...hashSummary(
      "blueprint-diagnostics",
      view.blueprintQualificationDiagnosticsSha256,
    ),
    ...hashSummary("blueprint-preview", view.blueprintPreviewSha256),
  ];
}

function idSummary(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(-10)}`] : [];
}

function hashSummary(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(0, 12)}`] : [];
}

function safeIdField(
  payload: Record<string, unknown>,
  key: keyof PlanEventTraceView,
): Partial<PlanEventTraceView> {
  const value = safeToken(payload[key]);
  return value ? { [key]: value } : {};
}

function safeTokenField(
  payload: Record<string, unknown>,
  key: keyof PlanEventTraceView,
): Partial<PlanEventTraceView> {
  const value = safeToken(payload[key]);
  return value ? { [key]: value } : {};
}

function integerField(
  payload: Record<string, unknown>,
  key: keyof PlanEventTraceView,
): Partial<PlanEventTraceView> {
  const value = payload[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? { [key]: value }
    : {};
}

function arrayCountField(
  payload: Record<string, unknown>,
  sourceKey: string,
  targetKey: keyof PlanEventTraceView,
): Partial<PlanEventTraceView> {
  const value = payload[sourceKey];
  return Array.isArray(value) ? { [targetKey]: value.length } : {};
}

function shaField(
  payload: Record<string, unknown>,
  key: keyof PlanEventTraceView,
): Partial<PlanEventTraceView> {
  const value = sha256(payload[key]);
  return value ? { [key]: value } : {};
}

function shaAliasField(
  payload: Record<string, unknown>,
  sourceKey: string,
  targetKey: keyof PlanEventTraceView,
): Partial<PlanEventTraceView> {
  const value = sha256(payload[sourceKey]);
  return value ? { [targetKey]: value } : {};
}

function safeToken(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_TOKEN.test(value) ? value : undefined;
}

function sha256(value: unknown): string | undefined {
  return typeof value === "string" && SHA256.test(value) ? value : undefined;
}
