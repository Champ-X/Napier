export interface PromptPackageManifest {
  kind: "napier.prompt-package-manifest";
  schemaVersion: 1;
  apiVersion: string;
  publisher: string;
  sourceAgentId: string;
  agentName: string;
  agentRevision: number;
  agentRevisionSha256: string;
  systemPromptSha256: string;
  createdAt: string;
  expiresAt?: string;
  contentSha256: string;
}

export interface PromptPackageSignature {
  algorithm: "Ed25519";
  keyId: string;
  signedAt: string;
  manifestArtifactSha256: string;
  statementSha256: string;
  value: string;
}

export interface SignedPromptPackageEnvelope {
  kind: "napier.signed-prompt-package";
  schemaVersion: 1;
  apiVersion: string;
  manifest: PromptPackageManifest;
  signature: PromptPackageSignature;
  contentSha256: string;
}

export type PromptPackageVerificationStatus = "trusted" | "revoked" | "unknown_key" | "expired" | "invalid";

export interface PromptPackageVerification {
  status: PromptPackageVerificationStatus;
  verifiedAt: string;
  manifestSha256?: string;
  envelopeSha256?: string;
  keyId?: string;
  reason: string;
}

export type PromptPackageQualificationStatus = "qualified" | "prompt_drift" | "agent_missing" | PromptPackageVerificationStatus;

export interface PromptPackageQualification {
  status: PromptPackageQualificationStatus;
  qualifiedAt: string;
  verificationStatus: PromptPackageVerificationStatus;
  manifestSha256?: string;
  envelopeSha256?: string;
  systemPromptSha256?: string;
  observedSystemPromptSha256?: string;
  sourceAgentId?: string;
  observedAgentId?: string;
  observedAgentRevision?: number;
  keyId?: string;
  reason: string;
}

export interface SignPromptPackageRequest {
  threadId: string;
  trustAnchorId: string;
  publisher: string;
  agentId: string;
  expiresAt?: string;
}

export interface VerifyPromptPackageRequest {
  envelope: unknown;
}

export interface QualifyPromptPackageRequest {
  envelope: unknown;
  agentId?: string;
  threadId?: string;
}

export type InspectorPanelId = "trace" | "processes" | "files" | "lab" | "plan" | "goal" | "memory" | "extensions" | "automations" | "context";

export interface InspectorPackageManifestPanel {
  id: InspectorPanelId;
  label: string;
  surface: "core" | "lazy";
  capabilities: string[];
}

export const NAPIER_DEFAULT_INSPECTOR_PANEL_ID: InspectorPanelId = "trace";

export const NAPIER_INSPECTOR_PANELS: readonly InspectorPackageManifestPanel[] = [
  {
    id: "trace",
    label: "Trace",
    surface: "core",
    capabilities: ["event-ledger", "otlp-export", "run-filter"],
  },
  {
    id: "processes",
    label: "Processes",
    surface: "lazy",
    capabilities: ["session-status", "output-cursor", "cancellation"],
  },
  {
    id: "files",
    label: "Files",
    surface: "lazy",
    capabilities: ["workspace-mutation-preview", "reversible-trash", "operator-restore"],
  },
  {
    id: "lab",
    label: "Run Lab",
    surface: "core",
    capabilities: ["replay-snapshot", "run-compare", "fixture-transfer", "evaluation-suite", "casebook-qualification"],
  },
  {
    id: "plan",
    label: "Plan",
    surface: "core",
    capabilities: ["dag-progress", "step-evidence", "artifact-manifest"],
  },
  {
    id: "goal",
    label: "Goal",
    surface: "core",
    capabilities: ["objective-state", "blocker-evidence"],
  },
  {
    id: "memory",
    label: "Memory",
    surface: "lazy",
    capabilities: ["review-lifecycle", "usage-register", "consolidation"],
  },
  {
    id: "extensions",
    label: "Extensions",
    surface: "lazy",
    capabilities: ["publisher-trust", "package-transfer", "tool-review", "rollout-channel"],
  },
  {
    id: "automations",
    label: "Automations",
    surface: "lazy",
    capabilities: ["schedule-claims", "webhook-delivery", "recovery-attempts"],
  },
  {
    id: "context",
    label: "Context",
    surface: "lazy",
    capabilities: ["agent-revision", "credential-reference", "prompt-package", "checkpoint"],
  },
] as const;

export interface InspectorPackageManifest {
  kind: "napier.inspector-package-manifest";
  schemaVersion: 1;
  apiVersion: string;
  publisher: string;
  defaultPanelId: InspectorPanelId;
  inspectorCatalogSha256: string;
  panels: InspectorPackageManifestPanel[];
  createdAt: string;
  expiresAt?: string;
  contentSha256: string;
}

export interface InspectorPackageSignature {
  algorithm: "Ed25519";
  keyId: string;
  signedAt: string;
  manifestArtifactSha256: string;
  statementSha256: string;
  value: string;
}

export interface SignedInspectorPackageEnvelope {
  kind: "napier.signed-inspector-package";
  schemaVersion: 1;
  apiVersion: string;
  manifest: InspectorPackageManifest;
  signature: InspectorPackageSignature;
  contentSha256: string;
}

export type InspectorPackageVerificationStatus = "trusted" | "revoked" | "unknown_key" | "expired" | "invalid";

export interface InspectorPackageVerification {
  status: InspectorPackageVerificationStatus;
  verifiedAt: string;
  panelCount: number;
  manifestSha256?: string;
  envelopeSha256?: string;
  keyId?: string;
  reason: string;
}

export type InspectorPackageQualificationStatus = "qualified" | "inspector_drift" | "missing_inspector" | InspectorPackageVerificationStatus;

export interface InspectorPackageQualification {
  status: InspectorPackageQualificationStatus;
  qualifiedAt: string;
  verificationStatus: InspectorPackageVerificationStatus;
  panelCount: number;
  manifestSha256?: string;
  envelopeSha256?: string;
  inspectorCatalogSha256?: string;
  observedInspectorCatalogSha256?: string;
  keyId?: string;
  reason: string;
}

export interface SignInspectorPackageRequest {
  threadId: string;
  trustAnchorId: string;
  publisher: string;
  expiresAt?: string;
}

export interface VerifyInspectorPackageRequest {
  envelope: unknown;
}

export interface QualifyInspectorPackageRequest {
  envelope: unknown;
  threadId?: string;
}

export interface ModelSummary {
  provider: string;
  providerName: string;
  id: string;
  name: string;
  contextWindow: number;
  reasoning: boolean;
  vision: boolean;
  configured: boolean;
}
