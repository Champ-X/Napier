import type { RunEvent } from "@napier/contracts";
import {
  parseResearchSourceEvidenceV1,
  type ResearchSourceEvidenceV1,
} from "@napier/contracts/skill-load";
import {
  isSkillLifecycleProjectionV1,
  skillProofEventSetSha256,
  type SkillApplicationMode,
  type SkillLifecycleProjectionV1,
} from "@napier/contracts/skill-lifecycle";
import type { StandardSkillRootKind } from "@napier/contracts/skill-load-standard";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  isSkillCatalogBinding,
  isSkillLoadFailure,
  isSkillLoadReceipt,
  isSkillLoadSelection,
  type SkillCatalogBinding,
  type SkillLoadFailure,
  type SkillLoadReceipt,
  type SkillLoadSelection,
} from "./skill-load-contracts.js";
import { skillDataAnalysisProof } from "./skill-data-analysis-proof.js";
import type { LocalStore } from "./store.js";

const SOFTWARE_MUTATION_TOOLS = new Set([
  "apply_patch",
  "lsp_rename_apply",
  "lsp_code_action_apply",
  "workspace_file_apply",
  "subagent_worktree_apply",
]);

type Origin = {
  source: "project" | "user";
  rootKind: StandardSkillRootKind;
};

type AttemptTerminal = {
  event: RunEvent;
  receipt?: SkillLoadReceipt;
  failure?: SkillLoadFailure;
  selection?: { event: RunEvent; details: SkillLoadSelection };
};

export function projectActiveSkillLifecycles(
  events: readonly RunEvent[],
  runId: string,
): SkillLifecycleProjectionV1[] {
  const ordered = strictRunEvents(events, runId);
  if (!ordered) return [];
  const contexts = ordered.filter((event) => event.type === "context.skills");
  if (contexts.length !== 1 || !isSkillCatalogBinding(contexts[0]!.payload)) {
    return [];
  }
  const context = contexts[0]!;
  const binding = context.payload as unknown as SkillCatalogBinding;
  const names = activeSkillNames(ordered);
  return names.flatMap((skillName) => {
    const request = binding.configuredSkillRequests.find(
      (item) => item.canonicalName === skillName,
    );
    if (!request) return [];
    const projected = projectSkill(
      ordered,
      binding,
      Number(context.seq),
      skillName,
    );
    return projected ? [projected] : [];
  });
}

export async function recordActiveSkillLifecycles(
  store: LocalStore,
  threadId: string,
  runId: string,
  onEvent?: (event: RunEvent) => Promise<void> | void,
): Promise<SkillLifecycleProjectionV1[]> {
  const events = await store.listEvents(threadId);
  const existing = new Map<string, SkillLifecycleProjectionV1>();
  for (const event of events) {
    if (
      event.runId === runId &&
      event.type === "skill.lifecycle" &&
      isSkillLifecycleProjectionV1(event.payload)
    ) {
      existing.set(
        event.payload.skillName,
        event.payload as unknown as SkillLifecycleProjectionV1,
      );
    }
  }
  const projections = projectActiveSkillLifecycles(events, runId);
  for (const projection of projections) {
    if (
      existing.get(projection.skillName)?.contentSha256 ===
      projection.contentSha256
    ) {
      continue;
    }
    const event = await store.appendEvent({
      threadId,
      runId,
      type: "skill.lifecycle",
      category: "system",
      visibility: "user",
      payload: JSON.parse(JSON.stringify(projection)),
    });
    existing.set(projection.skillName, projection);
    if (onEvent) await Promise.resolve(onEvent(event)).catch(() => undefined);
  }
  return [...existing.values()].sort((left, right) =>
    compare(left.skillName, right.skillName),
  );
}

function projectSkill(
  events: readonly RunEvent[],
  binding: SkillCatalogBinding,
  contextSeq: number,
  skillName: string,
): SkillLifecycleProjectionV1 | undefined {
  const starts = loadStarts(events, skillName);
  const terminals = loadTerminals(events, skillName, starts);
  const request = binding.configuredSkillRequests.find(
    (item) => item.canonicalName === skillName,
  );
  if (request?.state === "unavailable") {
    const failure = binding.unavailableSkills.find(
      (item) => item.contentSha256 === request.failureContentSha256,
    );
    if (!failure) return undefined;
    const failureOrigin = origin(failure);
    return seal({
      ...common(binding, contextSeq, skillName),
      state: "unavailable",
      ...(failureOrigin
        ? originFields(failureOrigin)
        : {
            source: "composite" as const,
            candidateRootKinds: failureRoots(failure),
          }),
      failureContentSha256: failure.contentSha256,
    });
  }
  const latestStart = starts.at(-1);
  const latestTerminal = terminals.at(-1);
  if (
    latestStart &&
    (!latestTerminal || latestStart.event.seq > latestTerminal.event.seq)
  ) {
    const selectedOrigin = origin(latestStart.details);
    if (!selectedOrigin) return undefined;
    return seal({
      ...common(binding, contextSeq, skillName),
      state: "selected",
      ...originFields(selectedOrigin),
      selectedSeq: latestStart.event.seq,
    });
  }
  if (!latestTerminal) return undefined;
  if (latestTerminal.failure) {
    const failureOrigin = latestTerminal.selection
      ? origin(latestTerminal.selection.details)
      : origin(latestTerminal.failure);
    return seal({
      ...common(binding, contextSeq, skillName),
      state: "failed",
      ...(failureOrigin
        ? originFields(failureOrigin)
        : {
            source: "composite" as const,
            candidateRootKinds: failureRoots(latestTerminal.failure),
          }),
      ...(latestTerminal.selection
        ? { selectedSeq: latestTerminal.selection.event.seq }
        : {}),
      terminalSeq: latestTerminal.event.seq,
      failureContentSha256: latestTerminal.failure.contentSha256,
    });
  }
  const receipt = latestTerminal.receipt;
  const selection = latestTerminal.selection;
  if (!receipt || !selection) return undefined;
  const receiptOrigin = origin(receipt);
  if (!receiptOrigin) return undefined;
  const base = {
    ...common(binding, contextSeq, skillName),
    state: "loaded" as const,
    ...originFields(receiptOrigin),
    selectedSeq: selection.event.seq,
    terminalSeq: latestTerminal.event.seq,
    receiptContentSha256: receipt.contentSha256,
  };
  const proof = applicationProof(events, skillName, latestTerminal.event.seq);
  return proof ? seal({ ...base, state: "applied", ...proof }) : seal(base);
}

function activeSkillNames(events: readonly RunEvent[]): string[] {
  const names = new Set<string>();
  for (const event of events) {
    if (
      event.type !== "tool.started" &&
      event.type !== "tool.completed" &&
      event.type !== "tool.failed"
    ) {
      continue;
    }
    const payload = record(event.payload);
    if (payload?.toolName !== "skill_load") continue;
    const details = payload.details;
    if (isSkillLoadSelection(details) || isSkillLoadReceipt(details)) {
      names.add(details.name);
    } else if (isSkillLoadFailure(details) && failureName(details)) {
      names.add(failureName(details)!);
    }
  }
  return [...names].sort(compare);
}

function loadStarts(events: readonly RunEvent[], skillName: string) {
  return events.flatMap((event) => {
    const payload = record(event.payload);
    const details = payload?.details;
    return event.type === "tool.started" &&
      payload?.toolName === "skill_load" &&
      typeof payload.callId === "string" &&
      isSkillLoadSelection(details) &&
      details.name === skillName
      ? [{ event, callId: payload.callId, details }]
      : [];
  });
}

function loadTerminals(
  events: readonly RunEvent[],
  skillName: string,
  starts: ReturnType<typeof loadStarts>,
): AttemptTerminal[] {
  return events.flatMap((event) => {
    const payload = record(event.payload);
    if (
      (event.type !== "tool.completed" && event.type !== "tool.failed") ||
      payload?.toolName !== "skill_load"
    ) {
      return [];
    }
    const details = payload.details;
    const receipt = isSkillLoadReceipt(details) ? details : undefined;
    const failure = isSkillLoadFailure(details) ? details : undefined;
    const name = receipt?.name ?? (failure ? failureName(failure) : undefined);
    if (name !== skillName || (!receipt && !failure)) return [];
    const selection = starts.find((item) => item.callId === payload.callId);
    if (
      receipt &&
      (!selection ||
        selection.event.seq >= event.seq ||
        !sameBinding(receipt, selection.details))
    ) {
      return [];
    }
    return [
      {
        event,
        ...(receipt ? { receipt } : {}),
        ...(failure ? { failure } : {}),
        ...(selection ? { selection } : {}),
      },
    ];
  });
}

function applicationProof(
  events: readonly RunEvent[],
  skillName: string,
  terminalSeq: number,
):
  | {
      applicationMode: SkillApplicationMode;
      proofEventSeqs: number[];
      proofEventSetSha256: string;
    }
  | undefined {
  if (skillName === "research-brief") {
    const evidence = events.flatMap((event) => {
      const parsed = researchEvidence(event);
      return event.seq > terminalSeq && parsed ? [{ event, parsed }] : [];
    });
    const capture = evidence.find(
      (item) =>
        item.parsed.action === "capture" ||
        item.parsed.action === "capture_fetch",
    );
    const cite = evidence.find(
      (item) =>
        item.event.seq > (capture?.event.seq ?? terminalSeq) &&
        item.parsed.action === "cite" &&
        (capture?.parsed.action === "capture" ||
          capture?.parsed.action === "capture_fetch") &&
        item.parsed.sourceId === capture.parsed.sourceId &&
        item.parsed.sourceContentSha256 === capture.parsed.sourceContentSha256,
    );
    if (capture && cite) {
      return proof("research_evidence_cited", [
        capture.event.seq,
        cite.event.seq,
      ]);
    }
  }
  if (skillName === "data-analysis") {
    const data = skillDataAnalysisProof(events, terminalSeq);
    if (data) {
      return proof("data_analysis_transformed", [
        data.inspectSeq,
        data.transformSeq,
      ]);
    }
  }
  if (skillName === "software-delivery") {
    const mutation = events.find(
      (event) =>
        event.seq > terminalSeq &&
        event.type === "tool.completed" &&
        SOFTWARE_MUTATION_TOOLS.has(String(record(event.payload)?.toolName)),
    );
    const verification = events.find(
      (event) =>
        event.seq > (mutation?.seq ?? terminalSeq) &&
        event.type === "tool.completed" &&
        record(event.payload)?.toolName === "verify_workspace" &&
        record(record(event.payload)?.details)?.status === "passed",
    );
    if (mutation && verification) {
      return proof("software_change_verified", [
        mutation.seq,
        verification.seq,
      ]);
    }
    const observedMutation = events.find(
      (event) =>
        event.seq > terminalSeq &&
        event.type === "tool.completed" &&
        record(event.payload)?.toolName === "apply_patch" &&
        sha(record(event.payload)?.afterSha256),
    );
    const afterSha256 = record(observedMutation?.payload)?.afterSha256;
    const readBack = events.find(
      (event) =>
        event.seq > (observedMutation?.seq ?? terminalSeq) &&
        event.type === "tool.completed" &&
        record(event.payload)?.toolName === "read_file" &&
        record(record(event.payload)?.details)?.sha256 === afterSha256,
    );
    if (observedMutation && readBack) {
      return proof("software_change_observed", [
        observedMutation.seq,
        readBack.seq,
      ]);
    }
  }
  return undefined;
}

function proof(
  applicationMode: SkillApplicationMode,
  proofEventSeqs: number[],
) {
  return {
    applicationMode,
    proofEventSeqs,
    proofEventSetSha256: skillProofEventSetSha256(
      applicationMode,
      proofEventSeqs,
    ),
  };
}

function common(
  binding: SkillCatalogBinding,
  contextSeq: number,
  skillName: string,
) {
  return {
    kind: "napier.skill-lifecycle-projection" as const,
    schemaVersion: 1 as const,
    operation: "skill.lifecycle.project" as const,
    skillName,
    requestedNameSha256: sha256(skillName),
    candidateRootKinds: [] as StandardSkillRootKind[],
    catalogSha256: binding.catalogSha256,
    availabilitySetSha256: binding.availabilitySetSha256,
    snapshotManifestSha256: binding.snapshotManifestSha256,
    contextSeq,
  };
}

function origin(
  value: SkillLoadSelection | SkillLoadReceipt | SkillLoadFailure,
): Origin | undefined {
  if (value.schemaVersion === 1) {
    return { source: "project", rootKind: "project_legacy" };
  }
  return "rootKind" in value &&
    (value.source === "project" || value.source === "user")
    ? { source: value.source, rootKind: value.rootKind }
    : undefined;
}

function originFields(value: Origin) {
  return {
    source: value.source,
    rootKind: value.rootKind,
    candidateRootKinds: [] as StandardSkillRootKind[],
  };
}

function failureRoots(value: SkillLoadFailure): StandardSkillRootKind[] {
  return value.schemaVersion === 2 ? value.candidateRootKinds : [];
}

function failureName(value: SkillLoadFailure): string | undefined {
  return "canonicalName" in value ? value.canonicalName : undefined;
}

function sameBinding(
  receipt: SkillLoadReceipt,
  selection: SkillLoadSelection,
): boolean {
  return (
    receipt.schemaVersion === selection.schemaVersion &&
    receipt.requestedNameSha256 === selection.requestedNameSha256 &&
    receipt.catalogSha256 === selection.catalogSha256 &&
    receipt.snapshotManifestSha256 === selection.snapshotManifestSha256
  );
}

function researchEvidence(
  event: RunEvent,
): ResearchSourceEvidenceV1 | undefined {
  const payload = record(event.payload);
  return event.type === "tool.completed" &&
    payload?.toolName === "research_source"
    ? parseResearchSourceEvidenceV1(payload.details)
    : undefined;
}

function strictRunEvents(
  events: readonly RunEvent[],
  runId: string,
): RunEvent[] | undefined {
  const ordered = events.filter((event) => event.runId === runId);
  return ordered.every(
    (event, index) => index === 0 || event.seq > ordered[index - 1]!.seq,
  )
    ? ordered
    : undefined;
}

function seal(
  value: Omit<SkillLifecycleProjectionV1, "contentSha256">,
): SkillLifecycleProjectionV1 {
  const projection = {
    ...value,
    contentSha256: sha256(canonicalJson(value)),
  };
  if (!isSkillLifecycleProjectionV1(projection)) {
    throw new Error("Skill lifecycle projection invariant failed");
  }
  return projection;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
