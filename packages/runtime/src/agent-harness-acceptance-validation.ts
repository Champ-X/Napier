import type {
  AgentHarnessAcceptanceEvidence,
  AgentHarnessAcceptanceEvidenceContent,
  HarnessLedgerEventEvidence,
  HarnessLedgerRunEvidence,
  HarnessSubagentRestartSnapshot,
} from "@napier/contracts/agent-harness-acceptance";

import { canonicalJson, sha256 } from "./ed25519.js";

const HASH = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/u;
const TERMINAL = new Set([
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "orphaned",
]);

export function assertAgentHarnessAcceptanceShape(
  input: unknown,
): asserts input is AgentHarnessAcceptanceEvidence {
  if (!record(input) || !exactKeys(input, EVIDENCE_KEYS)) {
    throw new Error("Agent Harness acceptance evidence is invalid");
  }
}

export function agentHarnessAcceptanceContent(
  value: AgentHarnessAcceptanceEvidence,
): AgentHarnessAcceptanceEvidenceContent {
  const {
    summary: _summary,
    acceptanceReady: _ready,
    blockers: _blockers,
    contentSha256: _hash,
    ...content
  } = value;
  return content;
}

export function assertAgentHarnessAcceptanceContent(
  input: AgentHarnessAcceptanceEvidenceContent,
): void {
  if (
    !record(input) ||
    !exactKeys(input, CONTENT_KEYS) ||
    input.kind !== "napier.agent-harness-acceptance-evidence" ||
    input.schemaVersion !== 1 ||
    !isoDate(input.generatedAt) ||
    !/^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$/u.test(input.productVersion) ||
    !HASH.test(input.sourceManifestSha256) ||
    !HASH.test(input.harnessExperimentEvidenceSha256)
  )
    throw new Error("Agent Harness acceptance evidence is invalid");
  const arrays = [
    input.primaryModels,
    input.ledgerRuns,
    input.routeCases,
    input.capabilityReachabilityCases,
    input.loopPairs,
    input.codeBridgeCalls,
    input.codeBridgePrivilegeProbes,
    input.subagentTasks,
    input.steeringBoundaryChecks,
    input.cancellationBoundaryChecks,
    input.tokenCalibrationObservations,
  ];
  if (arrays.some((items) => !Array.isArray(items)))
    throw new Error("Agent Harness acceptance evidence is invalid");
  assertIdentities(input);
  assertRecords(input);
  input.ledgerRuns.forEach(assertLedgerRun);
  input.subagentTasks.forEach((item) =>
    assertRestartSnapshot(item.restartSnapshot),
  );
  assertRunReferences(input);
}

function assertRecords(input: AgentHarnessAcceptanceEvidenceContent): void {
  if (
    input.primaryModels.some((item) => !exactKeys(item, ["provider", "id"])) ||
    input.routeCases.some(
      (item) =>
        !exactKeys(item, [
          "id",
          "failureClass",
          "scenario",
          "runEvidenceSha256",
        ]) ||
        !["rate_limited", "provider_server", "network"].includes(
          item.failureClass,
        ) ||
        !["recoverable", "visible_output", "unknown_side_effect"].includes(
          item.scenario,
        ),
    ) ||
    input.capabilityReachabilityCases.some(
      (item) =>
        !exactKeys(item, ["id", "targetToolId", "runEvidenceSha256"]) ||
        !ID.test(item.targetToolId),
    ) ||
    input.loopPairs.some(
      (item) =>
        !exactKeys(item, [
          "id",
          "baselineRunEvidenceSha256",
          "candidateRunEvidenceSha256",
        ]),
    ) ||
    input.codeBridgeCalls.some(
      (item) =>
        !exactKeys(item, ["id", "callId", "runEvidenceSha256"]) ||
        !ID.test(item.callId),
    ) ||
    input.codeBridgePrivilegeProbes.some(
      (item) =>
        !exactKeys(item, ["id", "probeClass", "callId", "runEvidenceSha256"]) ||
        !["workspace_escape", "inactive_capability", "unknown_effect"].includes(
          item.probeClass,
        ) ||
        !ID.test(item.callId),
    ) ||
    input.subagentTasks.some(
      (item) =>
        !exactKeys(item, [
          "taskId",
          "terminalEventId",
          "runEvidenceSha256",
          "restartSnapshot",
        ]) || !ID.test(item.terminalEventId),
    ) ||
    input.steeringBoundaryChecks.some(
      (item) =>
        !exactKeys(item, ["taskId", "messageId", "runEvidenceSha256"]) ||
        !ID.test(item.taskId) ||
        !ID.test(item.messageId),
    ) ||
    input.cancellationBoundaryChecks.some(
      (item) =>
        !exactKeys(item, [
          "taskId",
          "requestEventId",
          "terminalEventId",
          "runEvidenceSha256",
        ]) ||
        !ID.test(item.taskId) ||
        !ID.test(item.requestEventId) ||
        !ID.test(item.terminalEventId),
    ) ||
    input.tokenCalibrationObservations.some(
      (item) =>
        !exactKeys(item, [
          "provider",
          "model",
          "contentClass",
          "calibrationEventId",
          "runEvidenceSha256",
        ]) ||
        !ID.test(item.provider) ||
        !ID.test(item.model) ||
        !["text", "structured", "multimodal"].includes(item.contentClass) ||
        !ID.test(item.calibrationEventId),
    ) ||
    !exactKeys(input.conservativeTokenFallbackProbe, [
      "eventId",
      "runEvidenceSha256",
    ]) ||
    !ID.test(input.conservativeTokenFallbackProbe.eventId)
  )
    throw new Error("Agent Harness acceptance record is invalid");
}

function assertIdentities(input: AgentHarnessAcceptanceEvidenceContent): void {
  const ids = [
    input.routeCases.map((item) => item.id),
    input.capabilityReachabilityCases.map((item) => item.id),
    input.loopPairs.map((item) => item.id),
    input.codeBridgeCalls.map((item) => item.id),
    input.codeBridgePrivilegeProbes.map((item) => item.id),
    input.subagentTasks.map((item) => item.taskId),
  ];
  if (
    ids.some(
      (values) => !unique(values) || values.some((value) => !ID.test(value)),
    ) ||
    !unique(input.ledgerRuns.map((item) => item.contentSha256)) ||
    !unique(input.primaryModels.map((item) => `${item.provider}/${item.id}`)) ||
    input.primaryModels.some(
      (item) => !ID.test(item.provider) || !ID.test(item.id),
    )
  )
    throw new Error("Agent Harness acceptance identity is invalid");
}

function assertRunReferences(
  input: AgentHarnessAcceptanceEvidenceContent,
): void {
  const runHashes = new Set(input.ledgerRuns.map((item) => item.contentSha256));
  const references = [
    ...input.routeCases.map((item) => item.runEvidenceSha256),
    ...input.capabilityReachabilityCases.map((item) => item.runEvidenceSha256),
    ...input.loopPairs.flatMap((item) => [
      item.baselineRunEvidenceSha256,
      item.candidateRunEvidenceSha256,
    ]),
    ...input.codeBridgeCalls.map((item) => item.runEvidenceSha256),
    ...input.codeBridgePrivilegeProbes.map((item) => item.runEvidenceSha256),
    ...input.subagentTasks.map((item) => item.runEvidenceSha256),
    ...input.steeringBoundaryChecks.map((item) => item.runEvidenceSha256),
    ...input.cancellationBoundaryChecks.map((item) => item.runEvidenceSha256),
    ...input.tokenCalibrationObservations.map((item) => item.runEvidenceSha256),
    input.conservativeTokenFallbackProbe.runEvidenceSha256,
  ];
  if (references.some((hash) => !HASH.test(hash) || !runHashes.has(hash)))
    throw new Error("Agent Harness acceptance run binding is invalid");
}

function assertLedgerRun(run: HarnessLedgerRunEvidence): void {
  if (
    !exactKeys(run, RUN_KEYS) ||
    !ID.test(run.threadId) ||
    !ID.test(run.runId) ||
    !["running", "completed", "failed", "cancelled"].includes(run.status) ||
    !Array.isArray(run.events) ||
    !HASH.test(run.eventStreamSha256) ||
    !HASH.test(run.contentSha256)
  )
    throw new Error("Agent Harness Ledger run is invalid");
  let previousSeq = 0;
  for (const event of run.events) {
    assertLedgerEvent(event, run);
    if (event.seq <= previousSeq)
      throw new Error("Agent Harness Ledger event order is invalid");
    previousSeq = event.seq;
  }
  const content = {
    threadId: run.threadId,
    runId: run.runId,
    status: run.status,
    events: run.events,
    eventStreamSha256: sha256(
      run.events.map((event) => event.eventSha256).join("\n"),
    ),
  };
  if (
    content.eventStreamSha256 !== run.eventStreamSha256 ||
    sha256(canonicalJson(content)) !== run.contentSha256
  )
    throw new Error("Agent Harness Ledger run hash is invalid");
}

function assertLedgerEvent(
  event: HarnessLedgerEventEvidence,
  run: HarnessLedgerRunEvidence,
): void {
  if (
    !exactKeys(event, EVENT_KEYS) ||
    !ID.test(event.id) ||
    event.threadId !== run.threadId ||
    event.runId !== run.runId ||
    !positiveInteger(event.seq) ||
    !ID.test(event.type) ||
    !isoDate(event.createdAt) ||
    !HASH.test(event.payloadSha256) ||
    !HASH.test(event.eventSha256) ||
    event.payloadSha256 !== sha256(canonicalJson(event.payload))
  )
    throw new Error("Agent Harness Ledger event is invalid");
  const { eventSha256, ...content } = event;
  if (eventSha256 !== sha256(canonicalJson(content)))
    throw new Error("Agent Harness Ledger event hash is invalid");
}

function assertRestartSnapshot(snapshot: HarnessSubagentRestartSnapshot): void {
  if (!exactKeys(snapshot, RESTART_KEYS) || !TERMINAL.has(snapshot.status))
    throw new Error("Subagent restart snapshot is invalid");
  const { contentSha256, ...content } = snapshot;
  if (
    !ID.test(snapshot.taskId) ||
    !positiveInteger(snapshot.revision) ||
    !isoDate(snapshot.finishedAt) ||
    !HASH.test(contentSha256) ||
    contentSha256 !== sha256(canonicalJson(content))
  )
    throw new Error("Subagent restart snapshot is invalid");
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function exactKeys(value: object, keys: readonly string[]): boolean {
  return (
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort())
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const CONTENT_KEYS = [
  "kind",
  "schemaVersion",
  "generatedAt",
  "productVersion",
  "sourceManifestSha256",
  "harnessExperimentEvidenceSha256",
  "primaryModels",
  "ledgerRuns",
  "routeCases",
  "capabilityReachabilityCases",
  "loopPairs",
  "codeBridgeCalls",
  "codeBridgePrivilegeProbes",
  "subagentTasks",
  "steeringBoundaryChecks",
  "cancellationBoundaryChecks",
  "tokenCalibrationObservations",
  "conservativeTokenFallbackProbe",
] as const;
const EVIDENCE_KEYS = [
  ...CONTENT_KEYS,
  "summary",
  "acceptanceReady",
  "blockers",
  "contentSha256",
] as const;
const RUN_KEYS = [
  "threadId",
  "runId",
  "status",
  "events",
  "eventStreamSha256",
  "contentSha256",
] as const;
const EVENT_KEYS = [
  "id",
  "threadId",
  "runId",
  "seq",
  "type",
  "category",
  "visibility",
  "createdAt",
  "payload",
  "payloadSha256",
  "eventSha256",
] as const;
const RESTART_KEYS = [
  "taskId",
  "status",
  "supervisorStatus",
  "stopReason",
  "revision",
  "finishedAt",
  "contentSha256",
] as const;
