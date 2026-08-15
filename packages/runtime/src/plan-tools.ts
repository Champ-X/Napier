import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { Stats } from "node:fs";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type {
  CreateExecutionPlanRequest,
  ExecutionPlan,
  ExecutionPlanReplanPolicyTemplate,
  ReplanExecutionPlanRequest,
  RunRecord,
  TransitionPlanStepRequest,
  UpdateArtifactManifestRequest,
} from "@napier/contracts";
import { Type } from "typebox";

import { canonicalJson, sha256 } from "./ed25519.js";
import { createPlanArtifactEventPayload } from "./plans.js";
import {
  appendPlanCreatedEvent,
  appendPlanStepEvent,
} from "./plan-tool-events.js";
import { isPathInsideWorkspace } from "./policy.js";
import { createReplanPolicyTemplate } from "./replan-policies.js";
import type { LocalStore } from "./store.js";
import {
  inspectStructuredData,
  type WorkspaceDataCell,
  type WorkspaceDataFormat,
} from "./structured-data.js";

const MAX_ARTIFACT_HASH_BYTES = 32 * 1024 * 1024;
const MAX_ARTIFACT_PREVIEW_BYTES = 64 * 1024;
const MAX_ARTIFACT_DATA_PROFILE_BYTES = 2 * 1024 * 1024;
const MAX_ARTIFACT_DIRECTORY_MANIFEST_ENTRIES = 5_000;
const MAX_ARTIFACT_DATA_PROFILE_ROWS = 10;
const DIRECTORY_DIGEST_KIND = "napier.plan-directory-digest";

export interface WorkspaceFileArtifactExport {
  contents: Buffer;
  sha256: string;
  sizeBytes: number;
}

export interface WorkspaceTextArtifactPreview {
  text: string;
  sha256: string;
  sizeBytes: number;
  lineCount: number;
}

export interface WorkspaceDataArtifactProfile {
  format: WorkspaceDataFormat;
  sha256: string;
  sizeBytes: number;
  rowCount: number;
  columnCount: number;
  columns: string[];
  sampleRows: Array<Record<string, WorkspaceDataCell>>;
  truncated: boolean;
  columnSetSha256: string;
  sampleSha256: string;
}

export interface WorkspaceDirectoryArtifactManifestEntry {
  kind: "directory" | "file";
  path: string;
  sha256?: string;
  sizeBytes?: number;
}

export interface WorkspaceDirectoryArtifactManifest {
  entries: WorkspaceDirectoryArtifactManifestEntry[];
  sha256: string;
  sizeBytes: number;
  entryCount: number;
  fileCount: number;
  directoryCount: number;
}

export interface WorkspaceArtifactDriftInspection {
  result: "current" | "drifted" | "missing";
  expectedSha256: string;
  observedSha256?: string;
  sizeBytes?: number;
}

const planStepInputSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 64 }),
  title: Type.String({ minLength: 1, maxLength: 120 }),
  description: Type.String({ minLength: 1, maxLength: 1_500 }),
  verification: Type.String({ minLength: 1, maxLength: 1_000 }),
  dependsOn: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 64 }), {
      maxItems: 30,
    }),
  ),
});

const planArtifactInputSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 64 }),
  path: Type.String({ minLength: 1, maxLength: 500 }),
  kind: Type.Optional(
    Type.Union([
      Type.Literal("file"),
      Type.Literal("directory"),
      Type.Literal("url"),
      Type.Literal("other"),
    ]),
  ),
  description: Type.String({ minLength: 1, maxLength: 1_000 }),
});

const createPlanSchema = Type.Object({
  objective: Type.String({ minLength: 1, maxLength: 4_000 }),
  steps: Type.Array(planStepInputSchema, { minItems: 1, maxItems: 30 }),
  artifacts: Type.Optional(
    Type.Array(planArtifactInputSchema, { maxItems: 30 }),
  ),
});

const replanPlanSchema = Type.Object({
  planId: Type.String({ minLength: 1 }),
  expectedRevision: Type.Number({ minimum: 1 }),
  strategy: Type.Union([
    Type.Literal("recover_blocked"),
    Type.Literal("scope_change"),
    Type.Literal("artifact_drift"),
  ]),
  reason: Type.String({ minLength: 1, maxLength: 1_000 }),
  evidence: Type.String({ minLength: 1, maxLength: 2_000 }),
  supersedeStepIds: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 64 }), {
      maxItems: 30,
    }),
  ),
  supersedeArtifactIds: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 64 }), {
      maxItems: 30,
    }),
  ),
  dependencyUpdates: Type.Optional(
    Type.Array(
      Type.Object({
        stepId: Type.String({ minLength: 1, maxLength: 64 }),
        dependsOn: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), {
          maxItems: 30,
        }),
      }),
      { maxItems: 30 },
    ),
  ),
  addSteps: Type.Optional(Type.Array(planStepInputSchema, { maxItems: 30 })),
  addArtifacts: Type.Optional(
    Type.Array(planArtifactInputSchema, { maxItems: 30 }),
  ),
});

const transitionPlanStepSchema = Type.Object({
  planId: Type.String({ minLength: 1 }),
  stepId: Type.String({ minLength: 1 }),
  action: Type.Union([
    Type.Literal("start"),
    Type.Literal("complete"),
    Type.Literal("block"),
    Type.Literal("skip"),
    Type.Literal("reopen"),
  ]),
  evidence: Type.Optional(Type.String({ maxLength: 2_000 })),
  blocker: Type.Optional(Type.String({ maxLength: 1_000 })),
});

const updatePlanArtifactSchema = Type.Object({
  planId: Type.String({ minLength: 1 }),
  artifactId: Type.String({ minLength: 1 }),
  action: Type.Union([
    Type.Literal("produced"),
    Type.Literal("verify"),
    Type.Literal("missing"),
    Type.Literal("superseded"),
  ]),
  evidence: Type.String({ minLength: 1, maxLength: 2_000 }),
});

export function createPlanTools(
  store: LocalStore,
  run: RunRecord,
): AgentTool[] {
  const runAgent = store.getAgent(run.agentId);
  const replanPolicyTemplate = createReplanPolicyTemplate({
    model: run.configuration?.model ?? runAgent.model,
    thinkingLevel: run.configuration?.thinkingLevel ?? runAgent.thinkingLevel,
  });
  const createPlan: AgentTool<typeof createPlanSchema, { planId: string }> = {
    name: "create_plan",
    label: "Create execution plan",
    description:
      "Create a durable dependency-aware plan for multi-step work with explicit verification.",
    parameters: createPlanSchema,
    async execute(_toolCallId, input) {
      const plan = await store.createPlan(
        run.threadId,
        input as CreateExecutionPlanRequest,
      );
      await appendPlanCreatedEvent(store, run, plan);
      return planToolResult(plan, { planId: plan.id }, replanPolicyTemplate);
    },
  };

  const transitionStep: AgentTool<
    typeof transitionPlanStepSchema,
    { planId: string; stepId: string; status: string }
  > = {
    name: "update_plan_step",
    label: "Update plan step",
    description:
      "Start, complete, block, skip, or reopen a plan step; complete/skip require evidence. Completing a ready step auto-starts it.",
    parameters: transitionPlanStepSchema,
    async execute(_toolCallId, input) {
      let current = assertPlanThread(store, input.planId, run.threadId);
      if (
        input.action === "complete" &&
        current.steps.find((candidate) => candidate.id === input.stepId)
          ?.status === "ready"
      ) {
        const started = await store.transitionPlanStep(
          input.planId,
          input.stepId,
          { action: "start", runId: run.id },
        );
        await appendPlanStepEvent(store, run, started, input.stepId, "start");
        current = started;
      }
      const request: TransitionPlanStepRequest = {
        action: input.action,
        ...(input.action === "start" ? { runId: run.id } : {}),
        ...(input.evidence ? { evidence: input.evidence } : {}),
        ...(input.blocker ? { blocker: input.blocker } : {}),
      };
      const plan = await store.transitionPlanStep(
        input.planId,
        input.stepId,
        request,
      );
      const step = plan.steps.find(
        (candidate) => candidate.id === input.stepId,
      )!;
      if (plan.revision !== current.revision) {
        await appendPlanStepEvent(store, run, plan, step.id, input.action);
      }
      return planToolResult(
        plan,
        {
          planId: plan.id,
          stepId: step.id,
          status: step.status,
        },
        replanPolicyTemplate,
      );
    },
  };

  const replanPlan: AgentTool<
    typeof replanPlanSchema,
    { planId: string; replanId: string; revision: number }
  > = {
    name: "replan_plan",
    label: "Replan execution plan",
    description:
      "Apply a governed plan revision with current revision, reason, and evidence; supersede stale steps/artifacts, redirect dependencies, or add replacements.",
    parameters: replanPlanSchema,
    async execute(_toolCallId, input) {
      const current = assertPlanThread(store, input.planId, run.threadId);
      const request: ReplanExecutionPlanRequest = {
        expectedRevision: input.expectedRevision,
        strategy: input.strategy,
        reason: input.reason,
        evidence: input.evidence,
        ...(input.supersedeStepIds
          ? { supersedeStepIds: input.supersedeStepIds }
          : {}),
        ...(input.supersedeArtifactIds
          ? { supersedeArtifactIds: input.supersedeArtifactIds }
          : {}),
        ...(input.dependencyUpdates
          ? { dependencyUpdates: input.dependencyUpdates }
          : {}),
        ...(input.addSteps ? { addSteps: input.addSteps } : {}),
        ...(input.addArtifacts ? { addArtifacts: input.addArtifacts } : {}),
      };
      const plan = await store.replanPlan(input.planId, request);
      const replan = plan.replans.at(-1)!;
      if (plan.revision !== current.revision) {
        await store.appendEvent({
          threadId: run.threadId,
          runId: run.id,
          type: "plan.replanned",
          category: "plan",
          visibility: "user",
          payload: {
            planId: plan.id,
            replanId: replan.id,
            strategy: replan.strategy,
            fromRevision: replan.fromRevision,
            toRevision: replan.toRevision,
            replanSha256: replan.replanSha256,
            addedStepIds: replan.addedStepIds,
            addedArtifactIds: replan.addedArtifactIds,
            supersededStepIds: replan.supersededStepIds,
            supersededArtifactIds: replan.supersededArtifactIds,
            dependencyUpdatedStepIds: replan.dependencyUpdatedStepIds,
            addedStepsSha256: replan.addedStepsSha256,
            addedArtifactsSha256: replan.addedArtifactsSha256,
            dependencyUpdatesSha256: replan.dependencyUpdatesSha256,
            status: plan.status,
            criticalPathStepIds: plan.criticalPathStepIds,
            readyStepIds: plan.readyStepIds,
            blockedStepIds: plan.blockedStepIds,
            activePhaseIndex: plan.activePhaseIndex,
            parallelReadyStepIds: plan.parallelReadyStepIds,
            phaseWaveCount: plan.phaseWaves.length,
            phaseProjectionSha256: plan.phaseProjectionSha256,
          },
        });
      }
      return planToolResult(
        plan,
        {
          planId: plan.id,
          replanId: replan.id,
          revision: plan.revision,
        },
        replanPolicyTemplate,
      );
    },
  };

  const updateArtifact: AgentTool<
    typeof updatePlanArtifactSchema,
    { planId: string; artifactId: string; status: string }
  > = {
    name: "update_plan_artifact",
    label: "Update plan artifact",
    description:
      "Record or verify a planned artifact. File/directory verification hashes actual workspace bytes; the model cannot supply the digest.",
    parameters: updatePlanArtifactSchema,
    async execute(_toolCallId, input) {
      const current = assertPlanThread(store, input.planId, run.threadId);
      const artifact = current.artifacts.find(
        (candidate) => candidate.id === input.artifactId,
      );
      if (!artifact) throw new Error(`Artifact not found: ${input.artifactId}`);
      const request = await buildArtifactUpdate(
        store.workspaceRoot,
        run,
        artifact,
        input.action,
        input.evidence,
      );
      const plan = await store.updatePlanArtifact(
        current.id,
        artifact.id,
        request,
      );
      const updated = plan.artifacts.find(
        (candidate) => candidate.id === artifact.id,
      )!;
      if (plan.revision !== current.revision) {
        await store.appendEvent({
          threadId: run.threadId,
          runId: run.id,
          type: `plan.artifact.${updated.status}`,
          category: "plan",
          visibility: "user",
          payload: createPlanArtifactEventPayload(plan, updated),
        });
      }
      return planToolResult(
        plan,
        {
          planId: plan.id,
          artifactId: updated.id,
          status: updated.status,
        },
        replanPolicyTemplate,
      );
    },
  };

  return [createPlan, transitionStep, updateArtifact, replanPlan];
}

async function buildArtifactUpdate(
  workspaceRoot: string,
  run: RunRecord,
  artifact: ExecutionPlan["artifacts"][number],
  action: "produced" | "verify" | "missing" | "superseded",
  evidence: string,
): Promise<UpdateArtifactManifestRequest> {
  if (action === "superseded") {
    return { status: "superseded", sourceRunId: run.id, evidence };
  }
  if (artifact.kind !== "file" && artifact.kind !== "directory") {
    if (action === "verify") {
      throw new Error("Only workspace files and directories can be verified");
    }
    return {
      status: action,
      sourceRunId: run.id,
      evidence,
    };
  }
  if (!isPathInsideWorkspace(artifact.path, workspaceRoot)) {
    throw new Error("Artifact path escapes the configured workspace");
  }
  const target = path.resolve(workspaceRoot, artifact.path);
  if (action === "missing") {
    if (artifact.status === "verified") {
      return createWorkspaceArtifactDriftRequest(workspaceRoot, artifact, {
        sourceRunId: run.id,
        evidence,
      });
    }
    try {
      await stat(target);
    } catch (error) {
      if (isMissingFileError(error)) {
        return {
          status: "missing",
          sourceRunId: run.id,
          evidence,
        };
      }
      throw error;
    }
    throw new Error("Artifact exists and cannot be marked missing");
  }
  const { target: observedTarget, info } = await inspectWorkspaceArtifactTarget(
    workspaceRoot,
    artifact,
  );
  if (action === "produced") {
    return {
      status: "produced",
      sourceRunId: run.id,
      sizeBytes: info.size,
      evidence,
    };
  }
  if (artifact.kind === "directory") {
    const digest = await hashWorkspaceDirectory(observedTarget);
    assertVerifiedArtifactDigestMatches(artifact, digest.sha256);
    return {
      status: "verified",
      sourceRunId: run.id,
      sha256: digest.sha256,
      sizeBytes: digest.sizeBytes,
      evidence,
    };
  }
  if (info.size > MAX_ARTIFACT_HASH_BYTES) {
    throw new Error(
      `Artifact exceeds the ${MAX_ARTIFACT_HASH_BYTES / 1024 / 1024} MB verification limit`,
    );
  }
  const contents = await readFile(observedTarget);
  const observedSha256 = sha256(contents);
  assertVerifiedArtifactDigestMatches(artifact, observedSha256);
  return {
    status: "verified",
    sourceRunId: run.id,
    sha256: observedSha256,
    sizeBytes: info.size,
    evidence,
  };
}

export async function createWorkspaceArtifactVerificationRequest(
  workspaceRoot: string,
  artifact: ExecutionPlan["artifacts"][number],
  input: Pick<UpdateArtifactManifestRequest, "evidence" | "sourceRunId">,
): Promise<UpdateArtifactManifestRequest> {
  if (artifact.kind !== "file" && artifact.kind !== "directory") {
    throw new Error("Only workspace files and directories can be verified");
  }
  if (!isPathInsideWorkspace(artifact.path, workspaceRoot)) {
    throw new Error("Artifact path escapes the configured workspace");
  }
  const { target, info } = await inspectWorkspaceArtifactTarget(
    workspaceRoot,
    artifact,
  );
  if (artifact.kind === "directory") {
    const digest = await hashWorkspaceDirectory(target);
    assertVerifiedArtifactDigestMatches(artifact, digest.sha256);
    return {
      status: "verified",
      sha256: digest.sha256,
      sizeBytes: digest.sizeBytes,
      ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
      ...(input.evidence ? { evidence: input.evidence } : {}),
    };
  }
  if (info.size > MAX_ARTIFACT_HASH_BYTES) {
    throw new Error(
      `Artifact exceeds the ${MAX_ARTIFACT_HASH_BYTES / 1024 / 1024} MB verification limit`,
    );
  }
  const contents = await readFile(target);
  const observedSha256 = sha256(contents);
  assertVerifiedArtifactDigestMatches(artifact, observedSha256);
  return {
    status: "verified",
    sha256: observedSha256,
    sizeBytes: info.size,
    ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
    ...(input.evidence ? { evidence: input.evidence } : {}),
  };
}

export async function createWorkspaceArtifactDriftRequest(
  workspaceRoot: string,
  artifact: ExecutionPlan["artifacts"][number],
  input: Pick<UpdateArtifactManifestRequest, "evidence" | "sourceRunId">,
): Promise<UpdateArtifactManifestRequest> {
  if (artifact.status !== "verified") {
    throw new Error("Only verified artifacts can be drift-checked");
  }
  if (artifact.kind !== "file" && artifact.kind !== "directory") {
    throw new Error(
      "Only workspace files and directories can be drift-checked",
    );
  }
  if (!isPathInsideWorkspace(artifact.path, workspaceRoot)) {
    throw new Error("Artifact path escapes the configured workspace");
  }
  let observed: { target: string; info: Stats };
  try {
    observed = await inspectWorkspaceArtifactTarget(workspaceRoot, artifact);
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        status: "missing",
        confirmedDrift: true,
        ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
        ...(input.evidence ? { evidence: input.evidence } : {}),
      };
    }
    throw error;
  }
  if (artifact.kind === "directory") {
    const digest = await hashWorkspaceDirectory(observed.target);
    assertVerifiedArtifactDigestDrifted(artifact, digest.sha256);
    return {
      status: "missing",
      confirmedDrift: true,
      ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
      ...(input.evidence ? { evidence: input.evidence } : {}),
    };
  }
  if (observed.info.size > MAX_ARTIFACT_HASH_BYTES) {
    throw new Error(
      `Artifact exceeds the ${MAX_ARTIFACT_HASH_BYTES / 1024 / 1024} MB verification limit`,
    );
  }
  const contents = await readFile(observed.target);
  assertVerifiedArtifactDigestDrifted(artifact, sha256(contents));
  return {
    status: "missing",
    confirmedDrift: true,
    ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
    ...(input.evidence ? { evidence: input.evidence } : {}),
  };
}

export async function inspectWorkspaceArtifactDrift(
  workspaceRoot: string,
  artifact: ExecutionPlan["artifacts"][number],
): Promise<WorkspaceArtifactDriftInspection> {
  if (artifact.status !== "verified") {
    throw new Error("Only verified artifacts can be drift-checked");
  }
  if (!artifact.sha256) {
    throw new Error("Verified artifact is missing its stored digest");
  }
  if (artifact.kind !== "file" && artifact.kind !== "directory") {
    throw new Error(
      "Only workspace files and directories can be drift-checked",
    );
  }
  if (!isPathInsideWorkspace(artifact.path, workspaceRoot)) {
    throw new Error("Artifact path escapes the configured workspace");
  }
  let observed: { target: string; info: Stats };
  try {
    observed = await inspectWorkspaceArtifactTarget(workspaceRoot, artifact);
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        result: "missing",
        expectedSha256: artifact.sha256,
      };
    }
    throw error;
  }
  if (artifact.kind === "directory") {
    const digest = await hashWorkspaceDirectory(observed.target);
    return {
      result: digest.sha256 === artifact.sha256 ? "current" : "drifted",
      expectedSha256: artifact.sha256,
      observedSha256: digest.sha256,
      sizeBytes: digest.sizeBytes,
    };
  }
  if (observed.info.size > MAX_ARTIFACT_HASH_BYTES) {
    throw new Error(
      `Artifact exceeds the ${MAX_ARTIFACT_HASH_BYTES / 1024 / 1024} MB verification limit`,
    );
  }
  const contents = await readFile(observed.target);
  const observedSha256 = sha256(contents);
  return {
    result: observedSha256 === artifact.sha256 ? "current" : "drifted",
    expectedSha256: artifact.sha256,
    observedSha256,
    sizeBytes: observed.info.size,
  };
}

export async function exportWorkspaceFileArtifact(
  workspaceRoot: string,
  artifact: ExecutionPlan["artifacts"][number],
): Promise<WorkspaceFileArtifactExport> {
  if (artifact.kind !== "file") {
    throw new Error("Only file artifacts can be exported");
  }
  if (artifact.status !== "produced" && artifact.status !== "verified") {
    throw new Error("Only produced or verified artifacts can be exported");
  }
  if (!isPathInsideWorkspace(artifact.path, workspaceRoot)) {
    throw new Error("Artifact path escapes the configured workspace");
  }
  const { target, info } = await inspectWorkspaceArtifactTarget(
    workspaceRoot,
    artifact,
  );
  if (info.size > MAX_ARTIFACT_HASH_BYTES) {
    throw new Error(
      `Artifact exceeds the ${MAX_ARTIFACT_HASH_BYTES / 1024 / 1024} MB verification limit`,
    );
  }
  const contents = await readFile(target);
  const observedSha256 = sha256(contents);
  assertVerifiedArtifactDigestMatches(artifact, observedSha256);
  return {
    contents,
    sha256: observedSha256,
    sizeBytes: info.size,
  };
}

export async function previewWorkspaceTextArtifact(
  workspaceRoot: string,
  artifact: ExecutionPlan["artifacts"][number],
): Promise<WorkspaceTextArtifactPreview> {
  if (artifact.kind !== "file") {
    throw new Error("Only file artifacts can be previewed");
  }
  if (artifact.status !== "produced" && artifact.status !== "verified") {
    throw new Error("Only produced or verified artifacts can be previewed");
  }
  if (!isPathInsideWorkspace(artifact.path, workspaceRoot)) {
    throw new Error("Artifact path escapes the configured workspace");
  }
  const { target, info } = await inspectWorkspaceArtifactTarget(
    workspaceRoot,
    artifact,
  );
  if (info.size > MAX_ARTIFACT_PREVIEW_BYTES) {
    throw new Error(
      `Artifact preview exceeds the ${MAX_ARTIFACT_PREVIEW_BYTES / 1024} KiB limit`,
    );
  }
  const contents = await readFile(target);
  const observedSha256 = sha256(contents);
  assertVerifiedArtifactDigestMatches(artifact, observedSha256);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(contents);
  } catch {
    throw new Error("Artifact preview requires valid UTF-8 text");
  }
  return {
    text,
    sha256: observedSha256,
    sizeBytes: info.size,
    lineCount: text.length === 0 ? 0 : text.split(/\r\n|\r|\n/u).length,
  };
}

export async function previewWorkspaceDataArtifactProfile(
  workspaceRoot: string,
  artifact: ExecutionPlan["artifacts"][number],
): Promise<WorkspaceDataArtifactProfile> {
  if (artifact.kind !== "file") {
    throw new Error("Only file artifacts can expose a data profile");
  }
  if (artifact.status !== "produced" && artifact.status !== "verified") {
    throw new Error(
      "Only produced or verified artifacts can expose a data profile",
    );
  }
  if (!isPathInsideWorkspace(artifact.path, workspaceRoot)) {
    throw new Error("Artifact path escapes the configured workspace");
  }
  const { target, info } = await inspectWorkspaceArtifactTarget(
    workspaceRoot,
    artifact,
  );
  if (info.size > MAX_ARTIFACT_DATA_PROFILE_BYTES) {
    throw new Error(
      `Artifact data profile exceeds the ${MAX_ARTIFACT_DATA_PROFILE_BYTES / 1024 / 1024} MB limit`,
    );
  }
  const contents = await readFile(target);
  const observedSha256 = sha256(contents);
  assertVerifiedArtifactDigestMatches(artifact, observedSha256);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(contents);
  } catch {
    throw new Error("Artifact data profile requires valid UTF-8 text");
  }
  const profile = inspectStructuredData(
    text,
    artifact.path,
    "auto",
    MAX_ARTIFACT_DATA_PROFILE_ROWS,
    "Artifact data profile",
  );
  return {
    ...profile,
    sha256: observedSha256,
    sizeBytes: info.size,
    columnSetSha256: sha256(canonicalJson(profile.columns)),
    sampleSha256: sha256(canonicalJson(profile.sampleRows)),
  };
}

export async function previewWorkspaceDirectoryArtifactManifest(
  workspaceRoot: string,
  artifact: ExecutionPlan["artifacts"][number],
): Promise<WorkspaceDirectoryArtifactManifest> {
  if (artifact.kind !== "directory") {
    throw new Error("Only directory artifacts can expose a manifest");
  }
  if (artifact.status !== "produced" && artifact.status !== "verified") {
    throw new Error(
      "Only produced or verified artifacts can expose a manifest",
    );
  }
  if (!isPathInsideWorkspace(artifact.path, workspaceRoot)) {
    throw new Error("Artifact path escapes the configured workspace");
  }
  const { target } = await inspectWorkspaceArtifactTarget(
    workspaceRoot,
    artifact,
  );
  const manifest = await createWorkspaceDirectoryManifest(target);
  if (manifest.entryCount > MAX_ARTIFACT_DIRECTORY_MANIFEST_ENTRIES) {
    throw new Error(
      `Artifact directory manifest exceeds the ${MAX_ARTIFACT_DIRECTORY_MANIFEST_ENTRIES} entry preview limit`,
    );
  }
  assertVerifiedArtifactDigestMatches(artifact, manifest.sha256);
  return manifest;
}

function assertVerifiedArtifactDigestMatches(
  artifact: ExecutionPlan["artifacts"][number],
  observedSha256: string,
): void {
  if (artifact.status !== "verified") return;
  if (!artifact.sha256) {
    throw new Error("Verified artifact is missing its stored digest");
  }
  if (artifact.sha256 !== observedSha256) {
    throw new Error(
      "Verified artifact digest drifted; replan before replacing it",
    );
  }
}

function assertVerifiedArtifactDigestDrifted(
  artifact: ExecutionPlan["artifacts"][number],
  observedSha256: string,
): void {
  if (!artifact.sha256) {
    throw new Error("Verified artifact is missing its stored digest");
  }
  if (artifact.sha256 === observedSha256) {
    throw new Error("Verified artifact still matches its stored digest");
  }
}

async function inspectWorkspaceArtifactTarget(
  workspaceRoot: string,
  artifact: ExecutionPlan["artifacts"][number],
): Promise<{ target: string; info: Stats }> {
  const target = path.resolve(workspaceRoot, artifact.path);
  const linkInfo = await lstat(target);
  if (linkInfo.isSymbolicLink()) {
    throw new Error("Plan artifacts cannot be symbolic links");
  }
  const [realWorkspaceRoot, realTarget, info] = await Promise.all([
    realpath(workspaceRoot),
    realpath(target),
    stat(target),
  ]);
  if (!isPathInsideWorkspace(realTarget, realWorkspaceRoot)) {
    throw new Error("Artifact path escapes the configured workspace");
  }
  if (artifact.kind === "file" && !info.isFile()) {
    throw new Error("Planned file artifact is not a file");
  }
  if (artifact.kind === "directory" && !info.isDirectory()) {
    throw new Error("Planned directory artifact is not a directory");
  }
  return { target: realTarget, info };
}

async function hashWorkspaceDirectory(
  target: string,
): Promise<{ sha256: string; sizeBytes: number }> {
  const manifest = await createWorkspaceDirectoryManifest(target);
  return {
    sha256: manifest.sha256,
    sizeBytes: manifest.sizeBytes,
  };
}

async function createWorkspaceDirectoryManifest(
  target: string,
): Promise<WorkspaceDirectoryArtifactManifest> {
  const entries: WorkspaceDirectoryArtifactManifestEntry[] = [];
  let totalBytes = 0;
  await walkDirectory(target, ".", entries, (byteLength) => {
    totalBytes += byteLength;
    if (totalBytes > MAX_ARTIFACT_HASH_BYTES) {
      throw new Error(
        `Artifact exceeds the ${MAX_ARTIFACT_HASH_BYTES / 1024 / 1024} MB verification limit`,
      );
    }
  });
  const digestContent = {
    kind: DIRECTORY_DIGEST_KIND,
    schemaVersion: 1,
    entries,
  };
  const fileCount = entries.filter((entry) => entry.kind === "file").length;
  const directoryCount = entries.filter(
    (entry) => entry.kind === "directory",
  ).length;
  return {
    entries,
    sha256: sha256(canonicalJson(digestContent)),
    sizeBytes: totalBytes,
    entryCount: entries.length,
    fileCount,
    directoryCount,
  };
}

async function walkDirectory(
  directory: string,
  relativePath: string,
  entries: WorkspaceDirectoryArtifactManifestEntry[],
  recordBytes: (byteLength: number) => void,
): Promise<void> {
  const info = await lstat(directory);
  if (info.isSymbolicLink()) {
    throw new Error("Directory artifacts cannot contain symbolic links");
  }
  if (!info.isDirectory()) {
    throw new Error("Directory artifact entry is not a directory");
  }
  entries.push({ kind: "directory", path: relativePath });
  const children = (await readdir(directory, { withFileTypes: true })).sort(
    (left, right) => left.name.localeCompare(right.name),
  );
  for (const child of children) {
    const childRelativePath =
      relativePath === "." ? child.name : `${relativePath}/${child.name}`;
    const childPath = path.join(directory, child.name);
    const childInfo = await lstat(childPath);
    if (childInfo.isSymbolicLink()) {
      throw new Error("Directory artifacts cannot contain symbolic links");
    }
    if (childInfo.isDirectory()) {
      await walkDirectory(childPath, childRelativePath, entries, recordBytes);
      continue;
    }
    if (!childInfo.isFile()) {
      throw new Error("Directory artifacts can only contain files");
    }
    if (childInfo.size > MAX_ARTIFACT_HASH_BYTES) {
      throw new Error(
        `Artifact exceeds the ${MAX_ARTIFACT_HASH_BYTES / 1024 / 1024} MB verification limit`,
      );
    }
    const contents = await readFile(childPath);
    recordBytes(contents.byteLength);
    entries.push({
      kind: "file",
      path: childRelativePath,
      sha256: sha256(contents),
      sizeBytes: contents.byteLength,
    });
  }
}

function assertPlanThread(
  store: LocalStore,
  planId: string,
  threadId: string,
): ExecutionPlan {
  const plan = store.getPlan(planId);
  if (plan.threadId !== threadId) {
    throw new Error(`Plan not found in thread: ${planId}`);
  }
  return plan;
}

function planToolResult<TDetails>(
  plan: ExecutionPlan,
  details: TDetails,
  replanPolicyTemplate: ExecutionPlanReplanPolicyTemplate,
): {
  content: Array<{ type: "text"; text: string }>;
  details: TDetails;
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          planId: plan.id,
          status: plan.status,
          revision: plan.revision,
          replanCount: plan.replans.length,
          latestReplanSha256: plan.replans.at(-1)?.replanSha256,
          replanRecommendation: plan.replanRecommendation
            ? {
                strategy: plan.replanRecommendation.strategy,
                expectedRevision: plan.replanRecommendation.expectedRevision,
                supersedeStepIds: plan.replanRecommendation.supersedeStepIds,
                supersedeArtifactIds:
                  plan.replanRecommendation.supersedeArtifactIds,
                affectedStepIds: plan.replanRecommendation.affectedStepIds,
                affectedArtifactIds:
                  plan.replanRecommendation.affectedArtifactIds,
                draft: plan.replanRecommendation.draft,
                policyTemplate: replanPolicyTemplate,
                recommendationSha256:
                  plan.replanRecommendation.recommendationSha256,
              }
            : null,
          criticalPathStepIds: plan.criticalPathStepIds,
          readyStepIds: plan.readyStepIds,
          blockedStepIds: plan.blockedStepIds,
          activePhaseIndex: plan.activePhaseIndex,
          parallelReadyStepIds: plan.parallelReadyStepIds,
          phaseWaveCount: plan.phaseWaves.length,
          phaseProjectionSha256: plan.phaseProjectionSha256,
          steps: plan.steps.map((step) => ({
            id: step.id,
            status: step.status,
          })),
          artifacts: plan.artifacts.map((artifact) => ({
            id: artifact.id,
            status: artifact.status,
          })),
        }),
      },
    ],
    details,
  };
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
