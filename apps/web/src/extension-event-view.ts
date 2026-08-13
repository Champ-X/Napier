import type { RunEvent } from "@napier/contracts";

export interface ExtensionEventTraceView {
  action: string;
  kind?: string;
  status?: string;
  trustStatus?: string;
  reviewStatus?: string;
  effect?: string;
  versionDirection?: string;
  algorithm?: string;
  keyId?: string;
  extensionId?: string;
  agentId?: string;
  channelId?: string;
  trustAnchorId?: string;
  revision?: number;
  channelRevision?: number;
  toolCount?: number;
  requestedCapabilityCount?: number;
  approvedCapabilityCount?: number;
  changeKindCount?: number;
  affectedExtensionCount?: number;
  candidateCount?: number;
  installCount?: number;
  updateCount?: number;
  packageCount?: number;
  dependencyCount?: number;
  channelCount?: number;
  packageHistoryCount?: number;
  signingCapable?: boolean;
  enabled?: boolean;
  publisherChanged?: boolean;
  anchorSha256?: string;
  provenanceSha256?: string;
  affectedExtensionIdsSha256?: string;
  statementSha256?: string;
  manifestSha256?: string;
  manifestArtifactSha256?: string;
  transportSha256?: string;
  envelopeSha256?: string;
  packageBindingSha256?: string;
  deploymentSha256?: string;
  installedExtensionIdsSha256?: string;
  updatedExtensionIdsSha256?: string;
  candidateEnvelopeIdsSha256?: string;
  applyOrderSha256?: string;
  dependencyResolutionSha256?: string;
  lockfileSha256?: string;
  packageEnvelopeIdsSha256?: string;
  indexSha256?: string;
  channelNamesSha256?: string;
  policySha256?: string;
  rolloutSha256?: string;
  expectedPackageBindingSha256?: string;
  currentManifestSha256?: string;
  currentEnvelopeSha256?: string;
  nextManifestSha256?: string;
  nextEnvelopeSha256?: string;
  previewSha256?: string;
  schemaSha256?: string;
}

const EXTENSION_EVENT =
  /^extension\.(publisher\.(created|revoked)|package\.(signed|imported|updated)|packages\.(deployed|lockfile\.exported|channel_index\.signed|rollout\.(published|applied))|proposed|approved|rejected|enabled|disabled|connected|disconnected|tool\.(approved|rejected))$/u;
const SAFE_TOKEN = /^[A-Za-z0-9_.:/@-]{1,180}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const EXTENSION_RECEIPT_SUMMARY = "extension receipt";

export function extensionEventTraceView(
  event: RunEvent,
): ExtensionEventTraceView | undefined {
  if (!EXTENSION_EVENT.test(event.type)) return undefined;
  if (
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return undefined;
  }
  const requestedCapabilities = Array.isArray(
    event.payload["requestedCapabilities"],
  )
    ? event.payload["requestedCapabilities"]
    : undefined;
  const approvedCapabilities = Array.isArray(
    event.payload["approvedCapabilities"],
  )
    ? event.payload["approvedCapabilities"]
    : undefined;
  const changeKinds = Array.isArray(event.payload["changeKinds"])
    ? event.payload["changeKinds"]
    : undefined;
  return {
    action: event.type.slice("extension.".length),
    ...safeTokenField(event.payload, "kind"),
    ...safeTokenField(event.payload, "status"),
    ...safeTokenField(event.payload, "trustStatus"),
    ...safeTokenField(event.payload, "reviewStatus"),
    ...safeTokenField(event.payload, "effect"),
    ...safeTokenField(event.payload, "versionDirection"),
    ...safeTokenField(event.payload, "algorithm"),
    ...safeTokenField(event.payload, "keyId"),
    ...safeTokenField(event.payload, "extensionId"),
    ...safeTokenField(event.payload, "agentId"),
    ...safeTokenField(event.payload, "channelId"),
    ...safeTokenField(event.payload, "trustAnchorId"),
    ...integerField(event.payload, "revision"),
    ...integerField(event.payload, "channelRevision"),
    ...integerField(event.payload, "toolCount"),
    ...(requestedCapabilities
      ? { requestedCapabilityCount: requestedCapabilities.length }
      : {}),
    ...(approvedCapabilities
      ? { approvedCapabilityCount: approvedCapabilities.length }
      : {}),
    ...(changeKinds ? { changeKindCount: changeKinds.length } : {}),
    ...integerField(event.payload, "affectedExtensionCount"),
    ...integerField(event.payload, "candidateCount"),
    ...integerField(event.payload, "installCount"),
    ...integerField(event.payload, "updateCount"),
    ...integerField(event.payload, "packageCount"),
    ...integerField(event.payload, "dependencyCount"),
    ...integerField(event.payload, "channelCount"),
    ...integerField(event.payload, "packageHistoryCount"),
    ...booleanField(event.payload, "signingCapable"),
    ...booleanField(event.payload, "enabled"),
    ...booleanField(event.payload, "publisherChanged"),
    ...shaField(event.payload, "anchorSha256"),
    ...shaField(event.payload, "provenanceSha256"),
    ...shaField(event.payload, "affectedExtensionIdsSha256"),
    ...shaField(event.payload, "statementSha256"),
    ...shaField(event.payload, "manifestSha256"),
    ...shaField(event.payload, "manifestArtifactSha256"),
    ...shaField(event.payload, "transportSha256"),
    ...shaField(event.payload, "envelopeSha256"),
    ...shaField(event.payload, "packageBindingSha256"),
    ...shaField(event.payload, "deploymentSha256"),
    ...shaField(event.payload, "installedExtensionIdsSha256"),
    ...shaField(event.payload, "updatedExtensionIdsSha256"),
    ...shaField(event.payload, "candidateEnvelopeIdsSha256"),
    ...shaField(event.payload, "applyOrderSha256"),
    ...shaField(event.payload, "dependencyResolutionSha256"),
    ...shaField(event.payload, "lockfileSha256"),
    ...shaField(event.payload, "packageEnvelopeIdsSha256"),
    ...shaField(event.payload, "indexSha256"),
    ...shaField(event.payload, "channelNamesSha256"),
    ...shaField(event.payload, "policySha256"),
    ...shaField(event.payload, "rolloutSha256"),
    ...shaField(event.payload, "expectedPackageBindingSha256"),
    ...shaField(event.payload, "currentManifestSha256"),
    ...shaField(event.payload, "currentEnvelopeSha256"),
    ...shaField(event.payload, "nextManifestSha256"),
    ...shaField(event.payload, "nextEnvelopeSha256"),
    ...shaField(event.payload, "previewSha256"),
    ...shaField(event.payload, "schemaSha256"),
  };
}

export function extensionEventTraceSummary(
  event: RunEvent,
): string | undefined {
  if (!event.type.startsWith("extension.")) return undefined;
  if (!EXTENSION_EVENT.test(event.type)) return event.category;
  const view = extensionEventTraceView(event);
  if (!view) return EXTENSION_RECEIPT_SUMMARY;
  return [
    `extension / ${view.action}`,
    ...idSummary("extension", view.extensionId),
    ...idSummary("agent", view.agentId),
    ...idSummary("channel", view.channelId),
    ...idSummary("anchor", view.trustAnchorId),
    ...(view.kind ? [`kind ${view.kind}`] : []),
    ...(view.status ? [`status ${view.status}`] : []),
    ...(view.trustStatus ? [`trust ${view.trustStatus}`] : []),
    ...(view.reviewStatus ? [`review ${view.reviewStatus}`] : []),
    ...(view.effect ? [`effect ${view.effect}`] : []),
    ...(view.versionDirection ? [`version ${view.versionDirection}`] : []),
    ...(view.algorithm ? [`algorithm ${view.algorithm}`] : []),
    ...(view.keyId ? [`key ${view.keyId}`] : []),
    ...booleanSummaries(view),
    ...countSummaries(view),
    ...(view.revision !== undefined ? [`revision ${view.revision}`] : []),
    ...(view.channelRevision !== undefined
      ? [`channel-revision ${view.channelRevision}`]
      : []),
    ...hashSummaries(view),
  ].join(" / ");
}

function booleanSummaries(view: ExtensionEventTraceView): string[] {
  return [
    ...(view.signingCapable !== undefined
      ? [`signing-capable ${view.signingCapable}`]
      : []),
    ...(view.enabled !== undefined ? [`enabled ${view.enabled}`] : []),
    ...(view.publisherChanged !== undefined
      ? [`publisher-changed ${view.publisherChanged}`]
      : []),
  ];
}

function countSummaries(view: ExtensionEventTraceView): string[] {
  return [
    ...(view.toolCount !== undefined ? [`tools ${view.toolCount}`] : []),
    ...(view.requestedCapabilityCount !== undefined
      ? [`requested-capabilities ${view.requestedCapabilityCount}`]
      : []),
    ...(view.approvedCapabilityCount !== undefined
      ? [`approved-capabilities ${view.approvedCapabilityCount}`]
      : []),
    ...(view.changeKindCount !== undefined
      ? [`change-kinds ${view.changeKindCount}`]
      : []),
    ...(view.affectedExtensionCount !== undefined
      ? [`affected-extensions ${view.affectedExtensionCount}`]
      : []),
    ...(view.candidateCount !== undefined
      ? [`candidates ${view.candidateCount}`]
      : []),
    ...(view.installCount !== undefined
      ? [`installed ${view.installCount}`]
      : []),
    ...(view.updateCount !== undefined ? [`updated ${view.updateCount}`] : []),
    ...(view.packageCount !== undefined
      ? [`packages ${view.packageCount}`]
      : []),
    ...(view.dependencyCount !== undefined
      ? [`dependencies ${view.dependencyCount}`]
      : []),
    ...(view.channelCount !== undefined
      ? [`channels ${view.channelCount}`]
      : []),
    ...(view.packageHistoryCount !== undefined
      ? [`package-history ${view.packageHistoryCount}`]
      : []),
  ];
}

function hashSummaries(view: ExtensionEventTraceView): string[] {
  return [
    ...hashSummary("anchor", view.anchorSha256),
    ...hashSummary("provenance", view.provenanceSha256),
    ...hashSummary("affected", view.affectedExtensionIdsSha256),
    ...hashSummary("statement", view.statementSha256),
    ...hashSummary("manifest", view.manifestSha256),
    ...hashSummary("manifest-artifact", view.manifestArtifactSha256),
    ...hashSummary("transport", view.transportSha256),
    ...hashSummary("envelope", view.envelopeSha256),
    ...hashSummary("package-binding", view.packageBindingSha256),
    ...hashSummary("deployment", view.deploymentSha256),
    ...hashSummary("installed", view.installedExtensionIdsSha256),
    ...hashSummary("updated", view.updatedExtensionIdsSha256),
    ...hashSummary("candidate-envelopes", view.candidateEnvelopeIdsSha256),
    ...hashSummary("apply-order", view.applyOrderSha256),
    ...hashSummary("dependency-resolution", view.dependencyResolutionSha256),
    ...hashSummary("lockfile", view.lockfileSha256),
    ...hashSummary("package-envelopes", view.packageEnvelopeIdsSha256),
    ...hashSummary("index", view.indexSha256),
    ...hashSummary("channel-names", view.channelNamesSha256),
    ...hashSummary("policy", view.policySha256),
    ...hashSummary("rollout", view.rolloutSha256),
    ...hashSummary("expected-binding", view.expectedPackageBindingSha256),
    ...hashSummary("current-manifest", view.currentManifestSha256),
    ...hashSummary("current-envelope", view.currentEnvelopeSha256),
    ...hashSummary("next-manifest", view.nextManifestSha256),
    ...hashSummary("next-envelope", view.nextEnvelopeSha256),
    ...hashSummary("preview", view.previewSha256),
    ...hashSummary("schema", view.schemaSha256),
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
  key: keyof ExtensionEventTraceView,
): Partial<ExtensionEventTraceView> {
  const value = safeToken(payload[key]);
  return value ? { [key]: value } : {};
}

function integerField(
  payload: Record<string, unknown>,
  key: keyof ExtensionEventTraceView,
): Partial<ExtensionEventTraceView> {
  const value = payload[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? { [key]: value }
    : {};
}

function booleanField(
  payload: Record<string, unknown>,
  key: keyof ExtensionEventTraceView,
): Partial<ExtensionEventTraceView> {
  const value = payload[key];
  return typeof value === "boolean" ? { [key]: value } : {};
}

function shaField(
  payload: Record<string, unknown>,
  key: keyof ExtensionEventTraceView,
): Partial<ExtensionEventTraceView> {
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
