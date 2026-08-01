import { createHash } from "node:crypto";

import {
  AGENT_TOOL_NAMES,
  NAPIER_API_VERSION,
  type AgentProfile,
  type AgentProfileRevision,
  type ExecutionPlan,
  type EvaluationAdjudication,
  type EvaluationConsensusResolution,
  type EvaluationReviewerBallot,
  type EvaluationSuite,
  type EvaluationSuiteExecution,
  type EvaluationRubricSnapshot,
  type RunEvent,
  type RunEvaluationRecord,
  type SubagentTask,
  type ThreadDetail,
  type ThreadImportProvenance,
  type ThreadReplayBundle,
  type ThreadReplayBundleVerification,
} from "@napier/contracts";

import {
  normalizeAutomaticRecoveryPolicy,
  validateAgentProfileRevision,
} from "./agents.js";
import { assertArtifactReceiptEventBoundary } from "./artifact-receipts.js";
import {
  hashAutomaticRecoveryEventStream,
  validateAutomaticRecoveryAssessment,
  validateAutomaticRecoveryAttempt,
} from "./automatic-recovery.js";
import { validateEvaluationAdjudication } from "./evaluation-calibration.js";
import {
  validateEvaluationConsensusResolution,
  validateEvaluationReviewerBallot,
} from "./evaluation-consensus.js";
import {
  hashEvaluationSuiteExecution,
  hashRunEvaluation,
  normalizeEvaluationSuiteGate,
} from "./evaluation-suites.js";
import { normalizeRubric } from "./evaluation.js";
import {
  assertRunEvaluationCompletedEventBindings,
  assertRunEvaluationGovernanceReceiptSourceBinding,
  assertRunEvaluationSnapshotSourceBinding,
} from "./evaluation-governance.js";
import { assertPlanArtifactEventBindings } from "./plans.js";
import {
  AGENT_MILESTONE_RECORDED_EVENT,
  projectAgentMilestones,
} from "./agent-milestones.js";
import { assertIndependentModelAdvisorReviewEvidenceBindings } from "./independent-model-advisor.js";
import {
  assertModelContextEnvelopeEventBindings,
  MODEL_CONTEXT_ENVELOPE_EVENT,
  validateModelContextEnvelopeReceipt,
} from "./model-context-envelope.js";
import { projectOperatorDecisions } from "./operator-decisions.js";
import {
  createPromptVariableCatalog,
  normalizePromptVariableDefinitions,
  PROMPT_VARIABLES_RESOLVED_EVENT,
  projectPromptVariableSnapshots,
} from "./prompt-variables.js";
import { validateRunConfigurationFingerprint } from "./run-config.js";
import {
  createToolLoopGuardContextReceipt,
  normalizeToolLoopGuardPolicy,
  projectToolLoopGuardContexts,
  projectToolLoopGuardTriggers,
  TOOL_LOOP_GUARD_CONTEXT_EVENT,
  TOOL_LOOP_GUARD_TRIGGERED_EVENT,
  validateToolLoopGuardTriggerEvidence,
} from "./tool-loop-guard.js";
import { assertSubagentOutcomeBinding } from "./subagent-outcomes.js";
import { subagentRoleInstructions } from "./subagent-role-instructions.js";
import {
  subagentOutcomeRepairInstructions,
  validateSubagentOutcomeRepairOutcome,
  validateSubagentOutcomeRepairRequest,
} from "./subagent-outcome-repair.js";

export const MAX_THREAD_REPLAY_BUNDLE_BYTES = 10 * 1024 * 1024;

const MAX_EVENTS = 50_000;
const MAX_AGENT_REVISIONS = 10_000;
const MAX_RUNS = 10_000;
const MAX_PLANS = 1_000;
const MAX_EVALUATIONS = 5_000;
const MAX_EVALUATION_ADJUDICATIONS = 5_000;
const MAX_EVALUATION_REVIEWER_BALLOTS = 45_000;
const MAX_EVALUATION_CONSENSUS_RESOLUTIONS = 5_000;
const MAX_EVALUATION_SUITES = 1_000;
const MAX_EVALUATION_SUITE_EXECUTIONS = 5_000;
const MAX_AUTOMATIC_RECOVERY_ASSESSMENTS = 10_000;
const MAX_AUTOMATIC_RECOVERY_ATTEMPTS = 10_000;
const MAX_SUBAGENTS = 10_000;
const THREAD_IMPORTED_EVENT = "thread.imported";
const RESOURCE_ID = /^[a-z][a-z0-9_]{2,80}$/;
const THREAD_STATUSES = new Set(["idle", "running", "waiting", "failed"]);
const RUN_STATUSES = new Set([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
const RUN_SOURCES = new Set([
  "user",
  "recovery",
  "schedule",
  "channel",
  "workflow",
  "workflow_reuse",
  "workflow_simulation",
  "model_experiment",
  "tool_experiment",
]);
const EVENT_CATEGORIES = new Set([
  "lifecycle",
  "message",
  "model",
  "tool",
  "artifact",
  "goal",
  "plan",
  "memory",
  "subagent",
  "extension",
  "credential",
  "evaluation",
  "automation",
  "channel",
  "system",
]);
const EVENT_VISIBILITIES = new Set(["user", "debug", "hidden"]);
const GOAL_STATUSES = new Set(["active", "completed", "blocked"]);
const GOAL_BLOCKERS = new Set([
  "none",
  "missing_evidence",
  "needs_user_input",
  "run_failed",
  "external_wait",
  "goal_not_met_yet",
]);
const PLAN_STATUSES = new Set(["active", "completed", "blocked", "cancelled"]);
const PLAN_STEP_STATUSES = new Set([
  "pending",
  "ready",
  "running",
  "completed",
  "blocked",
  "skipped",
]);
const ARTIFACT_STATUSES = new Set([
  "expected",
  "produced",
  "verified",
  "missing",
  "superseded",
]);
const SUBAGENT_STATUSES = new Set([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
]);
const SUBAGENT_ROLES = new Set(["researcher", "reviewer", "general", "coder"]);
const AGENT_TOOLS: ReadonlySet<string> = new Set(AGENT_TOOL_NAMES);
const SUBAGENT_STOP_REASONS = new Set([
  "completed",
  "turn_capped",
  "timeout",
  "cancelled",
  "error",
]);
const EVALUATION_VERDICTS = new Set([
  "left_better",
  "right_better",
  "tie",
  "inconclusive",
]);
const EVALUATION_SUITE_CASE_STATUSES = new Set([
  "passed",
  "failed",
  "inconclusive",
]);
const EVALUATION_SUITE_EXECUTION_STATUSES = new Set([
  "passed",
  "failed",
  "inconclusive",
]);
const REQUIRED_TOP_LEVEL_KEYS = new Set([
  "kind",
  "schemaVersion",
  "apiVersion",
  "generatedAt",
  "thread",
  "agent",
  "runs",
  "plans",
  "evaluations",
  "subagents",
  "events",
  "eventStreamSha256",
  "contentSha256",
]);
const OPTIONAL_TOP_LEVEL_KEYS = new Set([
  "agentRevisions",
  "evaluationAdjudications",
  "evaluationReviewerBallots",
  "evaluationConsensusResolutions",
  "evaluationSuites",
  "evaluationSuiteExecutions",
  "automaticRecoveryAssessments",
  "automaticRecoveryAttempts",
]);
const TOP_LEVEL_KEYS = new Set([
  ...REQUIRED_TOP_LEVEL_KEYS,
  ...OPTIONAL_TOP_LEVEL_KEYS,
]);

export function createThreadReplayBundle(
  detail: ThreadDetail,
  generatedAt = new Date(),
  agentRevisions?: AgentProfileRevision[],
): ThreadReplayBundle {
  if (!Number.isFinite(generatedAt.getTime())) {
    throw new Error("Thread replay bundle generation time is invalid");
  }
  const events = structuredClone(detail.events).sort(
    (left, right) => left.seq - right.seq,
  );
  const content = {
    kind: "napier.thread-replay" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    thread: structuredClone(detail.thread),
    agent: structuredClone(detail.agent),
    ...(agentRevisions !== undefined
      ? { agentRevisions: structuredClone(agentRevisions) }
      : {}),
    runs: structuredClone(detail.runs),
    plans: structuredClone(detail.plans),
    evaluations: structuredClone(detail.evaluations),
    evaluationAdjudications: structuredClone(detail.evaluationAdjudications),
    evaluationReviewerBallots: structuredClone(
      detail.evaluationReviewerBallots,
    ),
    evaluationConsensusResolutions: structuredClone(
      detail.evaluationConsensusResolutions,
    ),
    evaluationSuites: structuredClone(detail.evaluationSuites),
    evaluationSuiteExecutions: structuredClone(
      detail.evaluationSuiteExecutions,
    ),
    automaticRecoveryAssessments: structuredClone(
      detail.automaticRecoveryAssessments,
    ),
    automaticRecoveryAttempts: structuredClone(
      detail.automaticRecoveryAttempts,
    ),
    subagents: structuredClone(detail.subagents),
    events,
    eventStreamSha256: hashThreadEventStream(events),
  };
  const bundle: ThreadReplayBundle = {
    ...content,
    generatedAt: generatedAt.toISOString(),
    contentSha256: sha256(canonicalJson(content)),
  };
  return validateThreadReplayBundle(bundle);
}

export function validateThreadReplayBundle(input: unknown): ThreadReplayBundle {
  const serialized = stringifyBundle(input);
  if (Buffer.byteLength(serialized) > MAX_THREAD_REPLAY_BUNDLE_BYTES) {
    throw new Error(
      `Thread replay bundle exceeds ${MAX_THREAD_REPLAY_BUNDLE_BYTES} bytes`,
    );
  }
  assertJsonValue(input, "bundle");
  const record = assertRecord(input, "bundle");
  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    if (!(key in record)) {
      throw new Error(`Thread replay bundle is missing field: ${key}`);
    }
  }
  for (const key of Object.keys(record)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      throw new Error(`Thread replay bundle has unsupported field: ${key}`);
    }
  }
  if (record["kind"] !== "napier.thread-replay") {
    throw new Error("Thread replay bundle kind is invalid");
  }
  if (record["schemaVersion"] !== 1) {
    throw new Error("Thread replay bundle schemaVersion is unsupported");
  }
  if (record["apiVersion"] !== NAPIER_API_VERSION) {
    throw new Error(
      `Thread replay bundle API version is unsupported: ${String(record["apiVersion"])}`,
    );
  }
  assertIsoDate(record["generatedAt"], "generatedAt");
  assertSha256(record["eventStreamSha256"], "eventStreamSha256");
  assertSha256(record["contentSha256"], "contentSha256");

  const thread = assertRecord(record["thread"], "thread");
  const agent = assertRecord(record["agent"], "agent");
  const agentRevisions =
    record["agentRevisions"] === undefined
      ? undefined
      : assertBoundedArray(
          record["agentRevisions"],
          "agentRevisions",
          MAX_AGENT_REVISIONS,
        );
  const runs = assertBoundedArray(record["runs"], "runs", MAX_RUNS);
  const plans = assertBoundedArray(record["plans"], "plans", MAX_PLANS);
  const evaluations = assertBoundedArray(
    record["evaluations"],
    "evaluations",
    MAX_EVALUATIONS,
  );
  const evaluationAdjudications =
    record["evaluationAdjudications"] === undefined
      ? []
      : assertBoundedArray(
          record["evaluationAdjudications"],
          "evaluationAdjudications",
          MAX_EVALUATION_ADJUDICATIONS,
        );
  const evaluationReviewerBallots =
    record["evaluationReviewerBallots"] === undefined
      ? []
      : assertBoundedArray(
          record["evaluationReviewerBallots"],
          "evaluationReviewerBallots",
          MAX_EVALUATION_REVIEWER_BALLOTS,
        );
  const evaluationConsensusResolutions =
    record["evaluationConsensusResolutions"] === undefined
      ? []
      : assertBoundedArray(
          record["evaluationConsensusResolutions"],
          "evaluationConsensusResolutions",
          MAX_EVALUATION_CONSENSUS_RESOLUTIONS,
        );
  const evaluationSuites =
    record["evaluationSuites"] === undefined
      ? []
      : assertBoundedArray(
          record["evaluationSuites"],
          "evaluationSuites",
          MAX_EVALUATION_SUITES,
        );
  const evaluationSuiteExecutions =
    record["evaluationSuiteExecutions"] === undefined
      ? []
      : assertBoundedArray(
          record["evaluationSuiteExecutions"],
          "evaluationSuiteExecutions",
          MAX_EVALUATION_SUITE_EXECUTIONS,
        );
  const automaticRecoveryAssessments =
    record["automaticRecoveryAssessments"] === undefined
      ? []
      : assertBoundedArray(
          record["automaticRecoveryAssessments"],
          "automaticRecoveryAssessments",
          MAX_AUTOMATIC_RECOVERY_ASSESSMENTS,
        );
  const automaticRecoveryAttempts =
    record["automaticRecoveryAttempts"] === undefined
      ? []
      : assertBoundedArray(
          record["automaticRecoveryAttempts"],
          "automaticRecoveryAttempts",
          MAX_AUTOMATIC_RECOVERY_ATTEMPTS,
        );
  const subagents = assertBoundedArray(
    record["subagents"],
    "subagents",
    MAX_SUBAGENTS,
  );
  const events = assertBoundedArray(record["events"], "events", MAX_EVENTS);

  const threadId = assertResourceId(thread["id"], "thread.id");
  const agentId = assertResourceId(agent["id"], "agent.id");
  if (thread["agentId"] !== agentId) {
    throw new Error("Thread replay bundle Agent does not own the Thread");
  }
  assertString(thread["title"], "thread.title", 200);
  assertEnum(thread["status"], THREAD_STATUSES, "thread.status");
  assertIsoDate(thread["createdAt"], "thread.createdAt");
  assertIsoDate(thread["updatedAt"], "thread.updatedAt");
  assertText(thread["lastMessage"], "thread.lastMessage", 200_000);
  const threadEventCount = assertNonNegativeInteger(
    thread["eventCount"],
    "thread.eventCount",
  );
  const goal =
    thread["goal"] === undefined
      ? undefined
      : assertGoal(thread["goal"], "thread.goal");
  if (threadEventCount !== events.length) {
    throw new Error(
      `Thread replay bundle event count mismatch: thread=${String(thread["eventCount"])}, events=${events.length}`,
    );
  }
  const threadRunIds = assertStringArray(thread["runIds"], "thread.runIds");
  const threadImportProvenance =
    thread["importProvenance"] === undefined
      ? undefined
      : assertThreadImportProvenance(
          thread["importProvenance"],
          threadEventCount,
        );
  assertString(agent["name"], "agent.name", 200);
  assertString(agent["description"], "agent.description", 500);
  assertString(agent["systemPrompt"], "agent.systemPrompt", 200_000);
  assertModel(agent["model"], "agent.model");
  assertEnum(
    agent["thinkingLevel"],
    new Set(["off", "minimal", "low", "medium", "high"]),
    "agent.thinkingLevel",
  );
  assertEnum(
    agent["toolPolicy"],
    new Set(["observe", "workspace", "unrestricted"]),
    "agent.toolPolicy",
  );
  const enabledTools = assertTextArray(
    agent["enabledTools"],
    "agent.enabledTools",
    100,
  );
  for (const tool of enabledTools) {
    assertEnum(tool, AGENT_TOOLS, "agent.enabledTools");
  }
  assertTextArray(agent["enabledSkills"], "agent.enabledSkills", 1_000);
  if (agent["enabledSubagents"] !== undefined) {
    const roles = assertTextArray(
      agent["enabledSubagents"],
      "agent.enabledSubagents",
      3,
    );
    for (const role of roles) {
      assertEnum(role, SUBAGENT_ROLES, "agent.enabledSubagents");
    }
  }
  assertPositiveInteger(agent["revision"], "agent.revision");
  assertIsoDate(agent["createdAt"], "agent.createdAt");
  assertIsoDate(agent["updatedAt"], "agent.updatedAt");
  if (agent["subagentLimits"] !== undefined) {
    const limits = assertRecord(
      agent["subagentLimits"],
      "agent.subagentLimits",
    );
    for (const key of ["maxConcurrent", "maxTotal", "maxTurns", "timeoutMs"]) {
      assertPositiveInteger(limits[key], `agent.subagentLimits.${key}`);
    }
  }
  if (agent["runLimits"] !== undefined) {
    assertRunLimits(agent["runLimits"], "agent.runLimits");
  }
  if (agent["automaticRecovery"] !== undefined) {
    normalizeAutomaticRecoveryPolicy(
      agent["automaticRecovery"] as AgentProfile["automaticRecovery"] & object,
    );
  }
  if (agent["modelAdvisor"] !== undefined) {
    const modelAdvisor = assertRecord(
      agent["modelAdvisor"],
      "agent.modelAdvisor",
    );
    assertEnum(
      modelAdvisor["mode"],
      new Set(["observe", "enforce", "off"]),
      "agent.modelAdvisor.mode",
    );
    const enabledRules = assertTextArray(
      modelAdvisor["enabledRules"],
      "agent.modelAdvisor.enabledRules",
      10,
    );
    for (const rule of enabledRules) {
      assertEnum(
        rule,
        new Set([
          "unverified_verification_claim",
          "destructive_command_reference",
        ]),
        "agent.modelAdvisor.enabledRules",
      );
    }
    if (modelAdvisor["maxCorrectionAttempts"] !== undefined) {
      const maxCorrectionAttempts = modelAdvisor["maxCorrectionAttempts"];
      if (
        typeof maxCorrectionAttempts !== "number" ||
        !Number.isSafeInteger(maxCorrectionAttempts) ||
        maxCorrectionAttempts < 0 ||
        maxCorrectionAttempts > 3
      ) {
        throw new Error(
          "agent.modelAdvisor.maxCorrectionAttempts must be an integer between 0 and 3",
        );
      }
    }
  }
  if (agent["promptVariables"] !== undefined) {
    const promptVariables = normalizePromptVariableDefinitions(
      agent["promptVariables"] as NonNullable<AgentProfile["promptVariables"]>,
    );
    if (
      JSON.stringify(promptVariables) !==
      JSON.stringify(agent["promptVariables"])
    ) {
      throw new Error("agent.promptVariables must be canonical");
    }
  }
  if (agent["toolLoopGuard"] !== undefined) {
    const toolLoopGuard = normalizeToolLoopGuardPolicy(
      agent["toolLoopGuard"] as AgentProfile["toolLoopGuard"],
    );
    if (
      JSON.stringify(toolLoopGuard) !== JSON.stringify(agent["toolLoopGuard"])
    ) {
      throw new Error("agent.toolLoopGuard must be canonical");
    }
  }
  const agentProfilesByRevision = new Map<number, AgentProfile>([
    [Number(agent["revision"]), record["agent"] as AgentProfile],
  ]);
  if (agentRevisions !== undefined) {
    const revisionNumbers = new Set<number>();
    let currentRevision: AgentProfileRevision | undefined;
    for (const [index, input] of agentRevisions.entries()) {
      const revision = validateAgentProfileRevision(input);
      if (
        revision.agentId !== agentId ||
        revision.revision > Number(agent["revision"]) ||
        revisionNumbers.has(revision.revision)
      ) {
        throw new Error(
          `Thread replay bundle Agent revision is invalid: agentRevisions[${index}]`,
        );
      }
      revisionNumbers.add(revision.revision);
      agentProfilesByRevision.set(revision.revision, revision.profile);
      if (revision.revision === agent["revision"]) currentRevision = revision;
    }
    if (
      !currentRevision ||
      JSON.stringify(currentRevision.profile) !==
        JSON.stringify(record["agent"])
    ) {
      throw new Error(
        "Thread replay bundle current Agent revision does not match Agent",
      );
    }
  }

  const runIds = new Set<string>();
  const runRecords: Record<string, unknown>[] = [];
  for (const [index, value] of runs.entries()) {
    const run = assertRecord(value, `runs[${index}]`);
    runRecords.push(run);
    const runId = assertResourceId(run["id"], `runs[${index}].id`);
    assertUnique(runIds, runId, "run");
    if (run["threadId"] !== threadId || run["agentId"] !== agentId) {
      throw new Error(
        `Thread replay bundle run ownership is invalid: ${runId}`,
      );
    }
    assertEnum(run["status"], RUN_STATUSES, `runs[${index}].status`);
    if (run["source"] !== undefined) {
      assertEnum(run["source"], RUN_SOURCES, `runs[${index}].source`);
    }
    if (run["workflowPlanId"] !== undefined) {
      assertResourceId(run["workflowPlanId"], `runs[${index}].workflowPlanId`);
      if (
        run["source"] !== "workflow" &&
        run["source"] !== "workflow_simulation"
      ) {
        throw new Error(
          `Thread replay bundle Workflow Run Plan binding is invalid: ${runId}`,
        );
      }
    } else if (run["source"] === "workflow_simulation") {
      throw new Error(
        `Thread replay bundle Workflow simulation Plan binding is missing: ${runId}`,
      );
    }
    assertIsoDate(run["startedAt"], `runs[${index}].startedAt`);
    for (const key of ["finishedAt", "interruptedAt"]) {
      if (run[key] !== undefined) {
        assertIsoDate(run[key], `runs[${index}].${key}`);
      }
    }
    assertUsage(run["usage"], `runs[${index}].usage`);
    if (run["agentRevision"] !== undefined) {
      assertPositiveInteger(
        run["agentRevision"],
        `runs[${index}].agentRevision`,
      );
    }
    if (run["limits"] !== undefined) {
      assertRunLimits(run["limits"], `runs[${index}].limits`);
    }
    if (run["configuration"] !== undefined) {
      const configuration = validateRunConfigurationFingerprint(
        run["configuration"],
      );
      if (
        (run["agentRevision"] !== undefined &&
          run["agentRevision"] !== configuration.agentRevision) ||
        (run["limits"] !== undefined &&
          JSON.stringify(run["limits"]) !==
            JSON.stringify(configuration.runLimits))
      ) {
        throw new Error(
          `Thread replay bundle run configuration conflicts with run: ${runId}`,
        );
      }
      if (
        configuration.schemaVersion === 7 ||
        configuration.schemaVersion === 8
      ) {
        const runAgentProfile = agentProfilesByRevision.get(
          configuration.agentRevision,
        );
        if (
          !runAgentProfile ||
          configuration.systemPromptSha256 !==
            sha256(runAgentProfile.systemPrompt) ||
          configuration.promptVariableCatalogSha256 !==
            createPromptVariableCatalog(runAgentProfile.promptVariables)
              .contentSha256
        ) {
          throw new Error(
            `Thread replay bundle Prompt configuration does not match Agent revision: ${runId}`,
          );
        }
        if (
          configuration.schemaVersion === 8 &&
          JSON.stringify(configuration.toolLoopGuard) !==
            JSON.stringify(
              normalizeToolLoopGuardPolicy(runAgentProfile.toolLoopGuard),
            )
        ) {
          throw new Error(
            `Thread replay bundle schema-8 loop guard does not match Agent revision: ${runId}`,
          );
        }
      }
    }
  }
  if (
    threadRunIds.length !== runIds.size ||
    threadRunIds.some((runId) => !runIds.has(runId))
  ) {
    throw new Error("Thread replay bundle thread.runIds do not match runs");
  }
  if (
    thread["currentRunId"] !== undefined &&
    !runIds.has(String(thread["currentRunId"]))
  ) {
    throw new Error("Thread replay bundle currentRunId is unknown");
  }
  if (
    goal?.["lastEvaluatedRunId"] !== undefined &&
    !runIds.has(String(goal["lastEvaluatedRunId"]))
  ) {
    throw new Error("Thread replay bundle goal references unknown run");
  }

  const eventIds = new Set<string>();
  const eventRunIds = new Set<string>();
  const typedEvents: RunEvent[] = [];
  for (const [index, value] of events.entries()) {
    const event = assertRecord(value, `events[${index}]`);
    const eventId = assertResourceId(event["id"], `events[${index}].id`);
    assertUnique(eventIds, eventId, "event");
    if (event["threadId"] !== threadId) {
      throw new Error(
        `Thread replay bundle event ownership is invalid at sequence ${index + 1}`,
      );
    }
    if (event["seq"] !== index + 1) {
      throw new Error(
        `Thread replay bundle event sequence is invalid at ${index + 1}`,
      );
    }
    eventRunIds.add(assertResourceId(event["runId"], `events[${index}].runId`));
    assertString(event["type"], `events[${index}].type`, 160);
    assertEnum(
      event["category"],
      EVENT_CATEGORIES,
      `events[${index}].category`,
    );
    assertEnum(
      event["visibility"],
      EVENT_VISIBILITIES,
      `events[${index}].visibility`,
    );
    assertIsoDate(event["createdAt"], `events[${index}].createdAt`);
    assertJsonValue(event["payload"], `events[${index}].payload`);
    assertArtifactReceiptEventBoundary(
      event,
      `Thread replay bundle events[${index}]`,
    );
    typedEvents.push(value as RunEvent);
  }
  for (const [index, run] of runRecords.entries()) {
    if (
      run["parentRunId"] !== undefined &&
      !runIds.has(String(run["parentRunId"])) &&
      !hasExternalBranchParentEvidence(run, typedEvents, threadId)
    ) {
      throw new Error(
        `Thread replay bundle run references unknown parent: runs[${index}]`,
      );
    }
  }
  assertThreadImportProvenanceReceipt(threadImportProvenance, typedEvents);
  assertEmbeddedModelContextEnvelopeReceipts(record, "bundle");
  const runsById = new Map(
    runRecords.map((run) => [String(run["id"]), run] as const),
  );
  const milestoneEvents = typedEvents.filter(
    (event) => event.type === AGENT_MILESTONE_RECORDED_EVENT,
  );
  const milestones = projectAgentMilestones(typedEvents);
  if (milestones.length !== milestoneEvents.length) {
    throw new Error(
      "Thread replay bundle Agent milestone event chain is invalid",
    );
  }
  for (const milestone of milestones) {
    if (!runIds.has(milestone.runId)) {
      throw new Error(
        `Thread replay bundle Agent milestone references unknown Run: ${milestone.id}`,
      );
    }
  }
  assertIndependentModelAdvisorReviewEvidenceBindings(
    typedEvents,
    "Thread replay bundle",
  );
  const promptVariableEvents = typedEvents.filter(
    (event) => event.type === PROMPT_VARIABLES_RESOLVED_EVENT,
  );
  const promptVariableSnapshots =
    projectPromptVariableSnapshots(promptVariableEvents);
  if (promptVariableSnapshots.length !== promptVariableEvents.length) {
    throw new Error("Thread replay bundle Prompt Variable snapshot is invalid");
  }
  const promptVariableEventsByRun = new Map<string, number>();
  for (const [index, event] of promptVariableEvents.entries()) {
    const snapshot = promptVariableSnapshots[index]!;
    const run = runsById.get(event.runId);
    const configuration = run?.["configuration"]
      ? validateRunConfigurationFingerprint(run["configuration"])
      : undefined;
    const runAgentProfile =
      configuration?.schemaVersion === 7 || configuration?.schemaVersion === 8
        ? agentProfilesByRevision.get(configuration.agentRevision)
        : undefined;
    const definitions = runAgentProfile
      ? normalizePromptVariableDefinitions(runAgentProfile.promptVariables)
      : [];
    promptVariableEventsByRun.set(
      event.runId,
      (promptVariableEventsByRun.get(event.runId) ?? 0) + 1,
    );
    if (
      (configuration?.schemaVersion !== 7 &&
        configuration?.schemaVersion !== 8) ||
      configuration.promptVariableCatalogSha256 !== snapshot.catalogSha256 ||
      configuration.promptVariableSnapshotSha256 !== snapshot.contentSha256 ||
      configuration.resolvedSystemPromptSha256 !==
        snapshot.renderedSystemPromptSha256 ||
      !runAgentProfile ||
      snapshot.entries.length !== definitions.length ||
      snapshot.entries.some(
        (entry, entryIndex) =>
          entry.name !== definitions[entryIndex]?.name ||
          entry.type !== definitions[entryIndex]?.type,
      )
    ) {
      throw new Error(
        `Thread replay bundle Prompt Variable snapshot is not bound to Run: ${event.runId}`,
      );
    }
  }
  for (const run of runRecords) {
    const configuration = run["configuration"]
      ? validateRunConfigurationFingerprint(run["configuration"])
      : undefined;
    const eventCount = promptVariableEventsByRun.get(String(run["id"])) ?? 0;
    if (
      ((configuration?.schemaVersion === 7 ||
        configuration?.schemaVersion === 8) &&
        eventCount !== 1) ||
      (configuration?.schemaVersion !== 7 &&
        configuration?.schemaVersion !== 8 &&
        eventCount !== 0)
    ) {
      throw new Error(
        `Thread replay bundle Prompt Variable event count is invalid: ${String(run["id"])}`,
      );
    }
  }
  const toolLoopContextEvents = typedEvents.filter(
    (event) => event.type === TOOL_LOOP_GUARD_CONTEXT_EVENT,
  );
  const toolLoopContexts = projectToolLoopGuardContexts(toolLoopContextEvents);
  if (toolLoopContexts.length !== toolLoopContextEvents.length) {
    throw new Error("Thread replay bundle Tool Loop Guard context is invalid");
  }
  const toolLoopContextEventsByRun = new Map<string, number>();
  for (const [index, event] of toolLoopContextEvents.entries()) {
    const run = runsById.get(event.runId);
    const configuration = run?.["configuration"]
      ? validateRunConfigurationFingerprint(run["configuration"])
      : undefined;
    toolLoopContextEventsByRun.set(
      event.runId,
      (toolLoopContextEventsByRun.get(event.runId) ?? 0) + 1,
    );
    if (
      configuration?.schemaVersion !== 8 ||
      JSON.stringify(toolLoopContexts[index]) !==
        JSON.stringify(
          createToolLoopGuardContextReceipt(configuration.toolLoopGuard),
        )
    ) {
      throw new Error(
        `Thread replay bundle Tool Loop Guard context is not bound to Run: ${event.runId}`,
      );
    }
  }
  for (const run of runRecords) {
    const configuration = run["configuration"]
      ? validateRunConfigurationFingerprint(run["configuration"])
      : undefined;
    const eventCount = toolLoopContextEventsByRun.get(String(run["id"])) ?? 0;
    if (
      (configuration?.schemaVersion === 8 && eventCount !== 1) ||
      (configuration?.schemaVersion !== 8 && eventCount !== 0)
    ) {
      throw new Error(
        `Thread replay bundle Tool Loop Guard context count is invalid: ${String(run["id"])}`,
      );
    }
  }
  assertModelContextEnvelopeEventBindings(typedEvents, {
    knownRunIds: runIds,
    label: "Thread replay bundle Model Context Envelope",
  });
  const toolLoopTriggerEvents = typedEvents.filter(
    (event) => event.type === TOOL_LOOP_GUARD_TRIGGERED_EVENT,
  );
  const toolLoopTriggers = projectToolLoopGuardTriggers(toolLoopTriggerEvents);
  if (toolLoopTriggers.length !== toolLoopTriggerEvents.length) {
    throw new Error("Thread replay bundle Tool Loop Guard trigger is invalid");
  }
  const toolLoopTriggerKeys = new Set<string>();
  for (const [index, event] of toolLoopTriggerEvents.entries()) {
    const run = runsById.get(event.runId);
    const configuration = run?.["configuration"]
      ? validateRunConfigurationFingerprint(run["configuration"])
      : undefined;
    const triggerKey = `${event.runId}:${toolLoopTriggers[index]!.receipt.attemptSetSha256}`;
    if (
      toolLoopTriggerKeys.has(triggerKey) ||
      configuration?.schemaVersion !== 8 ||
      !validateToolLoopGuardTriggerEvidence(
        event,
        typedEvents,
        configuration.toolLoopGuard,
      )
    ) {
      throw new Error(
        `Thread replay bundle Tool Loop Guard trigger is not grounded: ${event.runId}`,
      );
    }
    toolLoopTriggerKeys.add(triggerKey);
  }
  for (const decision of projectOperatorDecisions(typedEvents)) {
    if (!runIds.has(decision.runId)) {
      throw new Error(
        `Thread replay bundle Operator Decision references unknown origin Run: ${decision.id}`,
      );
    }
    if (decision.status !== "continued") continue;
    const continuationRun = decision.continuationRunId
      ? runsById.get(decision.continuationRunId)
      : undefined;
    if (!continuationRun || continuationRun["parentRunId"] !== decision.runId) {
      throw new Error(
        `Thread replay bundle Operator Decision continuation binding is invalid: ${decision.id}`,
      );
    }
  }

  const planIds = new Set<string>();
  for (const [index, value] of plans.entries()) {
    const plan = assertRecord(value, `plans[${index}]`);
    const planId = assertResourceId(plan["id"], `plans[${index}].id`);
    assertUnique(planIds, planId, "plan");
    if (plan["threadId"] !== threadId) {
      throw new Error(
        `Thread replay bundle plan ownership is invalid: ${planId}`,
      );
    }
    assertString(plan["objective"], `plans[${index}].objective`, 20_000);
    assertEnum(plan["status"], PLAN_STATUSES, `plans[${index}].status`);
    assertPositiveInteger(plan["revision"], `plans[${index}].revision`);
    assertIsoDate(plan["createdAt"], `plans[${index}].createdAt`);
    assertIsoDate(plan["updatedAt"], `plans[${index}].updatedAt`);
    const steps = assertBoundedArray(
      plan["steps"],
      `plans[${index}].steps`,
      10_000,
    );
    for (const [stepIndex, stepValue] of steps.entries()) {
      const step = assertRecord(
        stepValue,
        `plans[${index}].steps[${stepIndex}]`,
      );
      assertString(step["id"], `plans[${index}].steps[${stepIndex}].id`, 80);
      assertString(
        step["title"],
        `plans[${index}].steps[${stepIndex}].title`,
        500,
      );
      assertString(
        step["description"],
        `plans[${index}].steps[${stepIndex}].description`,
        10_000,
      );
      assertString(
        step["verification"],
        `plans[${index}].steps[${stepIndex}].verification`,
        10_000,
      );
      assertText(
        step["evidence"],
        `plans[${index}].steps[${stepIndex}].evidence`,
        20_000,
      );
      assertEnum(
        step["status"],
        PLAN_STEP_STATUSES,
        `plans[${index}].steps[${stepIndex}].status`,
      );
      assertTextArray(
        step["dependsOn"],
        `plans[${index}].steps[${stepIndex}].dependsOn`,
        10_000,
      );
      assertIsoDate(
        step["createdAt"],
        `plans[${index}].steps[${stepIndex}].createdAt`,
      );
      assertIsoDate(
        step["updatedAt"],
        `plans[${index}].steps[${stepIndex}].updatedAt`,
      );
      if (step["runId"] !== undefined && !runIds.has(String(step["runId"]))) {
        throw new Error(
          "Thread replay bundle plan step references unknown run",
        );
      }
    }
    const artifacts = assertBoundedArray(
      plan["artifacts"],
      `plans[${index}].artifacts`,
      10_000,
    );
    for (const artifactValue of artifacts) {
      const artifact = assertRecord(artifactValue, "plan artifact");
      assertString(artifact["id"], "plan artifact id", 80);
      assertString(artifact["path"], "plan artifact path", 10_000);
      assertEnum(
        artifact["kind"],
        new Set(["file", "directory", "url", "other"]),
        "plan artifact kind",
      );
      assertString(
        artifact["description"],
        "plan artifact description",
        10_000,
      );
      assertText(artifact["evidence"], "plan artifact evidence", 20_000);
      assertEnum(artifact["status"], ARTIFACT_STATUSES, "plan artifact status");
      if (artifact["sha256"] !== undefined) {
        assertSha256(artifact["sha256"], "plan artifact sha256");
      }
      if (artifact["sizeBytes"] !== undefined) {
        assertNonNegativeInteger(
          artifact["sizeBytes"],
          "plan artifact sizeBytes",
        );
      }
      assertIsoDate(artifact["createdAt"], "plan artifact createdAt");
      assertIsoDate(artifact["updatedAt"], "plan artifact updatedAt");
      if (
        artifact["sourceRunId"] !== undefined &&
        !runIds.has(String(artifact["sourceRunId"]))
      ) {
        throw new Error("Thread replay bundle artifact references unknown run");
      }
    }
  }
  for (const [index, run] of runRecords.entries()) {
    if (
      run["workflowPlanId"] !== undefined &&
      !planIds.has(String(run["workflowPlanId"]))
    ) {
      throw new Error(
        `Thread replay bundle Workflow Run references an unknown Plan: runs[${index}]`,
      );
    }
  }

  const evaluationIds = new Set<string>();
  const evaluationRecords = new Map<string, RunEvaluationRecord>();
  for (const [index, value] of evaluations.entries()) {
    const evaluation = assertRecord(value, `evaluations[${index}]`);
    const evaluationId = assertResourceId(
      evaluation["id"],
      `evaluations[${index}].id`,
    );
    assertUnique(evaluationIds, evaluationId, "evaluation");
    if (
      evaluation["threadId"] !== threadId ||
      !runIds.has(String(evaluation["leftRunId"])) ||
      !runIds.has(String(evaluation["rightRunId"]))
    ) {
      throw new Error(
        `Thread replay bundle evaluation references invalid runs: ${evaluationId}`,
      );
    }
    assertSha256(
      evaluation["leftSnapshotSha256"],
      `evaluations[${index}].leftSnapshotSha256`,
    );
    assertSha256(
      evaluation["rightSnapshotSha256"],
      `evaluations[${index}].rightSnapshotSha256`,
    );
    assertIsoDate(evaluation["createdAt"], `evaluations[${index}].createdAt`);
    assertModel(
      evaluation["evaluatorModel"],
      `evaluations[${index}].evaluatorModel`,
    );
    assertEvaluationBody(evaluation, `evaluations[${index}]`);
    assertRunEvaluationGovernanceReceiptSourceBinding({
      evaluation: value as RunEvaluationRecord,
      events: typedEvents,
      subagents,
      label: `Thread replay bundle evaluations[${index}]`,
    });
    evaluationRecords.set(evaluationId, value as RunEvaluationRecord);
  }

  const evaluationAdjudicationIds = new Set<string>();
  const adjudicatedEvaluationIds = new Set<string>();
  const evaluationAdjudicationRecords = new Map<
    string,
    EvaluationAdjudication
  >();
  for (const [index, value] of evaluationAdjudications.entries()) {
    const adjudication = assertRecord(
      value,
      `evaluationAdjudications[${index}]`,
    );
    const adjudicationId = assertResourceId(
      adjudication["id"],
      `evaluationAdjudications[${index}].id`,
    );
    assertUnique(
      evaluationAdjudicationIds,
      adjudicationId,
      "evaluation adjudication",
    );
    const evaluationId = String(adjudication["evaluationId"]);
    const evaluation = evaluationRecords.get(evaluationId);
    if (
      adjudication["threadId"] !== threadId ||
      !evaluation ||
      adjudicatedEvaluationIds.has(evaluationId)
    ) {
      throw new Error(
        `Thread replay bundle evaluation adjudication is invalid: ${adjudicationId}`,
      );
    }
    validateEvaluationAdjudication(value as EvaluationAdjudication, evaluation);
    adjudicatedEvaluationIds.add(evaluationId);
    evaluationAdjudicationRecords.set(
      adjudicationId,
      value as EvaluationAdjudication,
    );
  }

  const evaluationReviewerBallotIds = new Set<string>();
  const evaluationReviewerLaneKeys = new Set<string>();
  const evaluationReviewerBallotRecords: EvaluationReviewerBallot[] = [];
  for (const [index, value] of evaluationReviewerBallots.entries()) {
    const ballot = assertRecord(value, `evaluationReviewerBallots[${index}]`);
    const ballotId = assertResourceId(
      ballot["id"],
      `evaluationReviewerBallots[${index}].id`,
    );
    assertUnique(
      evaluationReviewerBallotIds,
      ballotId,
      "evaluation reviewer ballot",
    );
    const evaluationId = String(ballot["evaluationId"]);
    const reviewerId = String(ballot["reviewerId"]);
    const laneKey = `${evaluationId}:${reviewerId}`;
    const evaluation = evaluationRecords.get(evaluationId);
    if (
      ballot["threadId"] !== threadId ||
      !evaluation ||
      evaluationReviewerLaneKeys.has(laneKey)
    ) {
      throw new Error(
        `Thread replay bundle evaluation reviewer ballot is invalid: ${ballotId}`,
      );
    }
    validateEvaluationReviewerBallot(
      value as EvaluationReviewerBallot,
      evaluation,
    );
    evaluationReviewerLaneKeys.add(laneKey);
    evaluationReviewerBallotRecords.push(value as EvaluationReviewerBallot);
  }

  const evaluationConsensusResolutionIds = new Set<string>();
  const evaluationConsensusReportKeys = new Set<string>();
  for (const [index, value] of evaluationConsensusResolutions.entries()) {
    const resolution = assertRecord(
      value,
      `evaluationConsensusResolutions[${index}]`,
    );
    const resolutionId = assertResourceId(
      resolution["id"],
      `evaluationConsensusResolutions[${index}].id`,
    );
    assertUnique(
      evaluationConsensusResolutionIds,
      resolutionId,
      "evaluation consensus resolution",
    );
    const evaluationId = String(resolution["evaluationId"]);
    const adjudicationId = String(resolution["adjudicationId"]);
    const evaluation = evaluationRecords.get(evaluationId);
    const adjudication = evaluationAdjudicationRecords.get(adjudicationId);
    const report = assertRecord(
      resolution["report"],
      `evaluationConsensusResolutions[${index}].report`,
    );
    const reportKey = `${evaluationId}:${String(report["contentSha256"])}`;
    if (
      resolution["threadId"] !== threadId ||
      !evaluation ||
      !adjudication ||
      evaluationConsensusReportKeys.has(reportKey)
    ) {
      throw new Error(
        `Thread replay bundle evaluation consensus resolution is invalid: ${resolutionId}`,
      );
    }
    validateEvaluationConsensusResolution(
      value as EvaluationConsensusResolution,
      evaluation,
      evaluationReviewerBallotRecords.filter(
        (ballot) => ballot.evaluationId === evaluationId,
      ),
      adjudication,
    );
    evaluationConsensusReportKeys.add(reportKey);
  }
  for (const adjudication of evaluationAdjudicationRecords.values()) {
    for (const revision of adjudication.revisions) {
      if (
        revision.source === "reviewer_consensus" &&
        !(
          evaluationConsensusResolutions as EvaluationConsensusResolution[]
        ).some(
          (resolution) =>
            resolution.adjudicationId === adjudication.id &&
            resolution.adjudicationRevision.revision === revision.revision &&
            resolution.report.contentSha256 === revision.sourceSha256,
        )
      ) {
        throw new Error(
          `Thread replay bundle consensus adjudication provenance is missing: ${adjudication.id}@${revision.revision}`,
        );
      }
    }
  }

  const evaluationSuiteIds = new Set<string>();
  const evaluationSuiteRecords = new Map<string, EvaluationSuite>();
  for (const [index, value] of evaluationSuites.entries()) {
    const suite = assertRecord(value, `evaluationSuites[${index}]`);
    const suiteId = assertResourceId(
      suite["id"],
      `evaluationSuites[${index}].id`,
    );
    assertUnique(evaluationSuiteIds, suiteId, "evaluation suite");
    if (
      suite["threadId"] !== threadId ||
      !runIds.has(String(suite["baselineRunId"]))
    ) {
      throw new Error(
        `Thread replay bundle evaluation suite ownership is invalid: ${suiteId}`,
      );
    }
    const candidateRunIds = assertStringArray(
      suite["candidateRunIds"],
      `evaluationSuites[${index}].candidateRunIds`,
    );
    if (
      candidateRunIds.length < 1 ||
      candidateRunIds.length > 8 ||
      new Set(candidateRunIds).size !== candidateRunIds.length ||
      candidateRunIds.includes(String(suite["baselineRunId"])) ||
      candidateRunIds.some((runId) => !runIds.has(runId))
    ) {
      throw new Error(
        `Thread replay bundle evaluation suite runs are invalid: ${suiteId}`,
      );
    }
    assertString(suite["name"], `evaluationSuites[${index}].name`, 100);
    assertEvaluationRubric(
      suite["rubric"],
      `evaluationSuites[${index}].rubric`,
    );
    assertModel(
      suite["evaluatorModel"],
      `evaluationSuites[${index}].evaluatorModel`,
    );
    assertEvaluationSuiteGate(suite["gate"], `evaluationSuites[${index}].gate`);
    assertPositiveInteger(
      suite["revision"],
      `evaluationSuites[${index}].revision`,
    );
    assertIsoDate(suite["createdAt"], `evaluationSuites[${index}].createdAt`);
    assertIsoDate(suite["updatedAt"], `evaluationSuites[${index}].updatedAt`);
    evaluationSuiteRecords.set(suiteId, value as EvaluationSuite);
  }

  const evaluationSuiteExecutionIds = new Set<string>();
  for (const [index, value] of evaluationSuiteExecutions.entries()) {
    const execution = assertRecord(
      value,
      `evaluationSuiteExecutions[${index}]`,
    );
    const executionId = assertResourceId(
      execution["id"],
      `evaluationSuiteExecutions[${index}].id`,
    );
    assertUnique(
      evaluationSuiteExecutionIds,
      executionId,
      "evaluation suite execution",
    );
    const suiteId = String(execution["suiteId"]);
    const suite = evaluationSuiteRecords.get(suiteId);
    if (!suite || execution["threadId"] !== threadId) {
      throw new Error(
        `Thread replay bundle evaluation suite execution is invalid: ${executionId}`,
      );
    }
    assertEvaluationSuiteExecution(
      value as EvaluationSuiteExecution,
      suite,
      runIds,
      evaluationRecords,
      `evaluationSuiteExecutions[${index}]`,
    );
  }

  const runRecordById = new Map(
    runRecords.map((run) => [String(run["id"]), run]),
  );
  const automaticRecoveryAssessmentRunIds = new Set<string>();
  const validatedAutomaticRecoveryAssessments =
    automaticRecoveryAssessments.map((value, index) => {
      const assessment = validateAutomaticRecoveryAssessment(value);
      const run = runRecordById.get(assessment.runId);
      const runEvents = typedEvents.filter(
        (event) => event.runId === assessment.runId,
      );
      if (
        assessment.threadId !== threadId ||
        assessment.agentId !== agentId ||
        !run ||
        !runIds.has(assessment.rootRunId) ||
        assessment.runConfigurationSha256 !==
          (run["configuration"] as { contentSha256?: unknown } | undefined)
            ?.contentSha256 ||
        assessment.eventRange.eventCount !== runEvents.length ||
        assessment.eventRange.fromSeq !== (runEvents[0]?.seq ?? 0) ||
        assessment.eventRange.toSeq !== (runEvents.at(-1)?.seq ?? 0) ||
        assessment.eventRange.eventStreamSha256 !==
          hashAutomaticRecoveryEventStream(runEvents) ||
        automaticRecoveryAssessmentRunIds.has(assessment.runId)
      ) {
        throw new Error(
          `Thread replay bundle automatic recovery assessment is invalid: automaticRecoveryAssessments[${index}]`,
        );
      }
      automaticRecoveryAssessmentRunIds.add(assessment.runId);
      return assessment;
    });
  const automaticRecoveryAttemptIds = new Set<string>();
  const automaticRecoveryAttemptTriggers = new Set<string>();
  for (const [index, value] of automaticRecoveryAttempts.entries()) {
    const attempt = validateAutomaticRecoveryAttempt(value);
    const assessment = validatedAutomaticRecoveryAssessments.find(
      (candidate) => candidate.contentSha256 === attempt.assessmentSha256,
    );
    const recoveryRun = attempt.recoveryRunId
      ? runRecordById.get(attempt.recoveryRunId)
      : undefined;
    if (
      attempt.threadId !== threadId ||
      attempt.agentId !== agentId ||
      !runIds.has(attempt.rootRunId) ||
      !runIds.has(attempt.interruptedRunId) ||
      !assessment ||
      assessment.runId !== attempt.interruptedRunId ||
      assessment.rootRunId !== attempt.rootRunId ||
      assessment.priorAttempts + 1 !== attempt.attempt ||
      assessment.policy.maxAttempts !== attempt.maxAttempts ||
      automaticRecoveryAttemptIds.has(attempt.id) ||
      automaticRecoveryAttemptTriggers.has(attempt.triggerId) ||
      (attempt.recoveryRunId &&
        (!recoveryRun ||
          recoveryRun["parentRunId"] !== attempt.interruptedRunId ||
          recoveryRun["triggerId"] !== attempt.triggerId))
    ) {
      throw new Error(
        `Thread replay bundle automatic recovery attempt is invalid: automaticRecoveryAttempts[${index}]`,
      );
    }
    automaticRecoveryAttemptIds.add(attempt.id);
    automaticRecoveryAttemptTriggers.add(attempt.triggerId);
  }

  const taskIds = new Set<string>();
  const taskRecords = new Map<string, SubagentTask>();
  for (const [index, value] of subagents.entries()) {
    const task = assertRecord(value, `subagents[${index}]`);
    const taskId = assertResourceId(task["id"], `subagents[${index}].id`);
    assertUnique(taskIds, taskId, "subagent task");
    if (task["threadId"] !== threadId || !runIds.has(String(task["runId"]))) {
      throw new Error(
        `Thread replay bundle subagent references invalid run: ${taskId}`,
      );
    }
    assertEnum(task["role"], SUBAGENT_ROLES, `subagents[${index}].role`);
    assertEnum(task["status"], SUBAGENT_STATUSES, `subagents[${index}].status`);
    if (task["stopReason"] !== undefined) {
      assertEnum(
        task["stopReason"],
        SUBAGENT_STOP_REASONS,
        `subagents[${index}].stopReason`,
      );
    }
    assertModel(task["model"], `subagents[${index}].model`);
    assertString(
      task["description"],
      `subagents[${index}].description`,
      10_000,
    );
    assertString(task["prompt"], `subagents[${index}].prompt`, 200_000);
    if (task["result"] !== undefined) {
      assertText(task["result"], `subagents[${index}].result`, 200_000);
    }
    if (task["outcome"] !== undefined) {
      if (task["status"] !== "completed") {
        throw new Error(
          `Thread replay bundle subagents[${index}].outcome requires completed status`,
        );
      }
      assertSubagentOutcomeBinding(task["outcome"], {
        id: taskId,
        role: task["role"] as SubagentTask["role"],
        model: task["model"] as SubagentTask["model"],
        prompt: task["prompt"] as string,
      });
    }
    if (task["error"] !== undefined) {
      assertText(task["error"], `subagents[${index}].error`, 200_000);
    }
    assertNonNegativeInteger(
      task["stepCount"],
      `subagents[${index}].stepCount`,
    );
    assertNonNegativeInteger(
      task["turnCount"],
      `subagents[${index}].turnCount`,
    );
    assertUsage(task["usage"], `subagents[${index}].usage`);
    assertPositiveInteger(task["revision"], `subagents[${index}].revision`);
    assertIsoDate(task["createdAt"], `subagents[${index}].createdAt`);
    for (const key of ["startedAt", "finishedAt"]) {
      if (task[key] !== undefined) {
        assertIsoDate(task[key], `subagents[${index}].${key}`);
      }
    }
    taskRecords.set(taskId, value as SubagentTask);
  }

  const outcomeRepairRequests = new Map<
    string,
    ReturnType<typeof validateSubagentOutcomeRepairRequest>
  >();
  const outcomeRepairTaskIds = new Set<string>();
  const outcomeRepairCandidateSteps = new Map<
    string,
    {
      runId: string;
      textSha256: string;
      textBytes: number;
      toolCallCount?: number;
    }
  >();
  for (const event of typedEvents) {
    if (
      event.type === "subagent.step" &&
      event.payload &&
      !Array.isArray(event.payload) &&
      typeof event.payload === "object"
    ) {
      const taskId = event.payload["taskId"];
      const kind = event.payload["kind"];
      const textSha256 = event.payload["textSha256"];
      const textBytes = event.payload["textBytes"];
      if (
        typeof taskId === "string" &&
        (kind === "assistant" || kind === "outcome_repair") &&
        event.payload["contentRedacted"] === true &&
        typeof textSha256 === "string" &&
        Number.isSafeInteger(textBytes) &&
        Number(textBytes) >= 0
      ) {
        outcomeRepairCandidateSteps.set(`${taskId}:${kind}`, {
          runId: event.runId,
          textSha256,
          textBytes: Number(textBytes),
          ...(Number.isSafeInteger(event.payload["toolCallCount"])
            ? { toolCallCount: Number(event.payload["toolCallCount"]) }
            : {}),
        });
      }
    }
    if (event.type === "subagent.outcome.repair.requested") {
      const request = validateSubagentOutcomeRepairRequest(event.payload);
      const task = taskRecords.get(request.taskId);
      const predecessor = outcomeRepairCandidateSteps.get(
        `${request.taskId}:assistant`,
      );
      if (
        !task ||
        !predecessor ||
        event.category !== "subagent" ||
        event.runId !== task.runId ||
        predecessor.runId !== task.runId ||
        request.role !== task.role ||
        canonicalJson(request.model) !== canonicalJson(task.model) ||
        request.taskPromptSha256 !== sha256(task.prompt) ||
        request.outcomeInstructionsSha256 !==
          sha256(subagentRoleInstructions(task.role)) ||
        request.repairInstructionsSha256 !==
          sha256(subagentOutcomeRepairInstructions()) ||
        request.predecessorResultSha256 !== predecessor.textSha256 ||
        request.predecessorResultBytes !== predecessor.textBytes ||
        outcomeRepairRequests.has(request.contentSha256) ||
        [...outcomeRepairRequests.values()].some(
          (candidate) => candidate.taskId === task.id,
        )
      ) {
        throw new Error(
          `Thread replay bundle Subagent outcome repair request is invalid: ${request.taskId}`,
        );
      }
      outcomeRepairRequests.set(request.contentSha256, request);
    }
    if (event.type === "subagent.outcome.repair.outcome") {
      const outcome = validateSubagentOutcomeRepairOutcome(event.payload);
      const request = outcomeRepairRequests.get(outcome.requestContentSha256);
      const task = taskRecords.get(outcome.taskId);
      const result = outcomeRepairCandidateSteps.get(
        `${outcome.taskId}:outcome_repair`,
      );
      if (
        !request ||
        !task ||
        event.category !== "subagent" ||
        event.runId !== task.runId ||
        (outcome.resultSha256 !== undefined && result?.runId !== task.runId) ||
        request.taskId !== task.id ||
        request.attempt !== outcome.attempt ||
        request.maxAttempts !== outcome.maxAttempts ||
        outcomeRepairTaskIds.has(task.id) ||
        (outcome.resultSha256 !== undefined &&
          outcome.resultSha256 !== result?.textSha256) ||
        (outcome.status !== "error" && result?.toolCallCount !== 0) ||
        (outcome.status === "accepted" &&
          outcome.outcomeSha256 !== task.outcome?.contentSha256)
      ) {
        throw new Error(
          `Thread replay bundle Subagent outcome repair outcome is invalid: ${outcome.taskId}`,
        );
      }
      outcomeRepairTaskIds.add(task.id);
    }
  }

  for (const [index, evaluation] of evaluations.entries()) {
    assertRunEvaluationSnapshotSourceBinding({
      evaluation: evaluation as RunEvaluationRecord,
      events: typedEvents,
      label: `Thread replay bundle evaluations[${index}]`,
      skip: isImportedHistoricalEvaluation(
        evaluation as RunEvaluationRecord,
        thread["importProvenance"] as ThreadImportProvenance | undefined,
      ),
    });
  }
  assertRunEvaluationCompletedEventBindings({
    evaluations: [...evaluationRecords.values()],
    events: typedEvents,
    label: "Thread replay bundle",
  });
  assertPlanArtifactEventBindings({
    plans: plans as ExecutionPlan[],
    events: typedEvents,
    label: "Thread replay bundle",
  });

  assertGloballyUniqueResourceIds([
    threadId,
    agentId,
    ...runIds,
    ...planIds,
    ...evaluationIds,
    ...evaluationAdjudicationIds,
    ...evaluationReviewerBallotIds,
    ...evaluationConsensusResolutionIds,
    ...evaluationSuiteIds,
    ...evaluationSuiteExecutionIds,
    ...automaticRecoveryAttemptIds,
    ...taskIds,
    ...eventIds,
    ...[...eventRunIds].filter((runId) => !runIds.has(runId)),
  ]);

  const bundle = input as ThreadReplayBundle;
  const eventStreamSha256 = hashThreadEventStream(typedEvents);
  if (bundle.eventStreamSha256 !== eventStreamSha256) {
    throw new Error("Thread replay bundle event stream hash mismatch");
  }
  const contentSha256 = sha256(canonicalJson(bundleContent(bundle)));
  if (bundle.contentSha256 !== contentSha256) {
    throw new Error("Thread replay bundle content hash mismatch");
  }
  return structuredClone(bundle);
}

export function verifyThreadReplayBundle(
  input: unknown,
): ThreadReplayBundleVerification {
  try {
    const bundle = validateThreadReplayBundle(input);
    return {
      status: "valid",
      diagnostics: [],
      threadId: bundle.thread.id,
      agentId: bundle.agent.id,
      contentSha256: bundle.contentSha256,
      eventStreamSha256: bundle.eventStreamSha256,
      eventCount: bundle.events.length,
      runCount: bundle.runs.length,
      planCount: bundle.plans.length,
      evaluationCount: bundle.evaluations.length,
      modelContextEnvelopeCount: bundle.events.filter(
        (event) => event.type === MODEL_CONTEXT_ENVELOPE_EVENT,
      ).length,
      embeddedModelContextEnvelopeCount:
        countEmbeddedModelContextEnvelopes(bundle),
    };
  } catch (error) {
    return {
      status: "invalid",
      diagnostics: [threadReplayBundleDiagnostic(error)],
      eventCount: 0,
      runCount: 0,
      planCount: 0,
      evaluationCount: 0,
      modelContextEnvelopeCount: 0,
      embeddedModelContextEnvelopeCount: 0,
    };
  }
}

export function hashThreadEventStream(events: RunEvent[]): string {
  return sha256(events.map((event) => JSON.stringify(event)).join("\n"));
}

function threadReplayBundleDiagnostic(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("exceeds")) return "too_large";
  if (message.includes("missing field")) return "missing_field";
  if (message.includes("unsupported field")) return "unsupported_field";
  if (message.includes("kind is invalid")) return "invalid_kind";
  if (message.includes("schemaVersion is unsupported")) {
    return "unsupported_schema_version";
  }
  if (message.includes("API version is unsupported")) {
    return "unsupported_api_version";
  }
  if (message.includes("Model Context Envelope")) return "context_mismatch";
  if (message.includes("hash mismatch")) return "hash_mismatch";
  if (message.includes("Duplicate")) return "duplicate_resource_id";
  if (message.includes("invalid")) return "invalid_shape";
  return "invalid_bundle";
}

function assertEmbeddedModelContextEnvelopeReceipts(
  value: unknown,
  path: string,
): void {
  walkEmbeddedModelContextEnvelopes(value, path, (envelope, envelopePath) => {
    try {
      validateModelContextEnvelopeReceipt(envelope);
    } catch (error) {
      throw new Error(
        `Thread replay bundle embedded Model Context Envelope is invalid at ${envelopePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  });
}

function countEmbeddedModelContextEnvelopes(value: unknown): number {
  let count = 0;
  walkEmbeddedModelContextEnvelopes(value, "bundle", () => {
    count += 1;
  });
  return count;
}

function walkEmbeddedModelContextEnvelopes(
  value: unknown,
  path: string,
  visit: (envelope: unknown, path: string) => void,
): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      walkEmbeddedModelContextEnvelopes(item, `${path}[${index}]`, visit),
    );
    return;
  }
  const record = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, "modelContextEnvelope")) {
    visit(record["modelContextEnvelope"], `${path}.modelContextEnvelope`);
  }
  for (const [key, child] of Object.entries(record)) {
    if (key === "modelContextEnvelope") continue;
    walkEmbeddedModelContextEnvelopes(child, `${path}.${key}`, visit);
  }
}

function bundleContent(bundle: ThreadReplayBundle) {
  return {
    kind: bundle.kind,
    schemaVersion: bundle.schemaVersion,
    apiVersion: bundle.apiVersion,
    thread: bundle.thread,
    agent: bundle.agent,
    ...(bundle.agentRevisions !== undefined
      ? { agentRevisions: bundle.agentRevisions }
      : {}),
    runs: bundle.runs,
    plans: bundle.plans,
    evaluations: bundle.evaluations,
    ...(bundle.evaluationAdjudications !== undefined
      ? { evaluationAdjudications: bundle.evaluationAdjudications }
      : {}),
    ...(bundle.evaluationReviewerBallots !== undefined
      ? { evaluationReviewerBallots: bundle.evaluationReviewerBallots }
      : {}),
    ...(bundle.evaluationConsensusResolutions !== undefined
      ? {
          evaluationConsensusResolutions: bundle.evaluationConsensusResolutions,
        }
      : {}),
    ...(bundle.evaluationSuites !== undefined
      ? { evaluationSuites: bundle.evaluationSuites }
      : {}),
    ...(bundle.evaluationSuiteExecutions !== undefined
      ? { evaluationSuiteExecutions: bundle.evaluationSuiteExecutions }
      : {}),
    ...(bundle.automaticRecoveryAssessments !== undefined
      ? {
          automaticRecoveryAssessments: bundle.automaticRecoveryAssessments,
        }
      : {}),
    ...(bundle.automaticRecoveryAttempts !== undefined
      ? { automaticRecoveryAttempts: bundle.automaticRecoveryAttempts }
      : {}),
    subagents: bundle.subagents,
    events: bundle.events,
    eventStreamSha256: bundle.eventStreamSha256,
  };
}

function stringifyBundle(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("not serializable");
    return serialized;
  } catch {
    throw new Error("Thread replay bundle must be serializable JSON");
  }
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Thread replay bundle ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertBoundedArray(
  value: unknown,
  label: string,
  maximum: number,
): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(
      `Thread replay bundle ${label} must contain at most ${maximum} entries`,
    );
  }
  return value;
}

function assertString(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`Thread replay bundle ${label} is invalid`);
  }
  return value;
}

function assertText(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`Thread replay bundle ${label} is invalid`);
  }
  return value;
}

function assertThreadImportProvenance(
  value: unknown,
  threadEventCount: number,
): ThreadImportProvenance {
  const provenance = assertRecord(value, "thread.importProvenance");
  const allowed = new Set([
    "sourceThreadId",
    "sourceApiVersion",
    "sourceContentSha256",
    "sourceEventStreamSha256",
    "sourceEventCount",
    "localImportedThroughSeq",
    "sourceModelContextEnvelopeCount",
    "sourceEmbeddedModelContextEnvelopeCount",
    "importedAt",
  ]);
  if (Object.keys(provenance).some((key) => !allowed.has(key))) {
    throw new Error("Thread replay bundle thread.importProvenance is invalid");
  }
  const sourceThreadId = assertResourceId(
    provenance["sourceThreadId"],
    "thread.importProvenance.sourceThreadId",
  );
  const sourceApiVersion = assertString(
    provenance["sourceApiVersion"],
    "thread.importProvenance.sourceApiVersion",
    64,
  );
  assertSha256(
    provenance["sourceContentSha256"],
    "thread.importProvenance.sourceContentSha256",
  );
  assertSha256(
    provenance["sourceEventStreamSha256"],
    "thread.importProvenance.sourceEventStreamSha256",
  );
  const sourceEventCount = assertNonNegativeInteger(
    provenance["sourceEventCount"],
    "thread.importProvenance.sourceEventCount",
  );
  const localImportedThroughSeq =
    provenance["localImportedThroughSeq"] === undefined
      ? undefined
      : assertNonNegativeInteger(
          provenance["localImportedThroughSeq"],
          "thread.importProvenance.localImportedThroughSeq",
        );
  if (
    localImportedThroughSeq !== undefined &&
    localImportedThroughSeq > threadEventCount
  ) {
    throw new Error(
      "Thread replay bundle thread.importProvenance.localImportedThroughSeq is invalid",
    );
  }
  const sourceModelContextEnvelopeCount =
    provenance["sourceModelContextEnvelopeCount"] === undefined
      ? undefined
      : assertNonNegativeInteger(
          provenance["sourceModelContextEnvelopeCount"],
          "thread.importProvenance.sourceModelContextEnvelopeCount",
        );
  const sourceEmbeddedModelContextEnvelopeCount =
    provenance["sourceEmbeddedModelContextEnvelopeCount"] === undefined
      ? undefined
      : assertNonNegativeInteger(
          provenance["sourceEmbeddedModelContextEnvelopeCount"],
          "thread.importProvenance.sourceEmbeddedModelContextEnvelopeCount",
        );
  assertIsoDate(provenance["importedAt"], "thread.importProvenance.importedAt");
  return {
    sourceThreadId,
    sourceApiVersion,
    sourceContentSha256: provenance["sourceContentSha256"] as string,
    sourceEventStreamSha256: provenance["sourceEventStreamSha256"] as string,
    sourceEventCount,
    ...(localImportedThroughSeq !== undefined
      ? { localImportedThroughSeq }
      : {}),
    ...(sourceModelContextEnvelopeCount !== undefined
      ? { sourceModelContextEnvelopeCount }
      : {}),
    ...(sourceEmbeddedModelContextEnvelopeCount !== undefined
      ? { sourceEmbeddedModelContextEnvelopeCount }
      : {}),
    importedAt: provenance["importedAt"] as string,
  };
}

function assertThreadImportProvenanceReceipt(
  provenance: ThreadImportProvenance | undefined,
  events: RunEvent[],
): void {
  const receipts = events.filter(
    (event) => event.type === THREAD_IMPORTED_EVENT,
  );
  if (receipts.length === 0) return;
  if (!provenance || receipts.length !== 1) {
    throw new Error(
      "Thread replay bundle import provenance receipt is invalid",
    );
  }
  const receipt = receipts[0]!;
  if (
    receipt.seq !== threadImportProvenanceLocalCutoff(provenance) ||
    receipt.category !== "lifecycle" ||
    receipt.visibility !== "debug" ||
    receipt.createdAt !== provenance.importedAt ||
    canonicalJson(receipt.payload) !==
      canonicalJson(threadImportProvenanceEventPayload(provenance))
  ) {
    throw new Error(
      "Thread replay bundle import provenance receipt is invalid",
    );
  }
}

function threadImportProvenanceEventPayload(
  provenance: ThreadImportProvenance,
): Record<string, string | number> {
  return {
    kind: "napier.thread-import-provenance",
    sourceThreadId: provenance.sourceThreadId,
    sourceApiVersion: provenance.sourceApiVersion,
    sourceContentSha256: provenance.sourceContentSha256,
    sourceEventStreamSha256: provenance.sourceEventStreamSha256,
    sourceEventCount: provenance.sourceEventCount,
    localImportedThroughSeq: threadImportProvenanceLocalCutoff(provenance),
    sourceModelContextEnvelopeCount:
      provenance.sourceModelContextEnvelopeCount ?? 0,
    sourceEmbeddedModelContextEnvelopeCount:
      provenance.sourceEmbeddedModelContextEnvelopeCount ?? 0,
    importedAt: provenance.importedAt,
  };
}

function threadImportProvenanceLocalCutoff(
  provenance: ThreadImportProvenance,
): number {
  return provenance.localImportedThroughSeq ?? provenance.sourceEventCount;
}

function assertTextArray(
  value: unknown,
  label: string,
  maximum: number,
): string[] {
  const entries = assertBoundedArray(value, label, maximum);
  return entries.map((entry, index) =>
    assertString(entry, `${label}[${index}]`, 500),
  );
}

function assertEnum(
  value: unknown,
  values: ReadonlySet<string>,
  label: string,
): string {
  if (typeof value !== "string" || !values.has(value)) {
    throw new Error(`Thread replay bundle ${label} is invalid`);
  }
  return value;
}

function assertNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`Thread replay bundle ${label} is invalid`);
  }
  return Number(value);
}

function assertPositiveInteger(value: unknown, label: string): number {
  const integer = assertNonNegativeInteger(value, label);
  if (integer < 1) {
    throw new Error(`Thread replay bundle ${label} is invalid`);
  }
  return integer;
}

function assertModel(value: unknown, label: string): void {
  const model = assertRecord(value, label);
  assertString(model["provider"], `${label}.provider`, 64);
  assertString(model["id"], `${label}.id`, 200);
}

function assertUsage(value: unknown, label: string): void {
  const usage = assertRecord(value, label);
  for (const key of [
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "costUsd",
  ]) {
    const amount = usage[key];
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
      throw new Error(`Thread replay bundle ${label}.${key} is invalid`);
    }
  }
}

function assertRunLimits(value: unknown, label: string): void {
  const limits = assertRecord(value, label);
  const maxTurns = assertPositiveInteger(
    limits["maxTurns"],
    `${label}.maxTurns`,
  );
  const maxTotalTokens = assertPositiveInteger(
    limits["maxTotalTokens"],
    `${label}.maxTotalTokens`,
  );
  const timeoutMs = assertPositiveInteger(
    limits["timeoutMs"],
    `${label}.timeoutMs`,
  );
  const maxCostUsd = limits["maxCostUsd"];
  if (
    maxTurns > 128 ||
    maxTotalTokens < 1_000 ||
    maxTotalTokens > 10_000_000 ||
    timeoutMs < 10_000 ||
    timeoutMs > 3_600_000 ||
    typeof maxCostUsd !== "number" ||
    !Number.isFinite(maxCostUsd) ||
    maxCostUsd < 0.01 ||
    maxCostUsd > 1_000
  ) {
    throw new Error(`Thread replay bundle ${label} is invalid`);
  }
}

function assertGoal(value: unknown, label: string): Record<string, unknown> {
  const goal = assertRecord(value, label);
  assertString(goal["objective"], `${label}.objective`, 20_000);
  assertEnum(goal["status"], GOAL_STATUSES, `${label}.status`);
  assertEnum(goal["blocker"], GOAL_BLOCKERS, `${label}.blocker`);
  assertText(goal["reason"], `${label}.reason`, 20_000);
  assertText(goal["evidence"], `${label}.evidence`, 20_000);
  for (const key of [
    "continuationCount",
    "maxContinuations",
    "noProgressCount",
    "maxNoProgressContinuations",
  ]) {
    assertNonNegativeInteger(goal[key], `${label}.${key}`);
  }
  if (goal["lastEvidenceHash"] !== undefined) {
    assertSha256(goal["lastEvidenceHash"], `${label}.lastEvidenceHash`);
  }
  assertIsoDate(goal["createdAt"], `${label}.createdAt`);
  assertIsoDate(goal["updatedAt"], `${label}.updatedAt`);
  return goal;
}

function assertEvaluationRubric(value: unknown, label: string): void {
  const rubric = assertRecord(value, label);
  assertString(rubric["name"], `${label}.name`, 80);
  const criteria = assertBoundedArray(
    rubric["criteria"],
    `${label}.criteria`,
    6,
  );
  if (criteria.length < 2) {
    throw new Error(
      `Thread replay bundle ${label}.criteria requires at least two items`,
    );
  }
  normalizeRubric(value as EvaluationRubricSnapshot);
}

function assertEvaluationSuiteGate(value: unknown, label: string): void {
  const gate = assertRecord(value, label);
  const normalized = normalizeEvaluationSuiteGate(
    gate as unknown as EvaluationSuite["gate"],
  );
  if (JSON.stringify(normalized) !== JSON.stringify(value)) {
    throw new Error(`Thread replay bundle ${label} is not canonical`);
  }
}

function assertEvaluationSuiteExecution(
  execution: EvaluationSuiteExecution,
  suite: EvaluationSuite,
  runIds: Set<string>,
  evaluations: Map<string, RunEvaluationRecord>,
  label: string,
): void {
  assertPositiveInteger(execution.suiteRevision, `${label}.suiteRevision`);
  if (execution.suiteRevision > suite.revision) {
    throw new Error(`Thread replay bundle ${label} revision is invalid`);
  }
  assertString(execution.name, `${label}.name`, 100);
  if (
    !runIds.has(execution.baselineRunId) ||
    execution.candidateRunIds.length < 1 ||
    execution.candidateRunIds.length > 8 ||
    new Set(execution.candidateRunIds).size !==
      execution.candidateRunIds.length ||
    execution.candidateRunIds.includes(execution.baselineRunId) ||
    execution.candidateRunIds.some((runId) => !runIds.has(runId)) ||
    execution.results.length !== execution.candidateRunIds.length
  ) {
    throw new Error(`Thread replay bundle ${label} runs are invalid`);
  }
  assertEvaluationRubric(execution.rubric, `${label}.rubric`);
  assertModel(execution.evaluatorModel, `${label}.evaluatorModel`);
  assertEvaluationSuiteGate(execution.gate, `${label}.gate`);
  assertEnum(
    execution.status,
    EVALUATION_SUITE_EXECUTION_STATUSES,
    `${label}.status`,
  );
  assertNonNegativeInteger(execution.passedCount, `${label}.passedCount`);
  assertNonNegativeInteger(execution.failedCount, `${label}.failedCount`);
  assertNonNegativeInteger(
    execution.inconclusiveCount,
    `${label}.inconclusiveCount`,
  );
  for (const [field, value] of [
    ["passRate", execution.passRate],
    ["averageCandidateScore", execution.averageCandidateScore],
  ] as const) {
    if (
      value !== undefined &&
      (typeof value !== "number" || !Number.isFinite(value))
    ) {
      throw new Error(`Thread replay bundle ${label}.${field} is invalid`);
    }
  }
  const evaluationIds = new Set<string>();
  for (const [index, result] of execution.results.entries()) {
    const evaluation = evaluations.get(result.evaluationId);
    if (
      result.candidateRunId !== execution.candidateRunIds[index] ||
      evaluationIds.has(result.evaluationId) ||
      !evaluation ||
      evaluation.leftRunId !== execution.baselineRunId ||
      evaluation.rightRunId !== result.candidateRunId ||
      result.evaluationSha256 !== hashRunEvaluation(evaluation) ||
      result.verdict !== evaluation.verdict ||
      result.baselineSnapshotSha256 !== evaluation.leftSnapshotSha256 ||
      result.candidateSnapshotSha256 !== evaluation.rightSnapshotSha256
    ) {
      throw new Error(
        `Thread replay bundle ${label}.results[${index}] is invalid`,
      );
    }
    evaluationIds.add(result.evaluationId);
    assertSha256(
      result.evaluationSha256,
      `${label}.results[${index}].evaluationSha256`,
    );
    assertSha256(
      result.baselineSnapshotSha256,
      `${label}.results[${index}].baselineSnapshotSha256`,
    );
    assertSha256(
      result.candidateSnapshotSha256,
      `${label}.results[${index}].candidateSnapshotSha256`,
    );
    assertEnum(
      result.status,
      EVALUATION_SUITE_CASE_STATUSES,
      `${label}.results[${index}].status`,
    );
  }
  assertSha256(execution.contentSha256, `${label}.contentSha256`);
  assertIsoDate(execution.startedAt, `${label}.startedAt`);
  assertIsoDate(execution.finishedAt, `${label}.finishedAt`);
  const {
    id: _id,
    contentSha256: _contentSha256,
    startedAt: _startedAt,
    finishedAt: _finishedAt,
    ...hashInput
  } = execution;
  if (execution.contentSha256 !== hashEvaluationSuiteExecution(hashInput)) {
    throw new Error(`Thread replay bundle ${label} content hash mismatch`);
  }
}

function assertEvaluationBody(
  evaluation: Record<string, unknown>,
  label: string,
): void {
  const rubric = assertRecord(evaluation["rubric"], `${label}.rubric`);
  assertString(rubric["name"], `${label}.rubric.name`, 500);
  const criteria = assertBoundedArray(
    rubric["criteria"],
    `${label}.rubric.criteria`,
    100,
  );
  if (criteria.length === 0) {
    throw new Error(`Thread replay bundle ${label}.rubric.criteria is empty`);
  }
  const criterionIds = new Set<string>();
  for (const [index, value] of criteria.entries()) {
    const criterion = assertRecord(value, `${label}.rubric.criteria[${index}]`);
    const id = assertString(
      criterion["id"],
      `${label}.rubric.criteria[${index}].id`,
      100,
    );
    assertUnique(criterionIds, id, "evaluation criterion");
    assertString(
      criterion["name"],
      `${label}.rubric.criteria[${index}].name`,
      500,
    );
    assertString(
      criterion["description"],
      `${label}.rubric.criteria[${index}].description`,
      5_000,
    );
  }
  const scores = assertBoundedArray(
    evaluation["scores"],
    `${label}.scores`,
    100,
  );
  for (const [index, value] of scores.entries()) {
    const score = assertRecord(value, `${label}.scores[${index}]`);
    if (!criterionIds.has(String(score["criterionId"]))) {
      throw new Error(
        `Thread replay bundle ${label}.scores[${index}] references unknown criterion`,
      );
    }
    for (const side of ["leftScore", "rightScore"]) {
      const number = score[side];
      if (
        typeof number !== "number" ||
        !Number.isFinite(number) ||
        number < 1 ||
        number > 5
      ) {
        throw new Error(
          `Thread replay bundle ${label}.scores[${index}].${side} is invalid`,
        );
      }
    }
    assertString(score["reason"], `${label}.scores[${index}].reason`, 10_000);
  }
  assertEnum(evaluation["verdict"], EVALUATION_VERDICTS, `${label}.verdict`);
  assertString(evaluation["reason"], `${label}.reason`, 20_000);
  assertText(evaluation["evidence"], `${label}.evidence`, 20_000);
  if (evaluation["comparisonGovernance"] !== undefined) {
    assertEvaluationGovernanceBinding(
      evaluation["comparisonGovernance"],
      `${label}.comparisonGovernance`,
    );
  }
}

function isImportedHistoricalEvaluation(
  evaluation: RunEvaluationRecord,
  importProvenance: ThreadImportProvenance | undefined,
): boolean {
  return Boolean(
    importProvenance &&
    Date.parse(evaluation.createdAt) <= Date.parse(importProvenance.importedAt),
  );
}

function assertEvaluationGovernanceBinding(
  value: unknown,
  label: string,
): void {
  const governance = assertRecord(value, label);
  if (
    governance["kind"] !== "napier.run-evaluation-governance" ||
    governance["schemaVersion"] !== 1
  ) {
    throw new Error(`Thread replay bundle ${label} is invalid`);
  }
  assertEnum(
    governance["contextCoverageStatus"],
    new Set(["clean", "partial", "missing", "regressed"]),
    `${label}.contextCoverageStatus`,
  );
  const rateDelta = governance["contextCoverageRateDelta"];
  if (typeof rateDelta !== "number" || !Number.isFinite(rateDelta)) {
    throw new Error(
      `Thread replay bundle ${label}.contextCoverageRateDelta is invalid`,
    );
  }
  assertSha256(
    governance["contextCoverageDiagnosticsSha256"],
    `${label}.contextCoverageDiagnosticsSha256`,
  );
  assertSha256(
    governance["contextCoverageDeltaSha256"],
    `${label}.contextCoverageDeltaSha256`,
  );
  const traceSummaryFields = [
    governance["traceSummaryBoundaryStatus"],
    governance["traceSummaryBoundaryGenericDelta"],
    governance["traceSummaryBoundaryDiagnosticsSha256"],
    governance["traceSummaryBoundaryDeltaSha256"],
  ];
  if (traceSummaryFields.some((field) => field !== undefined)) {
    if (!traceSummaryFields.every((field) => field !== undefined)) {
      throw new Error(`Thread replay bundle ${label} is invalid`);
    }
    assertEnum(
      governance["traceSummaryBoundaryStatus"],
      new Set(["clean", "generic_present", "regressed"]),
      `${label}.traceSummaryBoundaryStatus`,
    );
    const genericDelta = governance["traceSummaryBoundaryGenericDelta"];
    if (
      typeof genericDelta !== "number" ||
      !Number.isSafeInteger(genericDelta)
    ) {
      throw new Error(
        `Thread replay bundle ${label}.traceSummaryBoundaryGenericDelta is invalid`,
      );
    }
    assertSha256(
      governance["traceSummaryBoundaryDiagnosticsSha256"],
      `${label}.traceSummaryBoundaryDiagnosticsSha256`,
    );
    assertSha256(
      governance["traceSummaryBoundaryDeltaSha256"],
      `${label}.traceSummaryBoundaryDeltaSha256`,
    );
  }
  const contentSha256 = String(governance["contentSha256"]);
  assertSha256(contentSha256, `${label}.contentSha256`);
  const { contentSha256: _contentSha256, ...content } = governance;
  if (sha256(canonicalJson(content)) !== contentSha256) {
    throw new Error(`Thread replay bundle ${label} content hash mismatch`);
  }
}

function assertJsonValue(value: unknown, label: string, depth = 0): void {
  if (depth > 64) {
    throw new Error(`Thread replay bundle ${label} exceeds JSON depth limit`);
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw new Error(`Thread replay bundle ${label} is not finite JSON`);
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertJsonValue(item, `${label}[${index}]`, depth + 1);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      assertJsonValue(item, `${label}.${key}`, depth + 1);
    }
    return;
  }
  throw new Error(`Thread replay bundle ${label} is not JSON`);
}

function hasExternalBranchParentEvidence(
  run: Record<string, unknown>,
  events: RunEvent[],
  threadId: string,
): boolean {
  const branchFromSeq = run["branchFromSeq"];
  const runId = run["id"];
  if (
    !Number.isSafeInteger(branchFromSeq) ||
    Number(branchFromSeq) < 1 ||
    typeof runId !== "string"
  ) {
    return false;
  }
  const matches = events.filter(
    (event) =>
      event.runId === runId &&
      event.type === "branch.created" &&
      event.category === "lifecycle" &&
      event.visibility === "user",
  );
  const payload =
    matches.length === 1 &&
    matches[0]!.payload &&
    typeof matches[0]!.payload === "object" &&
    !Array.isArray(matches[0]!.payload)
      ? matches[0]!.payload
      : undefined;
  return Boolean(
    payload &&
    Object.keys(payload).length === 2 &&
    typeof payload["sourceThreadId"] === "string" &&
    RESOURCE_ID.test(payload["sourceThreadId"]) &&
    payload["sourceThreadId"] !== threadId &&
    payload["sourceSeq"] === branchFromSeq,
  );
}

function assertStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Thread replay bundle ${label} must be an array`);
  }
  return value.map((item, index) =>
    assertResourceId(item, `${label}[${index}]`),
  );
}

function assertResourceId(value: unknown, label: string): string {
  const id = assertString(value, label, 80);
  if (!RESOURCE_ID.test(id)) {
    throw new Error(`Thread replay bundle ${label} is invalid`);
  }
  return id;
}

function assertIsoDate(value: unknown, label: string): void {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(`Thread replay bundle ${label} is invalid`);
  }
}

function assertSha256(value: unknown, label: string): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`Thread replay bundle ${label} is invalid`);
  }
}

function assertUnique(values: Set<string>, value: string, label: string): void {
  if (values.has(value)) {
    throw new Error(`Thread replay bundle has duplicate ${label} ID: ${value}`);
  }
  values.add(value);
}

function assertGloballyUniqueResourceIds(values: string[]): void {
  const unique = new Set<string>();
  for (const value of values) {
    if (unique.has(value)) {
      throw new Error(
        `Thread replay bundle reuses resource ID across record types: ${value}`,
      );
    }
    unique.add(value);
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
