import type { RunEvent } from "@napier/contracts";

export interface ContextEventTraceView {
  action: string;
  schemaVersion?: number;
  messageCount?: number;
  userMessageCount?: number;
  assistantMessageCount?: number;
  toolResultMessageCount?: number;
  otherMessageCount?: number;
  toolCount?: number;
  skillCount?: number;
  definitionCount?: number;
  requestedSkillCount?: number;
  loadedSkillCount?: number;
  missingSkillCount?: number;
  referencedVariableCount?: number;
  referenceCount?: number;
  unresolvedReferenceCount?: number;
  systemPromptBytes?: number;
  turnIndex?: number;
  capsuleBytes?: number;
  outputTextBytes?: number;
  count?: number;
  truncated?: boolean;
  enabled?: boolean;
  isError?: boolean;
  threshold?: number;
  exemptToolCount?: number;
  fromSeq?: number;
  toSeq?: number;
  retainedFromSeq?: number;
  sourceEventCount?: number;
  fallbackMessageCount?: number;
  omittedMessageCount?: number;
  checkpointId?: string;
  parentCheckpointId?: string;
  decisionCount?: number;
  openLoopCount?: number;
  artifactCount?: number;
  delegationTaskCount?: number;
  delegationActiveTaskCount?: number;
  delegationOmittedTaskCount?: number;
  milestoneCount?: number;
  milestoneSelectedCount?: number;
  milestoneOmittedCount?: number;
  milestoneTextRedacted?: boolean;
  toolPolicy?: string;
  purpose?: string;
  model?: string;
  callId?: string;
  toolName?: string;
  effect?: string;
  storage?: string;
  reason?: string;
  skillCatalogInjected?: boolean;
  contentSha256?: string;
  sourceSha256?: string;
  summarySha256?: string;
  skillCatalogSha256?: string;
  diagnosticsSha256?: string;
  renderedSystemPromptSha256?: string;
  catalogSha256?: string;
  unresolvedNameSetSha256?: string;
  messageSetSha256?: string;
  toolNameSetSha256?: string;
  toolDefinitionSetSha256?: string;
  systemPromptSha256?: string;
  policySha256?: string;
  exemptToolSetSha256?: string;
  previousProjectionSha256?: string;
  delegationTaskSetSha256?: string;
  delegationProjectionSha256?: string;
  milestoneSetSha256?: string;
  milestoneProjectionSha256?: string;
  contextEnvelopeSha256?: string;
  contextSha256?: string;
  capsuleSha256?: string;
  invocationCapsuleSha256?: string;
  resultSha256?: string;
  outputTextSha256?: string;
  toolDefinitionSha256?: string;
  argumentsSha256?: string;
  workspaceScopeSha256?: string;
}

const CONTEXT_EVENT =
  /^context\.(skills|prepared|memory|model_adapter|model_envelope|model_invocation(_unavailable)?|prompt_package|tool_invocation(_unavailable)?|tool_result(_unavailable)?|prompt_variables|tool_loop_guard|delegation\.updated|milestones\.updated|compaction\.(started|completed|failed))$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,120}$/u;
const CONTEXT_RECEIPT_SUMMARY = "context receipt";

export function contextEventTraceView(
  event: RunEvent,
): ContextEventTraceView | undefined {
  if (!CONTEXT_EVENT.test(event.type)) return undefined;
  if (
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return undefined;
  }
  const requestedSkillNames = array(event.payload["requestedSkillNames"]);
  const loadedSkillNames = array(event.payload["loadedSkillNames"]);
  const missingSkillNames = array(event.payload["missingSkillNames"]);
  const skills = array(event.payload["skills"]);
  const decisions = array(event.payload["decisions"]);
  const openLoops = array(event.payload["openLoops"]);
  const artifacts = array(event.payload["artifacts"]);
  return {
    action: event.type.slice("context.".length),
    ...numberField(event.payload, "schemaVersion"),
    ...numberField(event.payload, "messageCount"),
    ...numberField(event.payload, "userMessageCount"),
    ...numberField(event.payload, "assistantMessageCount"),
    ...numberField(event.payload, "toolResultMessageCount"),
    ...numberField(event.payload, "otherMessageCount"),
    ...numberField(event.payload, "toolCount"),
    ...(skills ? { skillCount: skills.length } : {}),
    ...numberField(event.payload, "definitionCount"),
    ...(requestedSkillNames
      ? { requestedSkillCount: requestedSkillNames.length }
      : {}),
    ...(loadedSkillNames ? { loadedSkillCount: loadedSkillNames.length } : {}),
    ...(missingSkillNames
      ? { missingSkillCount: missingSkillNames.length }
      : {}),
    ...numberField(event.payload, "referencedVariableCount"),
    ...numberField(event.payload, "referenceCount"),
    ...numberField(event.payload, "unresolvedReferenceCount"),
    ...numberField(event.payload, "systemPromptBytes"),
    ...numberField(event.payload, "turnIndex"),
    ...numberField(event.payload, "capsuleBytes"),
    ...numberField(event.payload, "outputTextBytes"),
    ...numberField(event.payload, "count"),
    ...booleanField(event.payload, "truncated"),
    ...booleanField(event.payload, "enabled"),
    ...booleanField(event.payload, "isError"),
    ...numberField(event.payload, "threshold"),
    ...numberField(event.payload, "exemptToolCount"),
    ...numberField(event.payload, "fromSeq"),
    ...numberField(event.payload, "toSeq"),
    ...numberField(event.payload, "retainedFromSeq"),
    ...numberField(event.payload, "sourceEventCount"),
    ...numberField(event.payload, "fallbackMessageCount"),
    ...numberField(event.payload, "omittedMessageCount"),
    ...safeIdField(event.payload, "checkpointId"),
    ...safeIdField(event.payload, "parentCheckpointId"),
    ...(decisions ? { decisionCount: decisions.length } : {}),
    ...(openLoops ? { openLoopCount: openLoops.length } : {}),
    ...(artifacts ? { artifactCount: artifacts.length } : {}),
    ...numberField(event.payload, "delegationTaskCount"),
    ...numberField(event.payload, "delegationActiveTaskCount"),
    ...numberField(event.payload, "delegationOmittedTaskCount"),
    ...numberField(event.payload, "milestoneCount"),
    ...numberField(event.payload, "milestoneSelectedCount"),
    ...numberField(event.payload, "milestoneOmittedCount"),
    ...booleanField(event.payload, "milestoneTextRedacted"),
    ...safeTokenField(event.payload, "toolPolicy"),
    ...safeTokenField(event.payload, "purpose"),
    ...modelField(event.payload),
    ...safeIdField(event.payload, "callId"),
    ...safeTokenField(event.payload, "toolName"),
    ...safeTokenField(event.payload, "effect"),
    ...safeTokenField(event.payload, "storage"),
    ...safeTokenField(event.payload, "reason"),
    ...booleanField(event.payload, "skillCatalogInjected"),
    ...shaField(event.payload, "contentSha256"),
    ...shaField(event.payload, "sourceSha256"),
    ...shaField(event.payload, "summarySha256"),
    ...shaField(event.payload, "skillCatalogSha256"),
    ...shaField(event.payload, "diagnosticsSha256"),
    ...shaField(event.payload, "renderedSystemPromptSha256"),
    ...shaField(event.payload, "catalogSha256"),
    ...shaField(event.payload, "unresolvedNameSetSha256"),
    ...shaField(event.payload, "messageSetSha256"),
    ...shaField(event.payload, "toolNameSetSha256"),
    ...shaField(event.payload, "toolDefinitionSetSha256"),
    ...shaField(event.payload, "systemPromptSha256"),
    ...shaField(event.payload, "policySha256"),
    ...shaField(event.payload, "exemptToolSetSha256"),
    ...shaField(event.payload, "previousProjectionSha256"),
    ...shaField(event.payload, "delegationTaskSetSha256"),
    ...shaField(event.payload, "delegationProjectionSha256"),
    ...shaField(event.payload, "milestoneSetSha256"),
    ...shaField(event.payload, "milestoneProjectionSha256"),
    ...shaField(event.payload, "contextEnvelopeSha256"),
    ...shaField(event.payload, "contextSha256"),
    ...shaField(event.payload, "capsuleSha256"),
    ...shaField(event.payload, "invocationCapsuleSha256"),
    ...shaField(event.payload, "resultSha256"),
    ...shaField(event.payload, "outputTextSha256"),
    ...shaField(event.payload, "toolDefinitionSha256"),
    ...shaField(event.payload, "argumentsSha256"),
    ...shaField(event.payload, "workspaceScopeSha256"),
  };
}

export function contextEventTraceSummary(event: RunEvent): string | undefined {
  if (!event.type.startsWith("context.")) return undefined;
  if (!CONTEXT_EVENT.test(event.type)) return event.category;
  const view = contextEventTraceView(event);
  if (!view) return CONTEXT_RECEIPT_SUMMARY;
  return [
    `context / ${view.action}`,
    ...(view.schemaVersion !== undefined
      ? [`schema ${view.schemaVersion}`]
      : []),
    ...(view.toolPolicy ? [`policy ${view.toolPolicy}`] : []),
    ...(view.purpose ? [`purpose ${view.purpose}`] : []),
    ...(view.model ? [`model ${view.model}`] : []),
    ...(view.callId ? [`call ${view.callId.slice(-10)}`] : []),
    ...(view.toolName ? [`tool ${view.toolName}`] : []),
    ...(view.effect ? [`effect ${view.effect}`] : []),
    ...(view.storage ? [`storage ${view.storage}`] : []),
    ...(view.reason ? [`reason ${view.reason}`] : []),
    ...(view.turnIndex !== undefined ? [`turn ${view.turnIndex}`] : []),
    ...(view.capsuleBytes !== undefined
      ? [`capsule-bytes ${view.capsuleBytes}`]
      : []),
    ...(view.outputTextBytes !== undefined
      ? [`output-bytes ${view.outputTextBytes}`]
      : []),
    ...(view.isError !== undefined ? [`error ${view.isError}`] : []),
    ...(view.enabled !== undefined ? [`enabled ${view.enabled}`] : []),
    ...(view.threshold !== undefined ? [`threshold ${view.threshold}`] : []),
    ...(view.messageCount !== undefined
      ? [`messages ${view.messageCount}`]
      : []),
    ...(view.userMessageCount !== undefined
      ? [`user ${view.userMessageCount}`]
      : []),
    ...(view.assistantMessageCount !== undefined
      ? [`assistant ${view.assistantMessageCount}`]
      : []),
    ...(view.toolResultMessageCount !== undefined
      ? [`tool-results ${view.toolResultMessageCount}`]
      : []),
    ...(view.otherMessageCount !== undefined
      ? [`other ${view.otherMessageCount}`]
      : []),
    ...(view.toolCount !== undefined ? [`tools ${view.toolCount}`] : []),
    ...(view.skillCount !== undefined ? [`skills ${view.skillCount}`] : []),
    ...(view.definitionCount !== undefined
      ? [`definitions ${view.definitionCount}`]
      : []),
    ...(view.requestedSkillCount !== undefined
      ? [`requested ${view.requestedSkillCount}`]
      : []),
    ...(view.loadedSkillCount !== undefined
      ? [`loaded ${view.loadedSkillCount}`]
      : []),
    ...(view.missingSkillCount !== undefined
      ? [`missing ${view.missingSkillCount}`]
      : []),
    ...(view.referencedVariableCount !== undefined
      ? [`referenced ${view.referencedVariableCount}`]
      : []),
    ...(view.referenceCount !== undefined
      ? [`references ${view.referenceCount}`]
      : []),
    ...(view.unresolvedReferenceCount !== undefined
      ? [`unresolved ${view.unresolvedReferenceCount}`]
      : []),
    ...(view.skillCatalogInjected !== undefined
      ? [`skill-catalog ${view.skillCatalogInjected}`]
      : []),
    ...(view.count !== undefined ? [`count ${view.count}`] : []),
    ...(view.truncated !== undefined ? [`truncated ${view.truncated}`] : []),
    ...(view.exemptToolCount !== undefined
      ? [`exempt-tools ${view.exemptToolCount}`]
      : []),
    ...rangeSummary(view),
    ...(view.sourceEventCount !== undefined
      ? [`events ${view.sourceEventCount}`]
      : []),
    ...(view.fallbackMessageCount !== undefined
      ? [`fallback ${view.fallbackMessageCount}`]
      : []),
    ...(view.omittedMessageCount !== undefined
      ? [`omitted ${view.omittedMessageCount}`]
      : []),
    ...(view.checkpointId
      ? [`checkpoint ${view.checkpointId.slice(-10)}`]
      : []),
    ...(view.parentCheckpointId
      ? [`parent ${view.parentCheckpointId.slice(-10)}`]
      : []),
    ...(view.decisionCount !== undefined
      ? [`decisions ${view.decisionCount}`]
      : []),
    ...(view.openLoopCount !== undefined
      ? [`open-loops ${view.openLoopCount}`]
      : []),
    ...(view.artifactCount !== undefined
      ? [`artifacts ${view.artifactCount}`]
      : []),
    ...(view.delegationTaskCount !== undefined
      ? [`delegation ${view.delegationTaskCount}`]
      : []),
    ...(view.delegationActiveTaskCount !== undefined
      ? [`active ${view.delegationActiveTaskCount}`]
      : []),
    ...(view.delegationOmittedTaskCount !== undefined
      ? [`omitted-delegation ${view.delegationOmittedTaskCount}`]
      : []),
    ...(view.milestoneCount !== undefined
      ? [`milestones ${view.milestoneCount}`]
      : []),
    ...(view.milestoneSelectedCount !== undefined
      ? [`selected ${view.milestoneSelectedCount}`]
      : []),
    ...(view.milestoneOmittedCount !== undefined
      ? [`omitted-milestones ${view.milestoneOmittedCount}`]
      : []),
    ...(view.milestoneTextRedacted !== undefined
      ? [`milestone-text-redacted ${view.milestoneTextRedacted}`]
      : []),
    ...(view.systemPromptBytes !== undefined
      ? [`system-prompt-bytes ${view.systemPromptBytes}`]
      : []),
    ...hashSummaries(view),
  ].join(" / ");
}

function rangeSummary(view: ContextEventTraceView): string[] {
  if (view.fromSeq !== undefined && view.toSeq !== undefined) {
    return [
      `range ${view.fromSeq}-${view.toSeq}`,
      ...(view.retainedFromSeq !== undefined
        ? [`retained ${view.retainedFromSeq}`]
        : []),
    ];
  }
  if (view.fromSeq !== undefined) return [`from ${view.fromSeq}`];
  if (view.toSeq !== undefined) return [`to ${view.toSeq}`];
  return view.retainedFromSeq !== undefined
    ? [`retained ${view.retainedFromSeq}`]
    : [];
}

function hashSummaries(view: ContextEventTraceView): string[] {
  return [
    ...hashSummary("content", view.contentSha256),
    ...hashSummary("source", view.sourceSha256),
    ...hashSummary("summary", view.summarySha256),
    ...hashSummary("skill-catalog", view.skillCatalogSha256),
    ...hashSummary("diagnostics", view.diagnosticsSha256),
    ...hashSummary("rendered-prompt", view.renderedSystemPromptSha256),
    ...hashSummary("catalog", view.catalogSha256),
    ...hashSummary("unresolved-names", view.unresolvedNameSetSha256),
    ...hashSummary("system-prompt", view.systemPromptSha256),
    ...hashSummary("message-set", view.messageSetSha256),
    ...hashSummary("tool-names", view.toolNameSetSha256),
    ...hashSummary("tool-defs", view.toolDefinitionSetSha256),
    ...hashSummary("policy", view.policySha256),
    ...hashSummary("exempt-set", view.exemptToolSetSha256),
    ...hashSummary("previous", view.previousProjectionSha256),
    ...hashSummary("delegation-set", view.delegationTaskSetSha256),
    ...hashSummary("delegation-projection", view.delegationProjectionSha256),
    ...hashSummary("milestone-set", view.milestoneSetSha256),
    ...hashSummary("milestone-projection", view.milestoneProjectionSha256),
    ...hashSummary("context-envelope", view.contextEnvelopeSha256),
    ...hashSummary("context", view.contextSha256),
    ...hashSummary("capsule", view.capsuleSha256),
    ...hashSummary("invocation-capsule", view.invocationCapsuleSha256),
    ...hashSummary("result", view.resultSha256),
    ...hashSummary("output", view.outputTextSha256),
    ...hashSummary("tool-definition", view.toolDefinitionSha256),
    ...hashSummary("arguments", view.argumentsSha256),
    ...hashSummary("workspace-scope", view.workspaceScopeSha256),
  ];
}

function hashSummary(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(0, 12)}`] : [];
}

function numberField(
  payload: Record<string, unknown>,
  key: keyof ContextEventTraceView,
): Partial<ContextEventTraceView> {
  const value = nonNegativeInteger(payload[key]);
  return value === undefined ? {} : { [key]: value };
}

function booleanField(
  payload: Record<string, unknown>,
  key: keyof ContextEventTraceView,
): Partial<ContextEventTraceView> {
  const value = payload[key];
  return typeof value === "boolean" ? { [key]: value } : {};
}

function safeIdField(
  payload: Record<string, unknown>,
  key: keyof ContextEventTraceView,
): Partial<ContextEventTraceView> {
  const value = safeToken(payload[key]);
  return value ? { [key]: value } : {};
}

function safeTokenField(
  payload: Record<string, unknown>,
  key: keyof ContextEventTraceView,
): Partial<ContextEventTraceView> {
  const value = safeToken(payload[key]);
  return value ? { [key]: value } : {};
}

function modelField(
  payload: Record<string, unknown>,
): Partial<ContextEventTraceView> {
  const model = payload["model"];
  if (typeof model === "string") {
    const value = safeToken(model);
    return value ? { model: value } : {};
  }
  if (!model || typeof model !== "object" || Array.isArray(model)) return {};
  const value = model as Record<string, unknown>;
  const provider = safeToken(value["provider"]);
  const id = safeToken(value["id"]);
  return provider && id ? { model: `${provider}/${id}` } : {};
}

function shaField(
  payload: Record<string, unknown>,
  key: keyof ContextEventTraceView,
): Partial<ContextEventTraceView> {
  const value = sha256(payload[key]);
  return value ? { [key]: value } : {};
}

function array(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function safeToken(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_TOKEN.test(value)
    ? value
    : undefined;
}

function sha256(value: unknown): string | undefined {
  return typeof value === "string" && SHA256.test(value) ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}
