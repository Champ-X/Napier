import { parseResearchSourceEvidenceV1 as parseResearchSourceEvidence, type ResearchSourceEvidenceV1, type SourceEvidence } from "./skill-load-research.js";
import { canonical, codeUnit, exact, hashed, hex, integer, name, object, sha256 } from "./skill-load-validation.js";

export type { ResearchSourceEvidenceV1 } from "./skill-load-research.js";

export const SKILL_LOAD_FAILURE_CODES = ["skill_not_enabled", "skill_not_found", "skill_ambiguous", "skill_disabled", "skill_invalid", "skill_untrusted", "skill_catalog_drift", "skill_limit_exceeded", "skill_load_cancelled"] as const;
export type SkillLoadFailureCode = (typeof SKILL_LOAD_FAILURE_CODES)[number];
export type SkillLifecycleState = "selected" | "loaded" | "failed" | "unavailable" | "applied";

type Sha = string;
type RequestRecord =
  | {
      position: number;
      requestedNameSha256: Sha;
      state: "loadable";
      canonicalName: string;
    }
  | {
      position: number;
      requestedNameSha256: Sha;
      state: "unavailable";
      failureContentSha256: Sha;
      canonicalName?: string;
    };

export interface SkillLoadReceiptV1 {
  kind: "napier.skill-load-receipt"; schemaVersion: 1;
  operation: "skill.load"; agentToolName: "skill_load"; state: "loaded";
  name: string; requestedNameSha256: Sha; source: "project";
  relativePath: string; sizeBytes: number; lineCount: number;
  rawContentSha256: Sha; invocationSha256: Sha; catalogSha256: Sha;
  snapshotManifestSha256: Sha;
  contentSha256: Sha;
}
type RequestFailure = {
  kind: "napier.skill-load-failure"; schemaVersion: 1;
  operation: "skill.load"; agentToolName: "skill_load"; source: "project";
  subject: "skill_request"; state: "failed" | "unavailable";
  failureCode: SkillLoadFailureCode; requestedNameSha256: Sha;
  canonicalName?: string; catalogSha256: Sha; snapshotManifestSha256?: Sha;
  diagnosticSha256: Sha;
  contentSha256: Sha;
};
type CatalogFailure = {
  kind: "napier.skill-load-failure"; schemaVersion: 1;
  operation: "skill.load"; agentToolName: "skill_load"; source: "project";
  subject: "project_catalog"; state: "unavailable";
  failureCode: "skill_limit_exceeded"; observedDirectoryCount: 65;
  directoryIdentitySetSha256: Sha; catalogSha256: Sha; diagnosticSha256: Sha;
  contentSha256: Sha;
};
export type SkillLoadFailureV1 = RequestFailure | CatalogFailure;
export interface SkillCatalogBindingV1 {
  kind: "napier.skill-catalog-binding"; schemaVersion: 1;
  operation: "skill.load"; agentToolName: "skill_load";
  configuredSkillRequests: RequestRecord[];
  loadableSkillNames: string[]; unavailableSkills: SkillLoadFailureV1[];
  catalogSha256: Sha; availabilitySetSha256: Sha; snapshotManifestSha256: Sha;
  contentSha256: Sha;
}
export interface SkillLoadSelectionV1 {
  kind: "napier.skill-load-selection"; schemaVersion: 1;
  operation: "skill.load"; agentToolName: "skill_load"; state: "selected";
  name: string; requestedNameSha256: Sha; source: "project";
  catalogSha256: Sha; availabilitySetSha256: Sha; snapshotManifestSha256: Sha;
  inputSha256: Sha;
  contentSha256: Sha;
}
type ManifestEntry = {
  canonicalName: string;
  requestedNameSha256: Sha;
  relativePath: string;
  virtualPath: string;
  directoryKind: "directory";
  fileKind: "regular_file";
  symlinkFree: true;
  sizeBytes: number;
  lineCount: number;
  rawContentSha256: Sha;
  metadataSha256: Sha;
  invocationSha256: Sha;
};
export interface ProjectSkillSnapshotManifestV1 {
  kind: "napier.project-skill-snapshot-manifest";
  schemaVersion: 1;
  source: "project";
  trustOrigin: "active_user_selected_project";
  workspaceIdentitySha256: Sha;
  trustPolicySha256: Sha;
  configuredSkillRequests: RequestRecord[];
  selectionSha256: Sha;
  directDirectoryCount: number;
  directoryIdentitySetSha256: Sha;
  catalogSha256: Sha;
  availabilitySetSha256: Sha;
  entryCount: number;
  aggregateRawBytes: number;
  entries: ManifestEntry[];
  unavailableFailureContentSha256s: Sha[];
  snapshotContentSha256: Sha;
  snapshotManifestSha256: Sha;
}
export interface SkillApplicationProjectionV1 {
  kind: "napier.skill-application-projection";
  schemaVersion: 1;
  runId: string;
  requestedNameSha256: Sha;
  skillName?: string;
  operation: "skill.load";
  agentToolName: "skill_load";
  source: "project";
  state: SkillLifecycleState;
  catalogSha256: Sha;
  availabilitySetSha256: Sha;
  snapshotManifestSha256: Sha;
  contextSeq: number;
  selectedSeq?: number;
  terminalSeq?: number;
  captureSeq?: number;
  citeSeq?: number;
  applicationSeq?: number;
  callId?: string;
  receiptContentSha256?: Sha;
  failureContentSha256?: Sha;
  applicationMode?: "citation_adjacent" | "verified_report";
  citationTokenSha256?: Sha;
  reportFileSha256?: Sha;
  reportCitationSetSha256?: Sha;
  projectionSha256: Sha;
}
function requestRecord(value: unknown, position: number): value is RequestRecord {
  if (!object(value) || value.position !== position || !hex(value.requestedNameSha256)) return false;
  if (value.state === "loadable") return exact(value, ["position", "requestedNameSha256", "state", "canonicalName"]) && name(value.canonicalName) && sha256(value.canonicalName) === value.requestedNameSha256;
  return value.state === "unavailable" && exact(value, ["position", "requestedNameSha256", "state", "failureContentSha256"], ["canonicalName"]) && hex(value.failureContentSha256) && (value.canonicalName === undefined || (name(value.canonicalName) && sha256(value.canonicalName) === value.requestedNameSha256));
}
export function isSkillLoadReceiptV1(value: unknown): value is SkillLoadReceiptV1 {
  if (!object(value) || !exact(value, ["kind", "schemaVersion", "operation", "agentToolName", "state", "name", "requestedNameSha256", "source", "relativePath", "sizeBytes", "lineCount", "rawContentSha256", "invocationSha256", "catalogSha256", "snapshotManifestSha256", "contentSha256"])) return false;
  return value.kind === "napier.skill-load-receipt" && value.schemaVersion === 1 && value.operation === "skill.load" && value.agentToolName === "skill_load" && value.state === "loaded" && name(value.name) && value.requestedNameSha256 === sha256(value.name) && value.source === "project" && value.relativePath === `skills/${value.name}/SKILL.md` && new TextEncoder().encode(value.relativePath).length <= 80 && integer(value.sizeBytes, 1, 131072) && integer(value.lineCount, 1, 131073) && ["rawContentSha256", "invocationSha256", "catalogSha256", "snapshotManifestSha256"].every((key) => hex(value[key])) && hashed(value, "contentSha256");
}
export function isSkillLoadFailureV1(value: unknown): value is SkillLoadFailureV1 {
  if (!object(value) || value.kind !== "napier.skill-load-failure" || value.schemaVersion !== 1 || value.operation !== "skill.load" || value.agentToolName !== "skill_load" || value.source !== "project" || !SKILL_LOAD_FAILURE_CODES.includes(value.failureCode as SkillLoadFailureCode) || !hex(value.catalogSha256) || !hex(value.diagnosticSha256)) return false;
  if (value.subject === "project_catalog") return isProjectCatalogFailure(value);
  return isRequestFailure(value);
}
function isProjectCatalogFailure(value: Record<string, unknown>): boolean {
  return (
    exact(value, ["kind", "schemaVersion", "operation", "agentToolName", "source", "subject", "state", "failureCode", "observedDirectoryCount", "directoryIdentitySetSha256", "catalogSha256", "diagnosticSha256", "contentSha256"]) &&
    value.state === "unavailable" &&
    value.failureCode === "skill_limit_exceeded" &&
    value.observedDirectoryCount === 65 &&
    hex(value.directoryIdentitySetSha256) &&
    value.catalogSha256 ===
      sha256(
        canonical({
          directDirectoryCount: 65,
          directoryIdentitySetSha256: value.directoryIdentitySetSha256,
        }),
      ) &&
    hashed(value, "contentSha256")
  );
}
function isRequestFailure(value: Record<string, unknown>): boolean {
  if (value.subject !== "skill_request" || (value.state !== "failed" && value.state !== "unavailable")) return false;
  const required = ["kind", "schemaVersion", "operation", "agentToolName", "source", "subject", "state", "failureCode", "requestedNameSha256", "catalogSha256", "diagnosticSha256", "contentSha256"];
  if (!exact(value, required, ["canonicalName", "snapshotManifestSha256"]) || !hex(value.requestedNameSha256) || (value.canonicalName !== undefined && (!name(value.canonicalName) || sha256(value.canonicalName) !== value.requestedNameSha256))) return false;
  return (value.state === "failed" ? hex(value.snapshotManifestSha256) : value.snapshotManifestSha256 === undefined) && hashed(value, "contentSha256");
}
export function isSkillCatalogBindingV1(value: unknown): value is SkillCatalogBindingV1 {
  if (!object(value) || !exact(value, ["kind", "schemaVersion", "operation", "agentToolName", "configuredSkillRequests", "loadableSkillNames", "unavailableSkills", "catalogSha256", "availabilitySetSha256", "snapshotManifestSha256", "contentSha256"]) || value.kind !== "napier.skill-catalog-binding" || value.schemaVersion !== 1 || value.operation !== "skill.load" || value.agentToolName !== "skill_load" || !Array.isArray(value.configuredSkillRequests) || value.configuredSkillRequests.length > 64 || !value.configuredSkillRequests.every(requestRecord) || !Array.isArray(value.loadableSkillNames) || !value.loadableSkillNames.every(name) || !sortedUnique(value.loadableSkillNames) || !Array.isArray(value.unavailableSkills) || !value.unavailableSkills.every(isSkillLoadFailureV1) || !hex(value.catalogSha256) || !hex(value.snapshotManifestSha256)) return false;
  const requests = value.configuredSkillRequests as RequestRecord[],
    failures = value.unavailableSkills as SkillLoadFailureV1[];
  if (failures.some((item) => item.subject !== "skill_request" || item.state !== "unavailable" || item.catalogSha256 !== value.catalogSha256) || !sortedUnique(failures.map((item) => item.contentSha256)) || !requestFailureRelations(requests, failures)) return false;
  const loadable = requests
    .filter((item) => item.state === "loadable")
    .map((item) => item.canonicalName)
    .sort(codeUnit);
  if (canonical(loadable) !== canonical(value.loadableSkillNames)) return false;
  const availability = {
    configuredSkillRequests: requests,
    loadableSkillNames: value.loadableSkillNames,
    unavailableFailureContentSha256s: failures.map((item) => item.contentSha256),
    catalogSha256: value.catalogSha256,
  };
  return value.availabilitySetSha256 === sha256(canonical(availability)) && hashed(value, "contentSha256");
}
export function isSkillLoadSelectionV1(value: unknown): value is SkillLoadSelectionV1 {
  return object(value) && exact(value, ["kind", "schemaVersion", "operation", "agentToolName", "state", "name", "requestedNameSha256", "source", "catalogSha256", "availabilitySetSha256", "snapshotManifestSha256", "inputSha256", "contentSha256"]) && value.kind === "napier.skill-load-selection" && value.schemaVersion === 1 && value.operation === "skill.load" && value.agentToolName === "skill_load" && value.state === "selected" && name(value.name) && value.requestedNameSha256 === sha256(value.name) && value.source === "project" && ["catalogSha256", "availabilitySetSha256", "snapshotManifestSha256"].every((key) => hex(value[key])) && value.inputSha256 === sha256(canonical({ name: value.name })) && hashed(value, "contentSha256");
}
export function isProjectSkillSnapshotManifestV1(value: unknown): value is ProjectSkillSnapshotManifestV1 {
  return object(value) && validManifestShape(value) && validManifestRelations(value as unknown as ProjectSkillSnapshotManifestV1);
}
function validManifestShape(value: Record<string, unknown>): boolean {
  return exact(value, ["kind", "schemaVersion", "source", "trustOrigin", "workspaceIdentitySha256", "trustPolicySha256", "configuredSkillRequests", "selectionSha256", "directDirectoryCount", "directoryIdentitySetSha256", "catalogSha256", "availabilitySetSha256", "entryCount", "aggregateRawBytes", "entries", "unavailableFailureContentSha256s", "snapshotContentSha256", "snapshotManifestSha256"]) && value.kind === "napier.project-skill-snapshot-manifest" && value.schemaVersion === 1 && value.source === "project" && value.trustOrigin === "active_user_selected_project" && ["workspaceIdentitySha256", "trustPolicySha256", "selectionSha256", "directoryIdentitySetSha256", "catalogSha256", "availabilitySetSha256", "snapshotContentSha256"].every((key) => hex(value[key])) && Array.isArray(value.configuredSkillRequests) && value.configuredSkillRequests.length <= 64 && value.configuredSkillRequests.every(requestRecord) && value.selectionSha256 === sha256(canonical(value.configuredSkillRequests)) && integer(value.directDirectoryCount, 0, 64) && integer(value.entryCount, 0, 64) && integer(value.aggregateRawBytes, 0, 8388608) && Array.isArray(value.entries) && value.entries.length === value.entryCount && Array.isArray(value.unavailableFailureContentSha256s) && value.unavailableFailureContentSha256s.every(hex) && sortedUnique(value.unavailableFailureContentSha256s);
}
function validManifestRelations(value: ProjectSkillSnapshotManifestV1): boolean {
  const requests = value.configuredSkillRequests,
    entries = value.entries as unknown as Record<string, unknown>[],
    names = entries.map((entry) => String(entry.canonicalName));
  if (!sortedUnique(names) || entries.some((entry) => !manifestEntry(entry)) || entries.reduce((sum, entry) => sum + Number(entry.sizeBytes), 0) !== value.aggregateRawBytes || entries.length > value.directDirectoryCount) return false;
  const loadable = requests.filter((item) => item.state === "loadable");
  if (canonical(loadable.map((item) => item.canonicalName).sort(codeUnit)) !== canonical(names) || loadable.some((item) => !entries.some((entry) => entry.canonicalName === item.canonicalName && entry.requestedNameSha256 === item.requestedNameSha256))) return false;
  const unavailable = [...new Set(requests.filter((item) => item.state === "unavailable").map((item) => item.failureContentSha256))].sort(codeUnit);
  if (canonical(unavailable) !== canonical(value.unavailableFailureContentSha256s)) return false;
  if (
    value.catalogSha256 !==
      sha256(
        canonical({
          directDirectoryCount: value.directDirectoryCount,
          directoryIdentitySetSha256: value.directoryIdentitySetSha256,
          entries,
        }),
      ) ||
    value.availabilitySetSha256 !==
      sha256(
        canonical({
          configuredSkillRequests: requests,
          loadableSkillNames: names,
          unavailableFailureContentSha256s: unavailable,
          catalogSha256: value.catalogSha256,
        }),
      )
  )
    return false;
  return hashed(value as unknown as Record<string, unknown>, "snapshotManifestSha256");
}
function manifestEntry(value: unknown): value is ManifestEntry {
  if (!object(value) || !exact(value, ["canonicalName", "requestedNameSha256", "relativePath", "virtualPath", "directoryKind", "fileKind", "symlinkFree", "sizeBytes", "lineCount", "rawContentSha256", "metadataSha256", "invocationSha256"]) || !name(value.canonicalName)) return false;
  return value.requestedNameSha256 === sha256(value.canonicalName) && value.relativePath === `skills/${value.canonicalName}/SKILL.md` && value.virtualPath === `/project/skills/${value.canonicalName}/SKILL.md` && value.directoryKind === "directory" && value.fileKind === "regular_file" && value.symlinkFree === true && integer(value.sizeBytes, 1, 131072) && integer(value.lineCount, 1, 131073) && ["rawContentSha256", "metadataSha256", "invocationSha256"].every((key) => hex(value[key]));
}
function sortedUnique(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]! < value);
}
function requestFailureRelations(requests: RequestRecord[], failures: SkillLoadFailureV1[]): boolean {
  const refs = [...new Set(requests.filter((item) => item.state === "unavailable").map((item) => item.failureContentSha256))].sort(codeUnit);
  if (canonical(refs) !== canonical(failures.map((item) => item.contentSha256))) return false;
  return requests
    .filter((item) => item.state === "unavailable")
    .every((request) => {
      const failure = failures.find((item) => item.contentSha256 === request.failureContentSha256);
      return failure?.subject === "skill_request" && failure.requestedNameSha256 === request.requestedNameSha256 && failure.canonicalName === request.canonicalName;
    });
}

export function parseResearchSourceEvidenceV1(input: unknown): ResearchSourceEvidenceV1 | undefined {
  return parseResearchSourceEvidence(input);
}

type ProjectionInput = Omit<SkillApplicationProjectionV1, "projectionSha256">;
type ProjectionCommon = Omit<ProjectionInput, "state" | "selectedSeq" | "terminalSeq" | "captureSeq" | "citeSeq" | "applicationSeq" | "callId" | "receiptContentSha256" | "failureContentSha256" | "applicationMode" | "citationTokenSha256" | "reportFileSha256" | "reportCitationSetSha256">;
type ProjectionContext = {
  ordered: Record<string, unknown>[];
  binding: SkillCatalogBindingV1;
  request: RequestRecord;
  common: ProjectionCommon;
};
type ResearchEvent = {
  event: Record<string, unknown>;
  evidence: ResearchSourceEvidenceV1;
};
type LoadAttempt = {
  selected: ProjectionInput & {
    state: "selected";
    selectedSeq: number;
    callId: string;
  };
  terminal?: Record<string, unknown>;
  endSeq: number;
};

export function projectSkillApplicationV1(events: readonly unknown[], runId: string, target: { canonicalName: string } | { requestedNameSha256: string }): SkillApplicationProjectionV1 | undefined {
  const resolvedTarget = resolveProjectionTarget(runId, target);
  if (!resolvedTarget) return undefined;
  const context = resolveProjectionContext(events, runId, resolvedTarget);
  if (!context) return undefined;
  if (context.request.state === "unavailable") {
    return projection({ ...context.common, state: "unavailable" });
  }
  return projectLoadLifecycle(context);
}

function resolveProjectionTarget(runId: string, target: { canonicalName: string } | { requestedNameSha256: string }): { canonicalName?: string; digest: string } | undefined {
  if (!/\S/u.test(runId) || runId.length > 160 || !object(target)) return;
  const targetKeys = Object.hasOwn(target, "canonicalName") ? ["canonicalName"] : ["requestedNameSha256"];
  if (!exact(target, targetKeys)) return;
  const targetName = "canonicalName" in target ? target.canonicalName : undefined;
  const targetDigest = "requestedNameSha256" in target ? target.requestedNameSha256 : undefined;
  const canonicalName = name(targetName) ? targetName : undefined;
  const digest = canonicalName ? sha256(canonicalName) : hex(targetDigest) ? targetDigest : undefined;
  return digest ? { ...(canonicalName ? { canonicalName } : {}), digest } : undefined;
}

function resolveProjectionContext(events: readonly unknown[], runId: string, target: { canonicalName?: string; digest: string }): ProjectionContext | undefined {
  const ordered = strictRunEvents(events, runId);
  if (!ordered) return undefined;
  const contexts = ordered.filter((event) => event.type === "context.skills");
  if (contexts.length !== 1 || !isSkillCatalogBindingV1(contexts[0]!.payload)) return undefined;
  const context = contexts[0]!;
  const binding = context.payload as SkillCatalogBindingV1;
  const request = binding.configuredSkillRequests.find((item) => item.requestedNameSha256 === target.digest && (target.canonicalName === undefined || item.canonicalName === target.canonicalName));
  if (!request) return undefined;
  return {
    ordered,
    binding,
    request,
    common: {
      kind: "napier.skill-application-projection",
      schemaVersion: 1,
      runId,
      requestedNameSha256: target.digest,
      ...(request.canonicalName ? { skillName: request.canonicalName } : {}),
      operation: "skill.load",
      agentToolName: "skill_load",
      source: "project",
      catalogSha256: binding.catalogSha256,
      availabilitySetSha256: binding.availabilitySetSha256,
      snapshotManifestSha256: binding.snapshotManifestSha256,
      contextSeq: Number(context.seq),
    },
  };
}

function strictRunEvents(events: readonly unknown[], runId: string): Record<string, unknown>[] | undefined {
  const ordered: Record<string, unknown>[] = [];
  let previous = 0;
  for (const event of events) {
    if (!object(event) || event.runId !== runId || !integer(event.seq, 1, Number.MAX_SAFE_INTEGER) || Number(event.seq) <= previous) return;
    previous = Number(event.seq);
    ordered.push(event);
  }
  return ordered;
}

function projectLoadLifecycle(context: ProjectionContext): SkillApplicationProjectionV1 | undefined {
  const { ordered, binding, request, common } = context;
  const attempts = collectLoadAttempts(ordered, binding, common);
  if (!attempts?.length) return undefined;
  let latest: SkillApplicationProjectionV1 | undefined, applied: SkillApplicationProjectionV1 | undefined;
  for (const attempt of attempts) {
    if (!attempt.terminal) {
      latest = projection(attempt.selected);
      continue;
    }
    latest = projectLoadTerminal(ordered, binding, request, attempt);
    if (!latest) return undefined;
    if (latest.state === "applied" && !applied) applied = latest;
  }
  return applied ?? latest;
}

function collectLoadAttempts(ordered: Record<string, unknown>[], binding: SkillCatalogBindingV1, common: ProjectionCommon): LoadAttempt[] | undefined {
  const starts: {
    event: Record<string, unknown>;
    selection: SkillLoadSelectionV1;
    payload: Record<string, unknown>;
  }[] = [];
  for (const event of ordered) {
    if (Number(event.seq) <= common.contextSeq || event.type !== "tool.started") continue;
    if (!object(event.payload) || event.payload.toolName !== "skill_load") continue;
    if (!isSkillLoadSelectionV1(event.payload.details)) return;
    const selection = event.payload.details;
    if (selection.requestedNameSha256 !== common.requestedNameSha256) continue;
    if (!selectionBindsContext(selection, event.payload, binding)) return;
    starts.push({ event, selection, payload: event.payload });
  }
  const callIds = starts.map((item) => String(item.payload.callId));
  if (new Set(callIds).size !== callIds.length) return;
  const attempts: LoadAttempt[] = [];
  for (const [index, start] of starts.entries()) {
    const endSeq = index + 1 < starts.length ? Number(starts[index + 1]!.event.seq) : Number.POSITIVE_INFINITY;
    const terminals = ordered.filter((event) => (event.type === "tool.completed" || event.type === "tool.failed") && object(event.payload) && event.payload.toolName === "skill_load" && event.payload.callId === start.payload.callId);
    if (terminals.length > 1 || terminals.some((event) => Number(event.seq) <= Number(start.event.seq) || Number(event.seq) >= endSeq)) return;
    attempts.push({
      selected: {
        ...common,
        state: "selected",
        selectedSeq: Number(start.event.seq),
        callId: String(start.payload.callId),
      },
      ...(terminals[0] ? { terminal: terminals[0] } : {}),
      endSeq,
    });
  }
  return attempts;
}

function selectionBindsContext(selection: SkillLoadSelectionV1, payload: Record<string, unknown>, binding: SkillCatalogBindingV1): boolean {
  return selection.catalogSha256 === binding.catalogSha256 && selection.availabilitySetSha256 === binding.availabilitySetSha256 && selection.snapshotManifestSha256 === binding.snapshotManifestSha256 && typeof payload.callId === "string" && /\S/u.test(payload.callId) && payload.callId.length <= 160;
}

function projectLoadTerminal(ordered: Record<string, unknown>[], binding: SkillCatalogBindingV1, request: RequestRecord, attempt: LoadAttempt): SkillApplicationProjectionV1 | undefined {
  const { selected, terminal, endSeq } = attempt;
  if (!terminal) return projection(selected);
  const details = (terminal.payload as Record<string, unknown>).details;
  if (terminal.type === "tool.failed") {
    if (!isSkillLoadFailureV1(details) || details.subject !== "skill_request" || details.state !== "failed" || details.requestedNameSha256 !== request.requestedNameSha256 || details.canonicalName !== request.canonicalName || details.catalogSha256 !== binding.catalogSha256 || details.snapshotManifestSha256 !== binding.snapshotManifestSha256) {
      return undefined;
    }
    return projection({
      ...selected,
      state: "failed",
      terminalSeq: Number(terminal.seq),
      failureContentSha256: details.contentSha256,
    });
  }
  if (!isSkillLoadReceiptV1(details) || details.name !== request.canonicalName || details.requestedNameSha256 !== request.requestedNameSha256 || details.catalogSha256 !== binding.catalogSha256 || details.snapshotManifestSha256 !== binding.snapshotManifestSha256) {
    return undefined;
  }
  const loaded = {
    ...selected,
    state: "loaded" as const,
    terminalSeq: Number(terminal.seq),
    receiptContentSha256: details.contentSha256,
  };
  return request.canonicalName === "research-brief" ? projectResearchApplication(ordered, loaded, endSeq) : projection(loaded);
}

function projectResearchApplication(
  ordered: Record<string, unknown>[],
  loaded: ProjectionInput & {
    state: "loaded";
    selectedSeq: number;
    terminalSeq: number;
    callId: string;
    receiptContentSha256: string;
  },
  endSeq: number,
): SkillApplicationProjectionV1 {
  const research = collectResearchEvents(ordered, loaded.terminalSeq, endSeq);
  if (!research) return projection(loaded);
  const capture = research.find((item) => item.evidence.action === "capture" || item.evidence.action === "capture_fetch");
  if (!capture) return projection(loaded);
  const source = capture.evidence as SourceEvidence;
  const cite = research.find((item) => Number(item.event.seq) > Number(capture.event.seq) && item.evidence.action === "cite" && (item.evidence as SourceEvidence).sourceId === source.sourceId && (item.evidence as SourceEvidence).sourceContentSha256 === source.sourceContentSha256);
  if (!cite) return projection(loaded);
  const cited = cite.evidence as SourceEvidence & { citationTokenSha256: Sha };
  const report = research.find((item) => Number(item.event.seq) > Number(cite.event.seq) && item.evidence.action === "verify_report");
  if (report) {
    if (!isExactApplicationChain(research, capture, cite, Number(report.event.seq))) {
      return projection(loaded);
    }
    const evidence = report.evidence as Extract<ResearchSourceEvidenceV1, { action: "verify_report" }>;
    return projection({
      ...loaded,
      state: "applied",
      captureSeq: Number(capture.event.seq),
      citeSeq: Number(cite.event.seq),
      applicationSeq: Number(report.event.seq),
      applicationMode: "verified_report",
      reportFileSha256: evidence.reportFileSha256,
      reportCitationSetSha256: evidence.reportCitationSetSha256,
    });
  }
  const assistant = ordered.filter((event) => Number(event.seq) > Number(cite.event.seq) && Number(event.seq) < endSeq && event.type === "message.assistant").at(-1);
  if (assistant && (!object(assistant.payload) || typeof assistant.payload.text !== "string" || !citationAdjacent(assistant.payload.text, cited.citationTokenSha256))) return projection(loaded);
  if (!assistant || !isExactApplicationChain(research, capture, cite, Number(assistant.seq))) {
    return projection(loaded);
  }
  return projection({
    ...loaded,
    state: "applied",
    captureSeq: Number(capture.event.seq),
    citeSeq: Number(cite.event.seq),
    applicationSeq: Number(assistant.seq),
    applicationMode: "citation_adjacent",
    citationTokenSha256: cited.citationTokenSha256,
  });
}

function collectResearchEvents(ordered: Record<string, unknown>[], terminalSeq: number, endSeq: number): ResearchEvent[] | undefined {
  const research: ResearchEvent[] = [];
  for (const event of ordered) {
    if (Number(event.seq) <= terminalSeq || Number(event.seq) >= endSeq || event.type !== "tool.completed" || !object(event.payload) || event.payload.toolName !== "research_source") {
      continue;
    }
    const raw = event.payload.details;
    if (!object(raw) || raw.kind !== "napier.research-source-evidence") return;
    const evidence = parseResearchSourceEvidenceV1(raw);
    if (!evidence) return;
    research.push({ event, evidence });
  }
  return research;
}

function isExactApplicationChain(research: ResearchEvent[], capture: ResearchEvent, cite: ResearchEvent, applicationSeq: number): boolean {
  const chain = research.filter((item) => Number(item.event.seq) < applicationSeq && (item.evidence.action === "capture" || item.evidence.action === "capture_fetch" || item.evidence.action === "cite"));
  return chain.length === 2 && chain[0] === capture && chain[1] === cite;
}
function citationAdjacent(text: string, tokenSha: string): boolean {
  const lines = text.split(/\r?\n/u);
  return lines.some((line, index) => index > 0 && /^\[citation:citation_[a-z0-9]{8,80}\]$/u.test(line.trim()) && lines[index - 1]!.trim().length > 0 && sha256(line.trim()) === tokenSha);
}
function projection<T extends Omit<SkillApplicationProjectionV1, "projectionSha256">>(value: T): SkillApplicationProjectionV1 {
  return {
    ...value,
    projectionSha256: sha256(canonical(value)),
  } as SkillApplicationProjectionV1;
}
