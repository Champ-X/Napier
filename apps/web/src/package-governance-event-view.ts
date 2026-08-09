import type { RunEvent } from "@napier/contracts";

import { skillLifecycleEventTraceSummary } from "./skill-lifecycle-event-view";

export interface PackageGovernanceEventTraceView {
  action: string;
  family: "skill" | "prompt" | "inspector";
  status?: string;
  verificationStatus?: string;
  actionStatus?: string;
  keyId?: string;
  installationId?: string;
  replacedInstallationId?: string;
  agentId?: string;
  observedAgentId?: string;
  agentRevision?: number;
  observedAgentRevision?: number;
  skillCount?: number;
  panelCount?: number;
  sizeBytes?: number;
  lineCount?: number;
  currentSizeBytes?: number;
  currentLineCount?: number;
  created?: boolean;
  applied?: boolean;
  publisherChanged?: boolean;
  skillSetChanged?: boolean;
  manifestSha256?: string;
  envelopeSha256?: string;
  skillCatalogSha256?: string;
  observedSkillCatalogSha256?: string;
  skillNamesSha256?: string;
  systemPromptSha256?: string;
  observedSystemPromptSha256?: string;
  inspectorCatalogSha256?: string;
  observedInspectorCatalogSha256?: string;
  panelIdsSha256?: string;
  reviewSha256?: string;
  contentSha256?: string;
  frontmatterSha256?: string;
  bodySha256?: string;
  currentContentSha256?: string;
}

const PACKAGE_GOVERNANCE_EVENT =
  /^(skill\.(package\.(signed|qualified|installed|installation_matched)|content\.(noop|installed|replaced))|prompt\.package\.(signed|qualified)|inspector\.package\.(signed|qualified))$/u;
const SAFE_TOKEN = /^[A-Za-z0-9_.:/@-]{1,180}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const PACKAGE_RECEIPT_SUMMARY = "package governance receipt";

export function packageGovernanceEventTraceView(
  event: RunEvent,
): PackageGovernanceEventTraceView | undefined {
  if (!PACKAGE_GOVERNANCE_EVENT.test(event.type)) return undefined;
  if (
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return undefined;
  }
  const family = event.type.startsWith("skill.")
    ? "skill"
    : event.type.startsWith("prompt.")
      ? "prompt"
      : "inspector";
  return {
    action: event.type,
    family,
    ...safeTokenAliasField(event.payload, "action", "actionStatus"),
    ...safeTokenField(event.payload, "status"),
    ...safeTokenField(event.payload, "verificationStatus"),
    ...safeTokenField(event.payload, "keyId"),
    ...safeTokenField(event.payload, "installationId"),
    ...safeTokenField(event.payload, "replacedInstallationId"),
    ...safeTokenField(event.payload, "agentId"),
    ...safeTokenField(event.payload, "observedAgentId"),
    ...integerField(event.payload, "agentRevision"),
    ...integerField(event.payload, "observedAgentRevision"),
    ...integerField(event.payload, "skillCount"),
    ...integerField(event.payload, "panelCount"),
    ...integerField(event.payload, "sizeBytes"),
    ...integerField(event.payload, "lineCount"),
    ...integerField(event.payload, "currentSizeBytes"),
    ...integerField(event.payload, "currentLineCount"),
    ...booleanField(event.payload, "created"),
    ...booleanField(event.payload, "applied"),
    ...booleanField(event.payload, "publisherChanged"),
    ...booleanField(event.payload, "skillSetChanged"),
    ...shaField(event.payload, "manifestSha256"),
    ...shaField(event.payload, "envelopeSha256"),
    ...shaField(event.payload, "skillCatalogSha256"),
    ...shaField(event.payload, "observedSkillCatalogSha256"),
    ...shaField(event.payload, "skillNamesSha256"),
    ...shaField(event.payload, "systemPromptSha256"),
    ...shaField(event.payload, "observedSystemPromptSha256"),
    ...shaField(event.payload, "inspectorCatalogSha256"),
    ...shaField(event.payload, "observedInspectorCatalogSha256"),
    ...shaField(event.payload, "panelIdsSha256"),
    ...shaField(event.payload, "reviewSha256"),
    ...shaField(event.payload, "contentSha256"),
    ...shaField(event.payload, "frontmatterSha256"),
    ...shaField(event.payload, "bodySha256"),
    ...shaField(event.payload, "currentContentSha256"),
  };
}

export function packageGovernanceEventTraceSummary(
  event: RunEvent,
): string | undefined {
  if (!isPackageGovernancePrefix(event.type)) return undefined;
  if (event.type === "skill.lifecycle") {
    return skillLifecycleEventTraceSummary(event);
  }
  if (!PACKAGE_GOVERNANCE_EVENT.test(event.type)) return event.category;
  const view = packageGovernanceEventTraceView(event);
  if (!view) return PACKAGE_RECEIPT_SUMMARY;
  return [
    `${view.family} / ${view.action.slice(`${view.family}.`.length)}`,
    ...idSummary("installation", view.installationId),
    ...idSummary("replaced-installation", view.replacedInstallationId),
    ...idSummary("agent", view.agentId),
    ...idSummary("observed-agent", view.observedAgentId),
    ...(view.actionStatus ? [`action ${view.actionStatus}`] : []),
    ...(view.status ? [`status ${view.status}`] : []),
    ...(view.verificationStatus
      ? [`verification ${view.verificationStatus}`]
      : []),
    ...(view.keyId ? [`key ${view.keyId}`] : []),
    ...countSummaries(view),
    ...booleanSummaries(view),
    ...hashSummaries(view),
  ].join(" / ");
}

function isPackageGovernancePrefix(type: string): boolean {
  return (
    type.startsWith("skill.") ||
    type.startsWith("prompt.") ||
    type.startsWith("inspector.")
  );
}

function countSummaries(view: PackageGovernanceEventTraceView): string[] {
  return [
    ...(view.agentRevision !== undefined
      ? [`agent-revision ${view.agentRevision}`]
      : []),
    ...(view.observedAgentRevision !== undefined
      ? [`observed-agent-revision ${view.observedAgentRevision}`]
      : []),
    ...(view.skillCount !== undefined ? [`skills ${view.skillCount}`] : []),
    ...(view.panelCount !== undefined ? [`panels ${view.panelCount}`] : []),
    ...(view.sizeBytes !== undefined ? [`bytes ${view.sizeBytes}`] : []),
    ...(view.lineCount !== undefined ? [`lines ${view.lineCount}`] : []),
    ...(view.currentSizeBytes !== undefined
      ? [`current-bytes ${view.currentSizeBytes}`]
      : []),
    ...(view.currentLineCount !== undefined
      ? [`current-lines ${view.currentLineCount}`]
      : []),
  ];
}

function booleanSummaries(view: PackageGovernanceEventTraceView): string[] {
  return [
    ...(view.created !== undefined ? [`created ${view.created}`] : []),
    ...(view.applied !== undefined ? [`applied ${view.applied}`] : []),
    ...(view.publisherChanged !== undefined
      ? [`publisher-changed ${view.publisherChanged}`]
      : []),
    ...(view.skillSetChanged !== undefined
      ? [`skill-set-changed ${view.skillSetChanged}`]
      : []),
  ];
}

function hashSummaries(view: PackageGovernanceEventTraceView): string[] {
  return [
    ...hashSummary("manifest", view.manifestSha256),
    ...hashSummary("envelope", view.envelopeSha256),
    ...hashSummary("skill-catalog", view.skillCatalogSha256),
    ...hashSummary("observed-skill-catalog", view.observedSkillCatalogSha256),
    ...hashSummary("skill-names", view.skillNamesSha256),
    ...hashSummary("system-prompt", view.systemPromptSha256),
    ...hashSummary("observed-system-prompt", view.observedSystemPromptSha256),
    ...hashSummary("inspector-catalog", view.inspectorCatalogSha256),
    ...hashSummary(
      "observed-inspector-catalog",
      view.observedInspectorCatalogSha256,
    ),
    ...hashSummary("panel-ids", view.panelIdsSha256),
    ...hashSummary("review", view.reviewSha256),
    ...hashSummary("content", view.contentSha256),
    ...hashSummary("frontmatter", view.frontmatterSha256),
    ...hashSummary("body", view.bodySha256),
    ...hashSummary("current-content", view.currentContentSha256),
  ];
}

function idSummary(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(-10)}`] : [];
}

function hashSummary(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(0, 12)}`] : [];
}

function safeTokenField(
  payload: Record<string, unknown>,
  key: keyof PackageGovernanceEventTraceView,
): Partial<PackageGovernanceEventTraceView> {
  const value = safeToken(payload[key]);
  return value ? { [key]: value } : {};
}

function safeTokenAliasField(
  payload: Record<string, unknown>,
  sourceKey: string,
  targetKey: keyof PackageGovernanceEventTraceView,
): Partial<PackageGovernanceEventTraceView> {
  const value = safeToken(payload[sourceKey]);
  return value ? { [targetKey]: value } : {};
}

function integerField(
  payload: Record<string, unknown>,
  key: keyof PackageGovernanceEventTraceView,
): Partial<PackageGovernanceEventTraceView> {
  const value = payload[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? { [key]: value }
    : {};
}

function booleanField(
  payload: Record<string, unknown>,
  key: keyof PackageGovernanceEventTraceView,
): Partial<PackageGovernanceEventTraceView> {
  const value = payload[key];
  return typeof value === "boolean" ? { [key]: value } : {};
}

function shaField(
  payload: Record<string, unknown>,
  key: keyof PackageGovernanceEventTraceView,
): Partial<PackageGovernanceEventTraceView> {
  const value = sha256(payload[key]);
  return value ? { [key]: value } : {};
}

function safeToken(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_TOKEN.test(value)
    ? value
    : undefined;
}

function sha256(value: unknown): string | undefined {
  return typeof value === "string" && SHA256.test(value) ? value : undefined;
}
