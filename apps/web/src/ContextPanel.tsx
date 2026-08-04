import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  BookOpen,
  Database,
  FileCheck,
  History,
  KeyRound,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

import type {
  AgentProfile,
  AgentProfileField,
  AgentProfileRevision,
  AutomaticRecoveryMode,
  BootstrapResponse,
  ContextCheckpointCalibrationReport,
  ContextCheckpointSnapshot,
  CredentialReference,
  CredentialReferenceSource,
  ExtensionPublisherTrustAnchor,
  InstallSkillPackageResult,
  ModelAdvisorMode,
  ModelAdvisorRuleId,
  ModelSummary,
  PromptPackageQualification,
  PromptPackageVerification,
  PromptVariableDefinition,
  SignedPromptPackageEnvelope,
  SignedSkillPackageEnvelope,
  SkillContentReview,
  SkillPackageInstallation,
  SkillPackageQualification,
  SkillPackageVerification,
  SubagentRole,
  ToolLoopGuardPolicy,
  UsagePriceTableCatalog,
} from "@napier/contracts";
import { AGENT_TOOL_NAMES } from "@napier/contracts";

import {
  applySkillContent,
  checkCredentialReference,
  createCredentialReference,
  createMacOsKeychainCredential,
  getAgentProfileRevisions,
  getContextBootstrap,
  installSkillPackage,
  previewSkillContent,
  qualifyPromptPackage,
  qualifySkillPackage,
  rollbackAgentProfileRevision,
  setCredentialReferenceStatus,
  signPromptPackage,
  signSkillPackage,
  updateAgentProfile,
  verifyPromptPackage,
  verifySkillPackage,
} from "./context-api";
import { contextCopy } from "./context-copy";
import {
  applyCredentialProviderDraft,
  credentialReferenceDraft,
} from "./credential-reference-view-model";
import { formatApiErrorMessage } from "./api-error";
import {
  modelProviderGroups,
  reviewerModelAvailability,
  selectedModelAvailability,
} from "./model-selection-view-model";
import { AgentCapabilityPresetControl } from "./AgentCapabilityPresetControl";

const copy = { context: contextCopy };
const DEFAULT_RUN_LIMITS = {
  maxTurns: 24,
  maxTotalTokens: 250_000,
  maxCostUsd: 10,
  timeoutMs: 900_000,
} as const;
const DEFAULT_MODEL_ADVISOR_POLICY = {
  mode: "observe" as const,
  enabledRules: [
    "unverified_verification_claim" as const,
    "destructive_command_reference" as const,
  ],
  maxCorrectionAttempts: 0,
};
const MODEL_ADVISOR_RULES: ModelAdvisorRuleId[] = [
  "unverified_verification_claim",
  "destructive_command_reference",
];
const MAX_SKILL_CONTENT_FILE_BYTES = 128 * 1024;
const MAX_PROMPT_PACKAGE_FILE_BYTES = 129 * 1024;
const MAX_SKILL_PACKAGE_FILE_BYTES = 513 * 1024;

type PromptPackageReceipt =
  | {
      action: "signed";
      status: "signed";
      reason: string;
      envelopeSha256: string;
      manifestSha256: string;
      systemPromptSha256: string;
      keyId: string;
      agentRevision: number;
    }
  | {
      action: "verified";
      status: PromptPackageVerification["status"];
      reason: string;
      envelopeSha256?: string;
      manifestSha256?: string;
      keyId?: string;
    }
  | {
      action: "qualified";
      status: PromptPackageQualification["status"];
      reason: string;
      envelopeSha256?: string;
      manifestSha256?: string;
      systemPromptSha256?: string;
      observedSystemPromptSha256?: string;
      keyId?: string;
      observedAgentRevision?: number;
    };

type SkillPackageReceipt =
  | {
      action: "signed";
      status: "signed";
      reason: string;
      envelopeSha256: string;
      manifestSha256: string;
      skillCatalogSha256: string;
      keyId: string;
      skillCount: number;
    }
  | {
      action: "verified";
      status: SkillPackageVerification["status"];
      reason: string;
      envelopeSha256?: string;
      manifestSha256?: string;
      keyId?: string;
      skillCount: number;
    }
  | {
      action: "qualified";
      status: SkillPackageQualification["status"];
      reason: string;
      envelopeSha256?: string;
      manifestSha256?: string;
      skillCatalogSha256?: string;
      observedSkillCatalogSha256?: string;
      keyId?: string;
      skillCount: number;
    }
  | {
      action: "installed";
      status: "installed" | "matched";
      reason: string;
      envelopeSha256: string;
      manifestSha256: string;
      skillCatalogSha256: string;
      keyId: string;
      skillCount: number;
      installationId: string;
      replacedInstallationId?: string;
    };

type SkillContentReceipt =
  | {
      action: "previewed";
      review: SkillContentReview;
      reason: string;
    }
  | {
      action: "applied";
      review: SkillContentReview;
      applied: boolean;
      reason: string;
    };

export interface ContextPanelProps {
  agent: AgentProfile;
  workspace: string;
  skills: string[];
  models: ModelSummary[];
  credentials: CredentialReference[];
  publisherAnchors: ExtensionPublisherTrustAnchor[];
  skillPackageInstallations: SkillPackageInstallation[];
  usagePriceTableCatalog: UsagePriceTableCatalog;
  threadId: string;
  selectedModelKey: string;
  checkpoint?: ContextCheckpointSnapshot;
  checkpointCalibration?: ContextCheckpointCalibrationReport;
  onModel: (value: string) => void;
  onAgentUpdated: (agent: AgentProfile) => void;
  onBootstrapUpdated: (bootstrap: BootstrapResponse) => void;
}

export default function ContextPanel({
  agent,
  workspace,
  skills,
  models,
  credentials,
  publisherAnchors,
  skillPackageInstallations,
  usagePriceTableCatalog,
  threadId,
  selectedModelKey,
  checkpoint,
  checkpointCalibration,
  onModel,
  onAgentUpdated,
  onBootstrapUpdated,
}: ContextPanelProps) {
  const providers = [
    ...new Set(
      models
        .map((model) => model.provider)
        .filter((provider) => provider !== "napier"),
    ),
  ];
  const modelGroups = modelProviderGroups(models);
  const selectedModel = selectedModelAvailability(models, selectedModelKey);
  const promptSigningAnchors = publisherAnchors.filter(
    (anchor) => anchor.status === "trusted" && anchor.signingSource,
  );
  const skillSigningAnchors = promptSigningAnchors;
  const activeSkillPackageInstallation = skillPackageInstallations.find(
    (installation) => installation.status === "active",
  );
  const [agentName, setAgentName] = useState(agent.name);
  const [agentDescription, setAgentDescription] = useState(agent.description);
  const [agentSystemPrompt, setAgentSystemPrompt] = useState(
    agent.systemPrompt,
  );
  const [agentPromptVariables, setAgentPromptVariables] = useState<
    PromptVariableDefinition[]
  >(() => structuredClone(agent.promptVariables ?? []));
  const [agentThinkingLevel, setAgentThinkingLevel] = useState(
    agent.thinkingLevel,
  );
  const [agentToolPolicy, setAgentToolPolicy] = useState(agent.toolPolicy);
  const [agentTools, setAgentTools] = useState(agent.enabledTools);
  const [agentSkills, setAgentSkills] = useState(agent.enabledSkills);
  const [agentSubagents, setAgentSubagents] = useState(
    agent.enabledSubagents ?? [],
  );
  const [agentRecoveryMode, setAgentRecoveryMode] =
    useState<AutomaticRecoveryMode>(agent.automaticRecovery?.mode ?? "manual");
  const [agentRecoveryMaxAttempts, setAgentRecoveryMaxAttempts] = useState(
    agent.automaticRecovery?.maxAttempts ?? 2,
  );
  const [agentRecoveryBackoffSeconds, setAgentRecoveryBackoffSeconds] =
    useState(Math.round((agent.automaticRecovery?.backoffMs ?? 5_000) / 1_000));
  const [agentAdvisorMode, setAgentAdvisorMode] = useState<ModelAdvisorMode>(
    agent.modelAdvisor?.mode ?? DEFAULT_MODEL_ADVISOR_POLICY.mode,
  );
  const [agentAdvisorRules, setAgentAdvisorRules] = useState<
    ModelAdvisorRuleId[]
  >(
    agent.modelAdvisor?.enabledRules ??
      DEFAULT_MODEL_ADVISOR_POLICY.enabledRules,
  );
  const [agentAdvisorCorrectionAttempts, setAgentAdvisorCorrectionAttempts] =
    useState(
      agent.modelAdvisor?.maxCorrectionAttempts ??
        DEFAULT_MODEL_ADVISOR_POLICY.maxCorrectionAttempts,
    );
  const [agentAdvisorReviewModelKey, setAgentAdvisorReviewModelKey] = useState(
    agent.modelAdvisor?.reviewModel
      ? `${agent.modelAdvisor.reviewModel.provider}/${agent.modelAdvisor.reviewModel.id}`
      : "",
  );
  const advisorReviewModel = reviewerModelAvailability(
    models,
    agentAdvisorReviewModelKey,
    selectedModelKey,
  );
  const shouldPersistAdvisorReviewModel =
    agentAdvisorMode !== "off" && agentAdvisorReviewModelKey.length > 0;
  const advisorReviewModelAvailable =
    !shouldPersistAdvisorReviewModel || advisorReviewModel.available;
  const [agentToolLoopGuardEnabled, setAgentToolLoopGuardEnabled] = useState(
    agent.toolLoopGuard?.enabled ?? true,
  );
  const [agentToolLoopGuardThreshold, setAgentToolLoopGuardThreshold] =
    useState(agent.toolLoopGuard?.threshold ?? 3);
  const [agentToolLoopGuardExemptTools, setAgentToolLoopGuardExemptTools] =
    useState((agent.toolLoopGuard?.exemptTools ?? []).join(", "));
  const [agentRunMaxTurns, setAgentRunMaxTurns] = useState(
    agent.runLimits?.maxTurns ?? DEFAULT_RUN_LIMITS.maxTurns,
  );
  const [agentRunMaxTotalTokens, setAgentRunMaxTotalTokens] = useState(
    agent.runLimits?.maxTotalTokens ?? DEFAULT_RUN_LIMITS.maxTotalTokens,
  );
  const [agentRunMaxCostUsd, setAgentRunMaxCostUsd] = useState(
    agent.runLimits?.maxCostUsd ?? DEFAULT_RUN_LIMITS.maxCostUsd,
  );
  const [agentRunTimeoutSeconds, setAgentRunTimeoutSeconds] = useState(
    Math.round(
      (agent.runLimits?.timeoutMs ?? DEFAULT_RUN_LIMITS.timeoutMs) / 1_000,
    ),
  );
  const [agentMaxConcurrent, setAgentMaxConcurrent] = useState(
    agent.subagentLimits?.maxConcurrent ?? 2,
  );
  const [agentMaxTotal, setAgentMaxTotal] = useState(
    agent.subagentLimits?.maxTotal ?? 4,
  );
  const [agentMaxTurns, setAgentMaxTurns] = useState(
    agent.subagentLimits?.maxTurns ?? 8,
  );
  const [agentTimeoutSeconds, setAgentTimeoutSeconds] = useState(
    Math.round((agent.subagentLimits?.timeoutMs ?? 120_000) / 1_000),
  );
  const [configurationBusy, setConfigurationBusy] = useState(false);
  const [agentRevisions, setAgentRevisions] = useState<AgentProfileRevision[]>(
    [],
  );
  const [historyLoading, setHistoryLoading] = useState(true);
  const [rollbackTarget, setRollbackTarget] = useState<AgentProfileRevision>();
  const initialCredentialDraft = credentialReferenceDraft(
    providers[0] ?? "openai",
  );
  const [credentialProvider, setCredentialProvider] = useState(
    initialCredentialDraft.providerId,
  );
  const [credentialLabel, setCredentialLabel] = useState(
    initialCredentialDraft.label,
  );
  const [credentialSourceType, setCredentialSourceType] =
    useState<CredentialReferenceSource["type"]>("environment");
  const [credentialEnvVariable, setCredentialEnvVariable] = useState(
    initialCredentialDraft.environmentVariable,
  );
  const [credentialKeychainService, setCredentialKeychainService] = useState(
    initialCredentialDraft.keychainService,
  );
  const [credentialKeychainAccount, setCredentialKeychainAccount] = useState(
    initialCredentialDraft.keychainAccount,
  );
  const [credentialKeychainSecret, setCredentialKeychainSecret] = useState("");
  const [credentialKeychainReplace, setCredentialKeychainReplace] =
    useState(false);
  const [credentialBusyId, setCredentialBusyId] = useState<string>();
  const [skillPublisher, setSkillPublisher] = useState<string>(
    copy.context.skillPackageDefaultPublisher,
  );
  const [skillTrustAnchorId, setSkillTrustAnchorId] = useState(
    skillSigningAnchors[0]?.id ?? "",
  );
  const [skillPackageBusy, setSkillPackageBusy] = useState(false);
  const [skillPackageReceipt, setSkillPackageReceipt] =
    useState<SkillPackageReceipt>();
  const [skillReplacementConfirmed, setSkillReplacementConfirmed] =
    useState(false);
  const [skillPublisherChangeConfirmed, setSkillPublisherChangeConfirmed] =
    useState(false);
  const [skillSetChangeConfirmed, setSkillSetChangeConfirmed] = useState(false);
  const [skillContentText, setSkillContentText] = useState("");
  const [skillContentBusy, setSkillContentBusy] = useState(false);
  const [skillContentReceipt, setSkillContentReceipt] =
    useState<SkillContentReceipt>();
  const [skillContentInstallConfirmed, setSkillContentInstallConfirmed] =
    useState(false);
  const [
    skillContentReplacementConfirmed,
    setSkillContentReplacementConfirmed,
  ] = useState(false);
  const [promptPublisher, setPromptPublisher] = useState<string>(
    copy.context.promptPackageDefaultPublisher,
  );
  const [promptTrustAnchorId, setPromptTrustAnchorId] = useState(
    promptSigningAnchors[0]?.id ?? "",
  );
  const [promptPackageBusy, setPromptPackageBusy] = useState(false);
  const [promptPackageReceipt, setPromptPackageReceipt] =
    useState<PromptPackageReceipt>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    setAgentName(agent.name);
    setAgentDescription(agent.description);
    setAgentSystemPrompt(agent.systemPrompt);
    setAgentPromptVariables(structuredClone(agent.promptVariables ?? []));
    setAgentThinkingLevel(agent.thinkingLevel);
    setAgentToolPolicy(agent.toolPolicy);
    setAgentTools(agent.enabledTools);
    setAgentSkills(agent.enabledSkills);
    setAgentSubagents(agent.enabledSubagents ?? []);
    setAgentRecoveryMode(agent.automaticRecovery?.mode ?? "manual");
    setAgentRecoveryMaxAttempts(agent.automaticRecovery?.maxAttempts ?? 2);
    setAgentRecoveryBackoffSeconds(
      Math.round((agent.automaticRecovery?.backoffMs ?? 5_000) / 1_000),
    );
    setAgentAdvisorMode(
      agent.modelAdvisor?.mode ?? DEFAULT_MODEL_ADVISOR_POLICY.mode,
    );
    setAgentAdvisorRules(
      agent.modelAdvisor?.enabledRules ??
        DEFAULT_MODEL_ADVISOR_POLICY.enabledRules,
    );
    setAgentAdvisorCorrectionAttempts(
      agent.modelAdvisor?.maxCorrectionAttempts ??
        DEFAULT_MODEL_ADVISOR_POLICY.maxCorrectionAttempts,
    );
    setAgentAdvisorReviewModelKey(
      agent.modelAdvisor?.reviewModel
        ? `${agent.modelAdvisor.reviewModel.provider}/${agent.modelAdvisor.reviewModel.id}`
        : "",
    );
    setAgentToolLoopGuardEnabled(agent.toolLoopGuard?.enabled ?? true);
    setAgentToolLoopGuardThreshold(agent.toolLoopGuard?.threshold ?? 3);
    setAgentToolLoopGuardExemptTools(
      (agent.toolLoopGuard?.exemptTools ?? []).join(", "),
    );
    setAgentRunMaxTurns(
      agent.runLimits?.maxTurns ?? DEFAULT_RUN_LIMITS.maxTurns,
    );
    setAgentRunMaxTotalTokens(
      agent.runLimits?.maxTotalTokens ?? DEFAULT_RUN_LIMITS.maxTotalTokens,
    );
    setAgentRunMaxCostUsd(
      agent.runLimits?.maxCostUsd ?? DEFAULT_RUN_LIMITS.maxCostUsd,
    );
    setAgentRunTimeoutSeconds(
      Math.round(
        (agent.runLimits?.timeoutMs ?? DEFAULT_RUN_LIMITS.timeoutMs) / 1_000,
      ),
    );
    setAgentMaxConcurrent(agent.subagentLimits?.maxConcurrent ?? 2);
    setAgentMaxTotal(agent.subagentLimits?.maxTotal ?? 4);
    setAgentMaxTurns(agent.subagentLimits?.maxTurns ?? 8);
    setAgentTimeoutSeconds(
      Math.round((agent.subagentLimits?.timeoutMs ?? 120_000) / 1_000),
    );
    setRollbackTarget(undefined);
  }, [agent.id, agent.revision]);

  useEffect(() => {
    if (agentAdvisorReviewModelKey === selectedModelKey) {
      setAgentAdvisorReviewModelKey("");
    }
  }, [agentAdvisorReviewModelKey, selectedModelKey]);

  useEffect(() => {
    let active = true;
    setHistoryLoading(true);
    void getAgentProfileRevisions(agent.id)
      .then((revisions) => {
        if (active) setAgentRevisions(revisions);
      })
      .catch((historyError: unknown) => {
        if (active) setError(toErrorMessage(historyError));
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [agent.id, agent.revision]);

  const selectCredentialProvider = (providerId: string): void => {
    const draft = applyCredentialProviderDraft({
      previousProviderId: credentialProvider,
      nextProviderId: providerId,
      label: credentialLabel,
      environmentVariable: credentialEnvVariable,
      keychainService: credentialKeychainService,
      keychainAccount: credentialKeychainAccount,
    });
    setCredentialProvider(draft.providerId);
    setCredentialLabel(draft.label);
    setCredentialEnvVariable(draft.environmentVariable);
    setCredentialKeychainService(draft.keychainService);
    setCredentialKeychainAccount(draft.keychainAccount);
  };

  useEffect(() => {
    if (providers.length > 0 && !providers.includes(credentialProvider)) {
      selectCredentialProvider(providers[0]!);
    }
  }, [credentialProvider, providers]);

  useEffect(() => {
    if (
      skillSigningAnchors.length > 0 &&
      !skillSigningAnchors.some((anchor) => anchor.id === skillTrustAnchorId)
    ) {
      setSkillTrustAnchorId(skillSigningAnchors[0]!.id);
    }
    if (skillSigningAnchors.length === 0 && skillTrustAnchorId) {
      setSkillTrustAnchorId("");
    }
  }, [skillSigningAnchors, skillTrustAnchorId]);

  useEffect(() => {
    if (
      promptSigningAnchors.length > 0 &&
      !promptSigningAnchors.some((anchor) => anchor.id === promptTrustAnchorId)
    ) {
      setPromptTrustAnchorId(promptSigningAnchors[0]!.id);
    }
    if (promptSigningAnchors.length === 0 && promptTrustAnchorId) {
      setPromptTrustAnchorId("");
    }
  }, [promptSigningAnchors, promptTrustAnchorId]);

  const refreshWorkspace = async (): Promise<void> => {
    onBootstrapUpdated(await getContextBootstrap(threadId));
  };

  const addPromptVariable = (): void => {
    setAgentPromptVariables((current) => {
      const names = new Set(current.map((definition) => definition.name));
      let suffix = 1;
      let name = "current_date";
      while (names.has(name)) {
        suffix += 1;
        name = `current_date_${suffix}`;
      }
      return [
        ...current,
        { name, type: "current_date", format: "readable-date" },
      ];
    });
  };

  const replacePromptVariable = (
    index: number,
    definition: PromptVariableDefinition,
  ): void => {
    setAgentPromptVariables((current) =>
      current.map((candidate, candidateIndex) =>
        candidateIndex === index ? definition : candidate,
      ),
    );
  };

  const removePromptVariable = (index: number): void => {
    setAgentPromptVariables((current) =>
      current.filter((_, candidateIndex) => candidateIndex !== index),
    );
  };

  const insertPromptVariable = (name: string): void => {
    if (!validPromptVariableName(name)) return;
    const token = `{{${name}}}`;
    setAgentSystemPrompt((current) =>
      current.includes(token) ? current : `${current.trimEnd()}\n\n${token}`,
    );
  };

  const saveAgent = async (): Promise<void> => {
    if (configurationBusy) return;
    if (!selectedModel.configured) {
      setError(copy.context.modelUnavailableHint);
      return;
    }
    if (!advisorReviewModelAvailable) {
      setError(copy.context.modelAdvisorReviewModelUnavailableHint);
      return;
    }
    setConfigurationBusy(true);
    setError(undefined);
    try {
      const updated = await updateAgentProfile(agent.id, {
        name: agentName,
        description: agentDescription,
        systemPrompt: agentSystemPrompt,
        model: parseModelKey(selectedModelKey),
        thinkingLevel: agentThinkingLevel,
        toolPolicy: agentToolPolicy,
        enabledTools: agentTools,
        enabledSkills: agentSkills,
        enabledSubagents: agentSubagents,
        promptVariables: agentPromptVariables,
        automaticRecovery: {
          mode: agentRecoveryMode,
          maxAttempts: agentRecoveryMaxAttempts,
          backoffMs: agentRecoveryBackoffSeconds * 1_000,
        },
        modelAdvisor: {
          mode: agentAdvisorMode,
          enabledRules: agentAdvisorRules,
          maxCorrectionAttempts: agentAdvisorCorrectionAttempts,
          ...(shouldPersistAdvisorReviewModel
            ? { reviewModel: parseModelKey(agentAdvisorReviewModelKey) }
            : {}),
        },
        toolLoopGuard: {
          enabled: agentToolLoopGuardEnabled,
          threshold: agentToolLoopGuardThreshold,
          exemptTools:
            parseToolLoopGuardExemptTools(agentToolLoopGuardExemptTools) ?? [],
        },
        runLimits: {
          maxTurns: agentRunMaxTurns,
          maxTotalTokens: agentRunMaxTotalTokens,
          maxCostUsd: agentRunMaxCostUsd,
          timeoutMs: agentRunTimeoutSeconds * 1_000,
        },
        subagentLimits: {
          maxConcurrent: agentMaxConcurrent,
          maxTotal: agentMaxTotal,
          maxTurns: agentMaxTurns,
          timeoutMs: agentTimeoutSeconds * 1_000,
        },
        threadId,
      });
      onAgentUpdated(updated);
    } catch (configurationError) {
      setError(toErrorMessage(configurationError));
    } finally {
      setConfigurationBusy(false);
    }
  };

  const confirmRollback = async (): Promise<void> => {
    if (!rollbackTarget || configurationBusy) return;
    setConfigurationBusy(true);
    setError(undefined);
    try {
      const result = await rollbackAgentProfileRevision(agent.id, {
        revision: rollbackTarget.revision,
        threadId,
      });
      onModel(`${result.agent.model.provider}/${result.agent.model.id}`);
      onAgentUpdated(result.agent);
      setAgentRevisions(await getAgentProfileRevisions(agent.id));
      setRollbackTarget(undefined);
    } catch (rollbackError) {
      setError(toErrorMessage(rollbackError));
    } finally {
      setConfigurationBusy(false);
    }
  };

  const addCredential = async (): Promise<void> => {
    if (configurationBusy) return;
    setConfigurationBusy(true);
    setError(undefined);
    try {
      if (
        credentialSourceType === "macos_keychain" &&
        credentialKeychainSecret.trim().length > 0
      ) {
        await createMacOsKeychainCredential({
          providerId: credentialProvider,
          label: credentialLabel.trim(),
          service: credentialKeychainService.trim(),
          account: credentialKeychainAccount.trim(),
          secret: credentialKeychainSecret,
          replaceExisting: credentialKeychainReplace,
          threadId,
        });
      } else {
        await createCredentialReference({
          providerId: credentialProvider,
          label: credentialLabel.trim(),
          source:
            credentialSourceType === "environment"
              ? {
                  type: "environment",
                  variable: credentialEnvVariable.trim(),
                }
              : {
                  type: "macos_keychain",
                  service: credentialKeychainService.trim(),
                  account: credentialKeychainAccount.trim(),
                },
          threadId,
        });
      }
      const draft = credentialReferenceDraft(credentialProvider);
      setCredentialLabel(draft.label);
      setCredentialEnvVariable(draft.environmentVariable);
      setCredentialKeychainService(draft.keychainService);
      setCredentialKeychainAccount(draft.keychainAccount);
      setCredentialKeychainSecret("");
      setCredentialKeychainReplace(false);
      await refreshWorkspace();
    } catch (credentialError) {
      setError(toErrorMessage(credentialError));
    } finally {
      setConfigurationBusy(false);
    }
  };

  const checkCredential = async (referenceId: string): Promise<void> => {
    setCredentialBusyId(referenceId);
    setError(undefined);
    try {
      await checkCredentialReference(referenceId, threadId);
      await refreshWorkspace();
    } catch (credentialError) {
      setError(toErrorMessage(credentialError));
    } finally {
      setCredentialBusyId(undefined);
    }
  };

  const toggleCredential = async (
    referenceId: string,
    enabled: boolean,
  ): Promise<void> => {
    setCredentialBusyId(referenceId);
    setError(undefined);
    try {
      await setCredentialReferenceStatus(referenceId, {
        status: enabled ? "active" : "disabled",
        threadId,
      });
      await refreshWorkspace();
    } catch (credentialError) {
      setError(toErrorMessage(credentialError));
    } finally {
      setCredentialBusyId(undefined);
    }
  };

  const downloadSkillPackage = async (): Promise<void> => {
    if (skillPackageBusy || !skillTrustAnchorId || agentSkills.length === 0)
      return;
    setSkillPackageBusy(true);
    setError(undefined);
    try {
      const envelope = await signSkillPackage({
        threadId,
        trustAnchorId: skillTrustAnchorId,
        publisher: skillPublisher.trim(),
        skillNames: agentSkills,
      });
      downloadJson(
        envelope,
        `napier-skills-${envelope.contentSha256.slice(0, 12)}.json`,
      );
      setSkillPackageReceipt({
        action: "signed",
        status: "signed",
        reason: copy.context.skillPackageSigned,
        envelopeSha256: envelope.contentSha256,
        manifestSha256: envelope.manifest.contentSha256,
        skillCatalogSha256: envelope.manifest.skillCatalogSha256,
        keyId: envelope.signature.keyId,
        skillCount: envelope.manifest.skills.length,
      });
      await refreshWorkspace();
    } catch (skillError) {
      setError(toErrorMessage(skillError));
    } finally {
      setSkillPackageBusy(false);
    }
  };

  const inspectSkillPackageFile = async (
    file: File,
    action: "verify" | "qualify" | "install",
  ): Promise<void> => {
    if (skillPackageBusy) return;
    if (file.size > MAX_SKILL_PACKAGE_FILE_BYTES) {
      setError(copy.context.skillPackageTooLarge);
      return;
    }
    setSkillPackageBusy(true);
    setError(undefined);
    try {
      const envelope = (await readJsonFile(file)) as SignedSkillPackageEnvelope;
      if (action === "verify") {
        const verification = await verifySkillPackage({ envelope });
        setSkillPackageReceipt({
          action: "verified",
          status: verification.status,
          reason: verification.reason,
          ...(verification.envelopeSha256
            ? { envelopeSha256: verification.envelopeSha256 }
            : {}),
          ...(verification.manifestSha256
            ? { manifestSha256: verification.manifestSha256 }
            : {}),
          ...(verification.keyId ? { keyId: verification.keyId } : {}),
          skillCount: verification.skillCount,
        });
        return;
      }
      if (action === "qualify") {
        const qualification = await qualifySkillPackage({ threadId, envelope });
        setSkillPackageReceipt({
          action: "qualified",
          status: qualification.status,
          reason: qualification.reason,
          ...(qualification.envelopeSha256
            ? { envelopeSha256: qualification.envelopeSha256 }
            : {}),
          ...(qualification.manifestSha256
            ? { manifestSha256: qualification.manifestSha256 }
            : {}),
          ...(qualification.skillCatalogSha256
            ? { skillCatalogSha256: qualification.skillCatalogSha256 }
            : {}),
          ...(qualification.observedSkillCatalogSha256
            ? {
                observedSkillCatalogSha256:
                  qualification.observedSkillCatalogSha256,
              }
            : {}),
          ...(qualification.keyId ? { keyId: qualification.keyId } : {}),
          skillCount: qualification.skillCount,
        });
        await refreshWorkspace();
        return;
      }
      const replacingActive =
        activeSkillPackageInstallation !== undefined &&
        activeSkillPackageInstallation.envelopeSha256 !==
          envelope.contentSha256;
      const publisherChanged =
        replacingActive &&
        activeSkillPackageInstallation !== undefined &&
        (activeSkillPackageInstallation.publisher !==
          envelope.manifest.publisher ||
          activeSkillPackageInstallation.keyId !== envelope.signature.keyId);
      const skillSetChanged =
        replacingActive &&
        activeSkillPackageInstallation !== undefined &&
        !sameStringSet(
          activeSkillPackageInstallation.loadedSkillNames,
          envelope.manifest.loadedSkillNames,
        );
      if (replacingActive && !skillReplacementConfirmed) {
        setError(copy.context.skillPackageReplacementRequired);
        return;
      }
      if (publisherChanged && !skillPublisherChangeConfirmed) {
        setError(copy.context.skillPackagePublisherChangeRequired);
        return;
      }
      if (skillSetChanged && !skillSetChangeConfirmed) {
        setError(copy.context.skillPackageSkillSetChangeRequired);
        return;
      }
      const result: InstallSkillPackageResult = await installSkillPackage({
        threadId,
        envelope,
        ...(replacingActive && activeSkillPackageInstallation
          ? {
              replaceInstallationId: activeSkillPackageInstallation.id,
              confirmReplacement: true,
              ...(publisherChanged ? { confirmPublisherChange: true } : {}),
              ...(skillSetChanged ? { confirmSkillSetChange: true } : {}),
            }
          : {}),
      });
      setSkillPackageReceipt({
        action: "installed",
        status: result.created ? "installed" : "matched",
        reason: result.created
          ? copy.context.skillPackageInstalled
          : copy.context.skillPackageMatched,
        envelopeSha256: result.installation.envelopeSha256,
        manifestSha256: result.installation.manifestSha256,
        skillCatalogSha256: result.installation.skillCatalogSha256,
        keyId: result.installation.keyId,
        skillCount: result.installation.loadedSkillNames.length,
        installationId: result.installation.id,
        ...(result.replacedInstallation
          ? { replacedInstallationId: result.replacedInstallation.id }
          : {}),
      });
      setSkillReplacementConfirmed(false);
      setSkillPublisherChangeConfirmed(false);
      setSkillSetChangeConfirmed(false);
      await refreshWorkspace();
    } catch (skillError) {
      setError(toErrorMessage(skillError));
    } finally {
      setSkillPackageBusy(false);
    }
  };

  const updateSkillContentText = (value: string): void => {
    setSkillContentText(value);
    setSkillContentReceipt(undefined);
    setSkillContentInstallConfirmed(false);
    setSkillContentReplacementConfirmed(false);
  };

  const loadSkillContentFile = async (file: File): Promise<void> => {
    if (skillContentBusy) return;
    if (file.size > MAX_SKILL_CONTENT_FILE_BYTES) {
      setError(copy.context.skillContentTooLarge);
      return;
    }
    setError(undefined);
    updateSkillContentText(await file.text());
  };

  const previewSkillContentDraft = async (): Promise<void> => {
    if (skillContentBusy) return;
    if (utf8Size(skillContentText) > MAX_SKILL_CONTENT_FILE_BYTES) {
      setError(copy.context.skillContentTooLarge);
      return;
    }
    setSkillContentBusy(true);
    setError(undefined);
    try {
      const review = await previewSkillContent({
        threadId,
        content: skillContentText,
      });
      setSkillContentReceipt({
        action: "previewed",
        review,
        reason: copy.context.skillContentReviewReady,
      });
      setSkillContentInstallConfirmed(false);
      setSkillContentReplacementConfirmed(false);
    } catch (skillContentError) {
      setError(toErrorMessage(skillContentError));
    } finally {
      setSkillContentBusy(false);
    }
  };

  const applySkillContentDraft = async (): Promise<void> => {
    const review = skillContentReceipt?.review;
    if (skillContentBusy) return;
    if (!review) {
      setError(copy.context.skillContentNoReview);
      return;
    }
    if (review.action === "install" && !skillContentInstallConfirmed) {
      setError(copy.context.skillContentInstallConfirmRequired);
      return;
    }
    if (review.action === "replace" && !skillContentReplacementConfirmed) {
      setError(copy.context.skillContentReplacementConfirmRequired);
      return;
    }
    setSkillContentBusy(true);
    setError(undefined);
    try {
      const result = await applySkillContent({
        threadId,
        content: skillContentText,
        expectedReviewSha256: review.reviewSha256,
        ...(review.action === "install"
          ? { confirmInstall: skillContentInstallConfirmed }
          : {}),
        ...(review.action === "replace"
          ? { confirmReplacement: skillContentReplacementConfirmed }
          : {}),
      });
      setSkillContentReceipt({
        action: "applied",
        review: result.review,
        applied: result.applied,
        reason: skillContentAppliedReason(result.review, result.applied),
      });
      setSkillContentInstallConfirmed(false);
      setSkillContentReplacementConfirmed(false);
      await refreshWorkspace();
    } catch (skillContentError) {
      setError(toErrorMessage(skillContentError));
    } finally {
      setSkillContentBusy(false);
    }
  };

  const downloadPromptPackage = async (): Promise<void> => {
    if (promptPackageBusy || !promptTrustAnchorId) return;
    setPromptPackageBusy(true);
    setError(undefined);
    try {
      const envelope = await signPromptPackage({
        threadId,
        trustAnchorId: promptTrustAnchorId,
        publisher: promptPublisher.trim(),
        agentId: agent.id,
      });
      downloadJson(
        envelope,
        `napier-prompt-${agent.id}-${envelope.contentSha256.slice(0, 12)}.json`,
      );
      setPromptPackageReceipt({
        action: "signed",
        status: "signed",
        reason: copy.context.promptPackageSigned,
        envelopeSha256: envelope.contentSha256,
        manifestSha256: envelope.manifest.contentSha256,
        systemPromptSha256: envelope.manifest.systemPromptSha256,
        keyId: envelope.signature.keyId,
        agentRevision: envelope.manifest.agentRevision,
      });
      await refreshWorkspace();
    } catch (promptError) {
      setError(toErrorMessage(promptError));
    } finally {
      setPromptPackageBusy(false);
    }
  };

  const inspectPromptPackageFile = async (
    file: File,
    action: "verify" | "qualify",
  ): Promise<void> => {
    if (promptPackageBusy) return;
    if (file.size > MAX_PROMPT_PACKAGE_FILE_BYTES) {
      setError(copy.context.promptPackageTooLarge);
      return;
    }
    setPromptPackageBusy(true);
    setError(undefined);
    try {
      const envelope = (await readJsonFile(
        file,
      )) as SignedPromptPackageEnvelope;
      if (action === "verify") {
        const verification = await verifyPromptPackage({ envelope });
        setPromptPackageReceipt({
          action: "verified",
          status: verification.status,
          reason: verification.reason,
          ...(verification.envelopeSha256
            ? { envelopeSha256: verification.envelopeSha256 }
            : {}),
          ...(verification.manifestSha256
            ? { manifestSha256: verification.manifestSha256 }
            : {}),
          ...(verification.keyId ? { keyId: verification.keyId } : {}),
        });
      } else {
        const qualification = await qualifyPromptPackage({
          threadId,
          agentId: agent.id,
          envelope,
        });
        setPromptPackageReceipt({
          action: "qualified",
          status: qualification.status,
          reason: qualification.reason,
          ...(qualification.envelopeSha256
            ? { envelopeSha256: qualification.envelopeSha256 }
            : {}),
          ...(qualification.manifestSha256
            ? { manifestSha256: qualification.manifestSha256 }
            : {}),
          ...(qualification.systemPromptSha256
            ? { systemPromptSha256: qualification.systemPromptSha256 }
            : {}),
          ...(qualification.observedSystemPromptSha256
            ? {
                observedSystemPromptSha256:
                  qualification.observedSystemPromptSha256,
              }
            : {}),
          ...(qualification.keyId ? { keyId: qualification.keyId } : {}),
          ...(qualification.observedAgentRevision
            ? { observedAgentRevision: qualification.observedAgentRevision }
            : {}),
        });
        await refreshWorkspace();
      }
    } catch (promptError) {
      setError(toErrorMessage(promptError));
    } finally {
      setPromptPackageBusy(false);
    }
  };

  const canSaveAgent =
    !configurationBusy &&
    agentName.trim().length > 0 &&
    agentDescription.trim().length > 0 &&
    agentSystemPrompt.trim().length > 0 &&
    selectedModel.configured &&
    advisorReviewModelAvailable &&
    validPromptVariables(agentPromptVariables) &&
    Number.isSafeInteger(agentToolLoopGuardThreshold) &&
    agentToolLoopGuardThreshold >= 2 &&
    agentToolLoopGuardThreshold <= 8 &&
    parseToolLoopGuardExemptTools(agentToolLoopGuardExemptTools) !== undefined;
  const profileSaveDescriptionIds = [
    !selectedModel.configured ? "context-model-unavailable" : undefined,
    !advisorReviewModelAvailable
      ? "context-advisor-review-model-unavailable"
      : undefined,
  ]
    .filter((id): id is string => Boolean(id))
    .join(" ");
  const canAddCredential =
    credentialLabel.trim().length > 0 &&
    (credentialSourceType === "environment"
      ? credentialEnvVariable.trim().length > 1
      : credentialKeychainService.trim().length > 0 &&
        credentialKeychainAccount.trim().length > 0 &&
        (credentialKeychainSecret.trim().length === 0 ||
          credentialKeychainSecret.trim().length >= 8));
  const canSignSkillPackage =
    skillPublisher.trim().length > 0 &&
    skillTrustAnchorId.length > 0 &&
    agentSkills.length > 0;
  const canSignPromptPackage =
    promptPublisher.trim().length > 0 && promptTrustAnchorId.length > 0;
  const subagentOptions: SubagentRole[] = [
    "researcher",
    "reviewer",
    "general",
    "coder",
  ];
  const toolOptions = AGENT_TOOL_NAMES;

  return (
    <section
      className="panel-section context-workbench"
      aria-labelledby="context-title"
    >
      <div className="panel-heading">
        <div>
          <span>{copy.context.eyebrow}</span>
          <h2 id="context-title">{copy.context.title}</h2>
        </div>
        <span className="context-version">
          {copy.context.revision} {agent.revision}
        </span>
      </div>
      {error ? (
        <div className="context-error" role="alert">
          {error}
        </div>
      ) : null}

      <section
        className="context-runtime-card"
        aria-labelledby="runtime-model-title"
      >
        <header>
          <div className="context-section-glyph" aria-hidden="true">
            <Sparkles size={14} />
          </div>
          <div>
            <span>{copy.context.nextRun}</span>
            <h3 id="runtime-model-title">{copy.context.runModel}</h3>
          </div>
        </header>
        <label className="context-field">
          <span>{copy.context.chooseModel}</span>
          <select
            value={selectedModelKey}
            onChange={(event) => onModel(event.target.value)}
          >
            {modelGroups.map((group) => (
              <optgroup key={group.provider} label={group.label}>
                {group.options.map((option) => (
                  <option
                    key={option.key}
                    value={option.key}
                    disabled={!option.configured}
                  >
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        {!selectedModel.configured ? (
          <p
            className="context-model-warning"
            id="context-model-unavailable"
            role="status"
          >
            {copy.context.modelUnavailableHint}
          </p>
        ) : null}
        <p>{copy.context.runModelHint}</p>
      </section>

      <form
        className="agent-config-sheet"
        aria-describedby="agent-config-note"
        onSubmit={(event) => {
          event.preventDefault();
          void saveAgent();
        }}
      >
        <header className="context-section-heading">
          <div className="context-section-glyph" aria-hidden="true">
            <BookOpen size={14} />
          </div>
          <div>
            <span>{copy.context.profileEyebrow}</span>
            <h3>{copy.context.profile}</h3>
          </div>
        </header>

        <div className="context-field-grid">
          <label className="context-field">
            <span>{copy.context.name}</span>
            <input
              required
              maxLength={80}
              value={agentName}
              disabled={configurationBusy}
              onChange={(event) => setAgentName(event.target.value)}
            />
          </label>
          <label className="context-field">
            <span>{copy.context.thinking}</span>
            <select
              value={agentThinkingLevel}
              disabled={configurationBusy}
              onChange={(event) =>
                setAgentThinkingLevel(
                  event.target.value as AgentProfile["thinkingLevel"],
                )
              }
            >
              {(["off", "minimal", "low", "medium", "high"] as const).map(
                (level) => (
                  <option key={level} value={level}>
                    {copy.context.thinkingLevels[level]}
                  </option>
                ),
              )}
            </select>
          </label>
        </div>

        <label className="context-field">
          <span>{copy.context.description}</span>
          <input
            required
            maxLength={500}
            value={agentDescription}
            disabled={configurationBusy}
            onChange={(event) => setAgentDescription(event.target.value)}
          />
        </label>

        <label className="context-field">
          <span>{copy.context.systemPrompt}</span>
          <textarea
            required
            rows={7}
            maxLength={12_000}
            value={agentSystemPrompt}
            disabled={configurationBusy}
            onChange={(event) => setAgentSystemPrompt(event.target.value)}
          />
          <small>{copy.context.systemPromptHint}</small>
        </label>

        <fieldset
          className="context-prompt-variables"
          disabled={configurationBusy}
        >
          <legend>{copy.context.promptVariables}</legend>
          <header>
            <div>
              <Sparkles size={13} aria-hidden="true" />
              <span>
                <strong>{copy.context.promptVariablesTitle}</strong>
                <small>{copy.context.promptVariablesKicker}</small>
              </span>
            </div>
            <button
              type="button"
              className="prompt-variable-add"
              disabled={agentPromptVariables.length >= 32}
              onClick={addPromptVariable}
            >
              <Plus size={11} aria-hidden="true" />
              {copy.context.promptVariableAdd}
            </button>
          </header>
          <p>{copy.context.promptVariablesBody}</p>
          {agentPromptVariables.length === 0 ? (
            <div className="prompt-variable-empty">
              {copy.context.promptVariablesEmpty}
            </div>
          ) : (
            <div className="prompt-variable-list" role="list">
              {agentPromptVariables.map((definition, index) => {
                const definitionValid = validPromptVariableDefinition(
                  definition,
                  agentPromptVariables,
                );
                return (
                  <article
                    className={`prompt-variable-row type-${definition.type}`}
                    key={index}
                    role="listitem"
                    aria-invalid={!definitionValid}
                  >
                    <header>
                      <span>
                        {copy.context.promptVariableIndex}{" "}
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <button
                        type="button"
                        className="prompt-variable-token"
                        disabled={!validPromptVariableName(definition.name)}
                        title={copy.context.promptVariableInsert}
                        onClick={() => insertPromptVariable(definition.name)}
                      >
                        <code>{`{{${definition.name || copy.context.promptVariableFallbackName}}}`}</code>
                      </button>
                      <button
                        type="button"
                        className="prompt-variable-remove"
                        aria-label={`${copy.context.promptVariableRemove}: ${definition.name}`}
                        title={copy.context.promptVariableRemove}
                        onClick={() => removePromptVariable(index)}
                      >
                        <X size={11} aria-hidden="true" />
                      </button>
                    </header>
                    <div className="prompt-variable-grid">
                      <label className="context-field">
                        <span>{copy.context.promptVariableName}</span>
                        <input
                          maxLength={64}
                          value={definition.name}
                          aria-invalid={
                            !validPromptVariableName(definition.name) ||
                            agentPromptVariables.filter(
                              (candidate) => candidate.name === definition.name,
                            ).length > 1
                          }
                          placeholder={
                            copy.context.promptVariableNamePlaceholder
                          }
                          onChange={(event) =>
                            replacePromptVariable(index, {
                              ...definition,
                              name: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="context-field">
                        <span>{copy.context.promptVariableType}</span>
                        <select
                          value={definition.type}
                          onChange={(event) => {
                            const type = event.target
                              .value as PromptVariableDefinition["type"];
                            replacePromptVariable(
                              index,
                              type === "literal"
                                ? {
                                    name: definition.name,
                                    type,
                                    value:
                                      copy.context.promptVariableLiteralDefault,
                                  }
                                : type === "current_date"
                                  ? {
                                      name: definition.name,
                                      type,
                                      format: "readable-date",
                                    }
                                  : { name: definition.name, type },
                            );
                          }}
                        >
                          <option value="literal">
                            {copy.context.promptVariableTypes.literal}
                          </option>
                          <option value="current_date">
                            {copy.context.promptVariableTypes.current_date}
                          </option>
                          <option value="skill_catalog">
                            {copy.context.promptVariableTypes.skill_catalog}
                          </option>
                        </select>
                      </label>
                      {definition.type === "literal" ? (
                        <label className="context-field prompt-variable-value">
                          <span>{copy.context.promptVariableValue}</span>
                          <textarea
                            rows={2}
                            maxLength={2_000}
                            value={definition.value}
                            aria-invalid={
                              !validPromptVariableLiteral(definition.value)
                            }
                            onChange={(event) =>
                              replacePromptVariable(index, {
                                ...definition,
                                value: event.target.value,
                              })
                            }
                          />
                        </label>
                      ) : definition.type === "current_date" ? (
                        <label className="context-field prompt-variable-value">
                          <span>{copy.context.promptVariableDateFormat}</span>
                          <select
                            value={definition.format}
                            onChange={(event) =>
                              replacePromptVariable(index, {
                                ...definition,
                                format: event.target
                                  .value as typeof definition.format,
                              })
                            }
                          >
                            <option value="readable-date">
                              {
                                copy.context.promptVariableDateFormats[
                                  "readable-date"
                                ]
                              }
                            </option>
                            <option value="iso-date">
                              {
                                copy.context.promptVariableDateFormats[
                                  "iso-date"
                                ]
                              }
                            </option>
                            <option value="local-date-time">
                              {
                                copy.context.promptVariableDateFormats[
                                  "local-date-time"
                                ]
                              }
                            </option>
                          </select>
                        </label>
                      ) : (
                        <p className="prompt-variable-skill-note">
                          {copy.context.promptVariableSkillCatalogBody}
                        </p>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {!validPromptVariables(agentPromptVariables) ? (
            <p className="prompt-variable-error" role="alert">
              {copy.context.promptVariablesInvalid}
            </p>
          ) : null}
        </fieldset>

        <AgentCapabilityPresetControl
          profile={{
            toolPolicy: agentToolPolicy,
            enabledTools: agentTools,
            enabledSkills: agentSkills,
            enabledSubagents: agentSubagents,
          }}
          disabled={configurationBusy}
          onPolicyChange={setAgentToolPolicy}
          onChange={(update) => {
            setAgentToolPolicy(update.toolPolicy);
            setAgentTools(update.enabledTools);
            setAgentSkills(update.enabledSkills);
            setAgentSubagents(update.enabledSubagents ?? []);
          }}
        />

        <fieldset
          className={`context-recovery-policy mode-${agentRecoveryMode}`}
          disabled={configurationBusy}
        >
          <legend>{copy.context.recoveryPolicy}</legend>
          <header>
            <RefreshCw size={13} aria-hidden="true" />
            <div>
              <strong>{copy.context.recoveryTitle}</strong>
              <span>{copy.context.recoveryKicker}</span>
            </div>
          </header>
          <div className="context-recovery-grid">
            <label className="context-field">
              <span>{copy.context.recoveryMode}</span>
              <select
                value={agentRecoveryMode}
                onChange={(event) =>
                  setAgentRecoveryMode(
                    event.target.value as AutomaticRecoveryMode,
                  )
                }
              >
                <option value="manual">
                  {copy.context.recoveryModes.manual}
                </option>
                <option value="safe_read_only">
                  {copy.context.recoveryModes.safe_read_only}
                </option>
              </select>
            </label>
            <NumberField
              label={copy.context.recoveryAttempts}
              value={agentRecoveryMaxAttempts}
              min={1}
              max={3}
              onChange={setAgentRecoveryMaxAttempts}
            />
            <NumberField
              label={copy.context.recoveryBackoff}
              value={agentRecoveryBackoffSeconds}
              min={1}
              max={3_600}
              onChange={setAgentRecoveryBackoffSeconds}
            />
          </div>
          <p>
            <ShieldCheck size={11} aria-hidden="true" />
            {agentRecoveryMode === "safe_read_only"
              ? copy.context.recoverySafeBody
              : copy.context.recoveryManualBody}
          </p>
        </fieldset>

        <fieldset className="context-budget-grid" disabled={configurationBusy}>
          <legend>{copy.context.modelAdvisor}</legend>
          <label className="context-field">
            <span>{copy.context.modelAdvisorMode}</span>
            <select
              value={agentAdvisorMode}
              onChange={(event) =>
                setAgentAdvisorMode(event.target.value as ModelAdvisorMode)
              }
            >
              <option value="observe">
                {copy.context.modelAdvisorModes.observe}
              </option>
              <option value="enforce">
                {copy.context.modelAdvisorModes.enforce}
              </option>
              <option value="off">{copy.context.modelAdvisorModes.off}</option>
            </select>
          </label>
          <OptionGroup
            legend={copy.context.modelAdvisorRules}
            options={MODEL_ADVISOR_RULES.map((rule) => ({
              value: rule,
              label: copy.context.modelAdvisorRuleLabels[rule],
              detail: rule,
            }))}
            selected={agentAdvisorRules}
            disabled={configurationBusy || agentAdvisorMode === "off"}
            onChange={setAgentAdvisorRules}
          />
          <NumberField
            label={copy.context.modelAdvisorCorrectionAttempts}
            value={agentAdvisorCorrectionAttempts}
            min={0}
            max={3}
            onChange={setAgentAdvisorCorrectionAttempts}
          />
          <label className="context-field">
            <span>{copy.context.modelAdvisorReviewModel}</span>
            <select
              value={agentAdvisorReviewModelKey}
              disabled={configurationBusy || agentAdvisorMode === "off"}
              onChange={(event) =>
                setAgentAdvisorReviewModelKey(event.target.value)
              }
            >
              <option value="">
                {copy.context.modelAdvisorReviewModelDisabled}
              </option>
              {modelGroups
                .filter((group) => group.provider !== "napier")
                .map((group) => (
                  <optgroup key={group.provider} label={group.label}>
                    {group.options.map((option) => (
                      <option
                        key={option.key}
                        value={option.key}
                        disabled={
                          !option.configured || option.key === selectedModelKey
                        }
                      >
                        {option.label}
                        {option.configured && option.key === selectedModelKey
                          ? ` · ${copy.context.modelAdvisorReviewModelPrimary}`
                          : ""}
                      </option>
                    ))}
                  </optgroup>
                ))}
            </select>
          </label>
          {!advisorReviewModelAvailable ? (
            <p
              className="context-model-warning"
              id="context-advisor-review-model-unavailable"
              role="status"
            >
              {copy.context.modelAdvisorReviewModelUnavailableHint}
            </p>
          ) : null}
          <p className="guardrail-note">
            <ShieldCheck size={11} aria-hidden="true" />
            {copy.context.modelAdvisorBody}
          </p>
        </fieldset>

        <fieldset
          className={`context-tool-loop-guard ${
            agentToolLoopGuardEnabled ? "is-enabled" : "is-disabled"
          }`}
          disabled={configurationBusy}
        >
          <legend>{copy.context.toolLoopGuard}</legend>
          <header>
            <RotateCcw size={13} aria-hidden="true" />
            <div>
              <strong>{copy.context.toolLoopGuardTitle}</strong>
              <span>{copy.context.toolLoopGuardKicker}</span>
            </div>
            <label className="context-loop-toggle">
              <input
                type="checkbox"
                checked={agentToolLoopGuardEnabled}
                onChange={(event) =>
                  setAgentToolLoopGuardEnabled(event.target.checked)
                }
              />
              <span>
                {agentToolLoopGuardEnabled
                  ? copy.context.toolLoopGuardEnabled
                  : copy.context.toolLoopGuardDisabled}
              </span>
            </label>
          </header>
          <div className="context-loop-grid">
            <NumberField
              label={copy.context.toolLoopGuardThreshold}
              value={agentToolLoopGuardThreshold}
              min={2}
              max={8}
              onChange={setAgentToolLoopGuardThreshold}
            />
            <label className="context-field">
              <span>{copy.context.toolLoopGuardExemptTools}</span>
              <input
                value={agentToolLoopGuardExemptTools}
                maxLength={4_159}
                aria-invalid={
                  parseToolLoopGuardExemptTools(
                    agentToolLoopGuardExemptTools,
                  ) === undefined
                }
                placeholder={copy.context.toolLoopGuardExemptPlaceholder}
                onChange={(event) =>
                  setAgentToolLoopGuardExemptTools(event.target.value)
                }
              />
            </label>
          </div>
          <p>
            <ShieldCheck size={11} aria-hidden="true" />
            {copy.context.toolLoopGuardBody}
          </p>
          {parseToolLoopGuardExemptTools(agentToolLoopGuardExemptTools) ===
          undefined ? (
            <p className="context-loop-error" role="alert">
              {copy.context.toolLoopGuardInvalid}
            </p>
          ) : null}
        </fieldset>

        <OptionGroup
          legend={copy.context.tools}
          options={toolOptions.map((tool) => ({
            value: tool,
            label: copy.context.toolLabels[tool],
            detail: tool,
          }))}
          selected={agentTools}
          disabled={configurationBusy}
          onChange={setAgentTools}
        />
        <OptionGroup
          legend={copy.context.skills}
          options={skills.map((skill) => ({
            value: skill,
            label: skill,
            detail: copy.context.bundledSkill,
          }))}
          selected={agentSkills}
          disabled={configurationBusy}
          onChange={setAgentSkills}
        />
        <OptionGroup
          legend={copy.context.subagents}
          options={subagentOptions.map((role) => ({
            value: role,
            label: copy.context.subagentLabels[role],
            detail: role,
          }))}
          selected={agentSubagents}
          disabled={configurationBusy}
          onChange={setAgentSubagents}
        />

        <fieldset className="context-budget-grid" disabled={configurationBusy}>
          <legend>{copy.context.runBudget}</legend>
          <NumberField
            label={copy.context.runMaxTurns}
            value={agentRunMaxTurns}
            min={1}
            max={128}
            onChange={setAgentRunMaxTurns}
          />
          <NumberField
            label={copy.context.runMaxTokens}
            value={agentRunMaxTotalTokens}
            min={1_000}
            max={10_000_000}
            onChange={setAgentRunMaxTotalTokens}
          />
          <NumberField
            label={copy.context.runMaxCost}
            value={agentRunMaxCostUsd}
            min={0.01}
            max={1_000}
            step={0.01}
            onChange={setAgentRunMaxCostUsd}
          />
          <NumberField
            label={copy.context.runTimeout}
            value={agentRunTimeoutSeconds}
            min={10}
            max={3_600}
            onChange={setAgentRunTimeoutSeconds}
          />
        </fieldset>

        <fieldset
          className="context-budget-grid"
          disabled={configurationBusy || agentSubagents.length === 0}
        >
          <legend>{copy.context.delegationBudget}</legend>
          <NumberField
            label={copy.context.maxConcurrent}
            value={agentMaxConcurrent}
            min={1}
            max={8}
            onChange={setAgentMaxConcurrent}
          />
          <NumberField
            label={copy.context.maxTotal}
            value={agentMaxTotal}
            min={1}
            max={24}
            onChange={setAgentMaxTotal}
          />
          <NumberField
            label={copy.context.maxTurns}
            value={agentMaxTurns}
            min={1}
            max={32}
            onChange={setAgentMaxTurns}
          />
          <NumberField
            label={copy.context.timeout}
            value={agentTimeoutSeconds}
            min={1}
            max={900}
            onChange={setAgentTimeoutSeconds}
          />
        </fieldset>

        <button
          className="primary-wide context-save"
          type="submit"
          disabled={configurationBusy || !canSaveAgent}
          aria-describedby={profileSaveDescriptionIds || undefined}
        >
          <Save size={13} aria-hidden="true" />
          {configurationBusy ? copy.context.saving : copy.context.saveProfile}
        </button>
        <p className="context-form-note" id="agent-config-note">
          <ShieldCheck size={12} aria-hidden="true" />
          {copy.context.profileSafety}
        </p>
      </form>

      <AgentRevisionHistory
        current={agent}
        revisions={agentRevisions}
        loading={historyLoading}
        busy={configurationBusy}
        rollbackTarget={rollbackTarget}
        onReviewRollback={setRollbackTarget}
        onCancelRollback={() => setRollbackTarget(undefined)}
        onConfirmRollback={() => void confirmRollback()}
      />

      <SkillPackageDesk
        enabledSkills={agentSkills}
        anchors={skillSigningAnchors}
        activeInstallation={activeSkillPackageInstallation}
        publisher={skillPublisher}
        selectedAnchorId={skillTrustAnchorId}
        busy={skillPackageBusy}
        canSign={canSignSkillPackage}
        replacementConfirmed={skillReplacementConfirmed}
        publisherChangeConfirmed={skillPublisherChangeConfirmed}
        skillSetChangeConfirmed={skillSetChangeConfirmed}
        receipt={skillPackageReceipt}
        onPublisher={setSkillPublisher}
        onAnchor={setSkillTrustAnchorId}
        onReplacementConfirmed={setSkillReplacementConfirmed}
        onPublisherChangeConfirmed={setSkillPublisherChangeConfirmed}
        onSkillSetChangeConfirmed={setSkillSetChangeConfirmed}
        onSign={() => void downloadSkillPackage()}
        onInspectFile={(file, action) =>
          void inspectSkillPackageFile(file, action)
        }
      />

      <SkillContentDesk
        content={skillContentText}
        busy={skillContentBusy}
        receipt={skillContentReceipt}
        installConfirmed={skillContentInstallConfirmed}
        replacementConfirmed={skillContentReplacementConfirmed}
        onContent={updateSkillContentText}
        onLoadFile={(file) => void loadSkillContentFile(file)}
        onPreview={() => void previewSkillContentDraft()}
        onApply={() => void applySkillContentDraft()}
        onInstallConfirmed={setSkillContentInstallConfirmed}
        onReplacementConfirmed={setSkillContentReplacementConfirmed}
      />

      <PromptPackageDesk
        agent={agent}
        anchors={promptSigningAnchors}
        publisher={promptPublisher}
        selectedAnchorId={promptTrustAnchorId}
        busy={promptPackageBusy}
        canSign={canSignPromptPackage}
        receipt={promptPackageReceipt}
        onPublisher={setPromptPublisher}
        onAnchor={setPromptTrustAnchorId}
        onSign={() => void downloadPromptPackage()}
        onInspectFile={(file, action) =>
          void inspectPromptPackageFile(file, action)
        }
      />

      <section
        className="credential-register"
        aria-labelledby="credential-register-title"
      >
        <header className="context-section-heading">
          <div className="context-section-glyph" aria-hidden="true">
            <KeyRound size={14} />
          </div>
          <div>
            <span>{copy.context.credentialsEyebrow}</span>
            <h3 id="credential-register-title">{copy.context.credentials}</h3>
          </div>
          <span className="credential-count">
            {credentials.length.toString().padStart(2, "0")}
          </span>
        </header>

        <form
          className="credential-compose"
          onSubmit={(event) => {
            event.preventDefault();
            void addCredential();
          }}
        >
          <div className="context-field-grid">
            <label className="context-field">
              <span>{copy.context.provider}</span>
              <select
                value={credentialProvider}
                disabled={configurationBusy}
                onChange={(event) =>
                  selectCredentialProvider(event.target.value)
                }
              >
                {providers.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
            </label>
            <label className="context-field">
              <span>{copy.context.source}</span>
              <select
                value={credentialSourceType}
                disabled={configurationBusy}
                onChange={(event) =>
                  setCredentialSourceType(
                    event.target.value as CredentialReferenceSource["type"],
                  )
                }
              >
                <option value="environment">{copy.context.environment}</option>
                <option value="macos_keychain">{copy.context.keychain}</option>
              </select>
            </label>
          </div>

          <label className="context-field">
            <span>{copy.context.referenceLabel}</span>
            <input
              required
              maxLength={100}
              value={credentialLabel}
              placeholder={copy.context.referenceLabelPlaceholder}
              disabled={configurationBusy}
              onChange={(event) => setCredentialLabel(event.target.value)}
            />
          </label>

          {credentialSourceType === "environment" ? (
            <label className="context-field">
              <span>{copy.context.environmentVariable}</span>
              <input
                required
                spellCheck={false}
                autoCapitalize="characters"
                pattern="[A-Z_][A-Z0-9_]{1,127}"
                value={credentialEnvVariable}
                placeholder={copy.context.environmentVariablePlaceholder}
                disabled={configurationBusy}
                onChange={(event) =>
                  setCredentialEnvVariable(event.target.value.toUpperCase())
                }
              />
            </label>
          ) : (
            <>
              <div className="context-field-grid">
                <label className="context-field">
                  <span>{copy.context.keychainService}</span>
                  <input
                    required
                    maxLength={200}
                    value={credentialKeychainService}
                    placeholder={copy.context.keychainServicePlaceholder}
                    disabled={configurationBusy}
                    onChange={(event) =>
                      setCredentialKeychainService(event.target.value)
                    }
                  />
                </label>
                <label className="context-field">
                  <span>{copy.context.keychainAccount}</span>
                  <input
                    required
                    maxLength={200}
                    value={credentialKeychainAccount}
                    placeholder={copy.context.keychainAccountPlaceholder}
                    disabled={configurationBusy}
                    onChange={(event) =>
                      setCredentialKeychainAccount(event.target.value)
                    }
                  />
                </label>
              </div>
              <label className="context-field">
                <span>{copy.context.keychainSecret}</span>
                <input
                  type="password"
                  minLength={8}
                  maxLength={4096}
                  value={credentialKeychainSecret}
                  placeholder={copy.context.keychainSecretPlaceholder}
                  disabled={configurationBusy}
                  autoComplete="new-password"
                  onChange={(event) =>
                    setCredentialKeychainSecret(event.target.value)
                  }
                />
              </label>
              <label className="credential-vault-check">
                <input
                  type="checkbox"
                  checked={credentialKeychainReplace}
                  disabled={configurationBusy}
                  onChange={(event) =>
                    setCredentialKeychainReplace(event.target.checked)
                  }
                />
                <span>{copy.context.keychainReplace}</span>
              </label>
            </>
          )}

          <button
            className="credential-add"
            type="submit"
            disabled={configurationBusy || !canAddCredential}
          >
            <Plus size={12} aria-hidden="true" />
            {copy.context.addReference}
          </button>
          <p className="credential-safety">
            <ShieldCheck size={12} aria-hidden="true" />
            {copy.context.credentialSafety}
          </p>
        </form>

        {credentials.length === 0 ? (
          <p className="empty-panel">{copy.context.noCredentials}</p>
        ) : (
          <div className="credential-list">
            {credentials.map((reference) => (
              <CredentialCard
                key={reference.id}
                reference={reference}
                busy={credentialBusyId === reference.id}
                onCheck={(referenceId) => void checkCredential(referenceId)}
                onToggle={(referenceId, enabled) =>
                  void toggleCredential(referenceId, enabled)
                }
              />
            ))}
          </div>
        )}
      </section>

      <dl className="context-ledger">
        <ContextRow
          icon={<Database size={15} />}
          label={copy.context.workspace}
        >
          <code>{workspace}</code>
        </ContextRow>
      </dl>
      <UsagePriceTableCard catalog={usagePriceTableCatalog} />
      {checkpoint ? (
        <ContextCheckpointCard
          checkpoint={checkpoint}
          {...(checkpointCalibration
            ? { calibration: checkpointCalibration }
            : {})}
        />
      ) : null}
      <p className="guardrail-note context-guardrail">
        <ShieldCheck size={13} aria-hidden="true" />
        {copy.context.checkpointSafety}
      </p>
    </section>
  );
}

function AgentRevisionHistory({
  current,
  revisions,
  loading,
  busy,
  rollbackTarget,
  onReviewRollback,
  onCancelRollback,
  onConfirmRollback,
}: {
  current: AgentProfile;
  revisions: AgentProfileRevision[];
  loading: boolean;
  busy: boolean;
  rollbackTarget: AgentProfileRevision | undefined;
  onReviewRollback: (revision: AgentProfileRevision) => void;
  onCancelRollback: () => void;
  onConfirmRollback: () => void;
}) {
  const rollbackFields = rollbackTarget
    ? agentProfileDelta(current, rollbackTarget.profile)
    : [];
  return (
    <section
      className="agent-history-register"
      aria-labelledby="agent-history-title"
    >
      <header className="context-section-heading">
        <div className="context-section-glyph" aria-hidden="true">
          <History size={14} />
        </div>
        <div>
          <span>{copy.context.historyEyebrow}</span>
          <h3 id="agent-history-title">{copy.context.history}</h3>
        </div>
        <span className="credential-count">
          {revisions.length.toString().padStart(2, "0")}
        </span>
      </header>
      <p className="agent-history-intro">{copy.context.historyBody}</p>

      {rollbackTarget ? (
        <aside
          className="agent-rollback-ticket"
          aria-labelledby="agent-rollback-title"
        >
          <header>
            <div>
              <span>{copy.context.rollbackTarget}</span>
              <h4 id="agent-rollback-title">{copy.context.rollbackTitle}</h4>
            </div>
            <button
              type="button"
              disabled={busy}
              aria-label={copy.context.cancelRollback}
              onClick={onCancelRollback}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </header>
          <p>{copy.context.rollbackBody}</p>
          <dl>
            <div>
              <dt>{copy.context.rollbackTarget}</dt>
              <dd>
                {copy.context.revision} {rollbackTarget.revision}
              </dd>
            </div>
            <div>
              <dt>{copy.context.rollbackResult}</dt>
              <dd>
                {copy.context.revision} {current.revision + 1}
              </dd>
            </div>
          </dl>
          <div className="agent-rollback-fields">
            <span>{copy.context.rollbackChanges}</span>
            {rollbackFields.length > 0 ? (
              <ul>
                {rollbackFields.map((field) => (
                  <li key={field}>{copy.context.profileFields[field]}</li>
                ))}
              </ul>
            ) : (
              <small>{copy.context.rollbackMatches}</small>
            )}
          </div>
          <code title={rollbackTarget.contentSha256}>
            {copy.context.profileDigest}{" "}
            {rollbackTarget.contentSha256.slice(0, 12)}
          </code>
          <div className="agent-rollback-actions">
            <button type="button" disabled={busy} onClick={onCancelRollback}>
              {copy.context.cancelRollback}
            </button>
            <button
              className="agent-rollback-confirm"
              type="button"
              disabled={busy || rollbackFields.length === 0}
              onClick={onConfirmRollback}
            >
              <RotateCcw size={11} aria-hidden="true" />
              {busy ? copy.context.rollingBack : copy.context.confirmRollback}
            </button>
          </div>
        </aside>
      ) : null}

      {loading ? (
        <p className="empty-panel" role="status">
          {copy.context.historyLoading}
        </p>
      ) : (
        <div className="agent-revision-list">
          {revisions.map((revision) => {
            const isCurrent = revision.revision === current.revision;
            const restoreFields = agentProfileDelta(current, revision.profile);
            return (
              <article
                key={revision.revision}
                className={`agent-revision-card${isCurrent ? " is-current" : ""}`}
              >
                <header>
                  <div>
                    <span>
                      {copy.context.revision} {revision.revision}
                    </span>
                    <h4>{revision.profile.name}</h4>
                  </div>
                  <strong>
                    {isCurrent
                      ? copy.context.currentRevision
                      : copy.context.revisionSources[revision.source]}
                  </strong>
                </header>
                <dl>
                  <div>
                    <dt>{copy.context.chooseModel}</dt>
                    <dd>
                      {revision.profile.model.provider}/
                      {revision.profile.model.id}
                    </dd>
                  </div>
                  <div>
                    <dt>{copy.context.policy}</dt>
                    <dd>
                      {copy.context.policies[revision.profile.toolPolicy]}
                    </dd>
                  </div>
                </dl>
                <p className="agent-revision-recovery">
                  {copy.context.recoveryShort} ·{" "}
                  {
                    copy.context.recoveryModes[
                      revision.profile.automaticRecovery?.mode ?? "manual"
                    ]
                  }
                </p>
                <div className="agent-revision-fields">
                  {revision.changedFields.length > 0 ? (
                    revision.changedFields.map((field) => (
                      <span key={field}>
                        {copy.context.profileFields[field]}
                      </span>
                    ))
                  ) : (
                    <span>{copy.context.legacyBaseline}</span>
                  )}
                </div>
                {revision.restoredFromRevision !== undefined ? (
                  <p>
                    {copy.context.restoredFrom} {copy.context.revision}{" "}
                    {revision.restoredFromRevision}
                  </p>
                ) : null}
                <div className="agent-revision-evidence">
                  <code title={revision.contentSha256}>
                    {copy.context.profileDigest}{" "}
                    {revision.contentSha256.slice(0, 12)}
                  </code>
                  <code title={revision.systemPromptSha256}>
                    {copy.context.promptDigest}{" "}
                    {revision.systemPromptSha256.slice(0, 12)}
                  </code>
                  <time dateTime={revision.createdAt}>
                    {formatDateTime(revision.createdAt)}
                  </time>
                </div>
                <button
                  type="button"
                  disabled={busy || isCurrent || restoreFields.length === 0}
                  onClick={() => onReviewRollback(revision)}
                >
                  <RotateCcw size={11} aria-hidden="true" />
                  {copy.context.reviewRollback}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function SkillContentDesk({
  content,
  busy,
  receipt,
  installConfirmed,
  replacementConfirmed,
  onContent,
  onLoadFile,
  onPreview,
  onApply,
  onInstallConfirmed,
  onReplacementConfirmed,
}: {
  content: string;
  busy: boolean;
  receipt: SkillContentReceipt | undefined;
  installConfirmed: boolean;
  replacementConfirmed: boolean;
  onContent: (value: string) => void;
  onLoadFile: (file: File) => void;
  onPreview: () => void;
  onApply: () => void;
  onInstallConfirmed: (value: boolean) => void;
  onReplacementConfirmed: (value: boolean) => void;
}) {
  const review = receipt?.review;
  const needsInstallConfirmation = review?.action === "install";
  const needsReplacementConfirmation = review?.action === "replace";
  const canApply =
    Boolean(review) &&
    !busy &&
    (!needsInstallConfirmation || installConfirmed) &&
    (!needsReplacementConfirmation || replacementConfirmed);

  return (
    <section
      className="prompt-package-desk skill-content-desk"
      aria-labelledby="skill-content-title"
    >
      <header className="context-section-heading">
        <div className="context-section-glyph" aria-hidden="true">
          <FileCheck size={14} />
        </div>
        <div>
          <span>{copy.context.skillContentEyebrow}</span>
          <h3 id="skill-content-title">{copy.context.skillContent}</h3>
        </div>
        {review ? (
          <code title={review.reviewSha256}>
            {copy.context.skillContentActions[review.action]}
          </code>
        ) : null}
      </header>
      <p className="prompt-package-body">{copy.context.skillContentBody}</p>

      <label className="context-field skill-content-editor">
        <span>{copy.context.skillContentText}</span>
        <textarea
          rows={8}
          value={content}
          disabled={busy}
          placeholder={copy.context.skillContentPlaceholder}
          onChange={(event) => onContent(event.target.value)}
        />
      </label>

      <div className="prompt-package-actions skill-content-actions">
        <label
          className="prompt-package-file-action"
          aria-disabled={busy ? "true" : "false"}
        >
          <input
            type="file"
            accept=".md,text/markdown,text/plain"
            disabled={busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) onLoadFile(file);
            }}
          />
          <FileCheck size={12} aria-hidden="true" />
          {copy.context.skillContentFile}
        </label>
        <button
          type="button"
          disabled={busy || content.trim().length === 0}
          onClick={onPreview}
        >
          <ShieldCheck size={12} aria-hidden="true" />
          {busy
            ? copy.context.skillContentWorking
            : copy.context.skillContentPreview}
        </button>
        <button type="button" disabled={!canApply} onClick={onApply}>
          <Save size={12} aria-hidden="true" />
          {copy.context.skillContentApply}
        </button>
      </div>

      {needsInstallConfirmation ? (
        <label className="skill-package-replace skill-content-confirm">
          <input
            type="checkbox"
            checked={installConfirmed}
            disabled={busy}
            onChange={(event) => onInstallConfirmed(event.target.checked)}
          />
          <span>{copy.context.skillContentConfirmInstall}</span>
        </label>
      ) : null}
      {needsReplacementConfirmation ? (
        <label className="skill-package-replace skill-content-confirm">
          <input
            type="checkbox"
            checked={replacementConfirmed}
            disabled={busy}
            onChange={(event) => onReplacementConfirmed(event.target.checked)}
          />
          <span>{copy.context.skillContentConfirmReplacement}</span>
        </label>
      ) : null}

      {receipt ? <SkillContentReceiptCard receipt={receipt} /> : null}
    </section>
  );
}

function SkillContentReceiptCard({
  receipt,
}: {
  receipt: SkillContentReceipt;
}) {
  const review = receipt.review;
  const currentSizeBytes = review.currentSizeBytes;
  const currentLineCount = review.currentLineCount;
  const byteDelta =
    currentSizeBytes === undefined
      ? review.sizeBytes
      : review.sizeBytes - currentSizeBytes;
  const lineDelta =
    currentLineCount === undefined
      ? review.lineCount
      : review.lineCount - currentLineCount;
  return (
    <article
      className={`prompt-package-receipt skill-content-receipt status-${review.action}`}
    >
      <header>
        <span>{copy.context.skillContentReceiptActions[receipt.action]}</span>
        <strong>{copy.context.skillContentActions[review.action]}</strong>
      </header>
      <p>{receipt.reason}</p>
      <div className="skill-content-diff-strip">
        <span>
          {copy.context.skillContentCurrentFootprint}
          <strong>
            {currentSizeBytes === undefined
              ? copy.context.skillContentNewFile
              : `${formatCount(currentSizeBytes)} / ${formatCount(currentLineCount ?? 0)}`}
          </strong>
        </span>
        <span>
          {copy.context.skillContentCandidateFootprint}
          <strong>
            {formatCount(review.sizeBytes)} / {formatCount(review.lineCount)}
          </strong>
        </span>
        <span>
          {copy.context.skillContentDelta}
          <strong>
            {formatSignedDelta(byteDelta)} / {formatSignedDelta(lineDelta)}
          </strong>
        </span>
      </div>
      <dl>
        <div>
          <dt>{copy.context.skillContentSkill}</dt>
          <dd>{review.skillName}</dd>
        </div>
        <div>
          <dt>{copy.context.skillContentPath}</dt>
          <dd>
            <code title={review.relativePath}>{review.relativePath}</code>
          </dd>
        </div>
        <div>
          <dt>{copy.context.skillContentBytes}</dt>
          <dd>{review.sizeBytes}</dd>
        </div>
        <div>
          <dt>{copy.context.skillContentLines}</dt>
          <dd>{review.lineCount}</dd>
        </div>
        {"applied" in receipt ? (
          <div>
            <dt>{copy.context.skillContentAppliedState}</dt>
            <dd>
              {receipt.applied
                ? copy.context.skillContentAppliedYes
                : copy.context.skillContentAppliedNo}
            </dd>
          </div>
        ) : null}
        <HashRow
          label={copy.context.skillContentReviewHash}
          value={review.reviewSha256}
        />
        <HashRow
          label={copy.context.skillContentCandidateHash}
          value={review.contentSha256}
        />
        <HashRow
          label={copy.context.skillContentFrontmatterHash}
          value={review.frontmatterSha256}
        />
        <HashRow
          label={copy.context.skillContentBodyHash}
          value={review.bodySha256}
        />
        {review.currentContentSha256 ? (
          <HashRow
            label={copy.context.skillContentCurrentHash}
            value={review.currentContentSha256}
          />
        ) : null}
        {review.currentSizeBytes !== undefined ? (
          <div>
            <dt>{copy.context.skillContentByteDelta}</dt>
            <dd>{formatSignedDelta(byteDelta)}</dd>
          </div>
        ) : null}
        {review.currentLineCount !== undefined ? (
          <div>
            <dt>{copy.context.skillContentLineDelta}</dt>
            <dd>{formatSignedDelta(lineDelta)}</dd>
          </div>
        ) : null}
      </dl>
    </article>
  );
}

function SkillPackageDesk({
  enabledSkills,
  anchors,
  activeInstallation,
  publisher,
  selectedAnchorId,
  busy,
  canSign,
  replacementConfirmed,
  publisherChangeConfirmed,
  skillSetChangeConfirmed,
  receipt,
  onPublisher,
  onAnchor,
  onReplacementConfirmed,
  onPublisherChangeConfirmed,
  onSkillSetChangeConfirmed,
  onSign,
  onInspectFile,
}: {
  enabledSkills: string[];
  anchors: ExtensionPublisherTrustAnchor[];
  activeInstallation: SkillPackageInstallation | undefined;
  publisher: string;
  selectedAnchorId: string;
  busy: boolean;
  canSign: boolean;
  replacementConfirmed: boolean;
  publisherChangeConfirmed: boolean;
  skillSetChangeConfirmed: boolean;
  receipt: SkillPackageReceipt | undefined;
  onPublisher: (value: string) => void;
  onAnchor: (value: string) => void;
  onReplacementConfirmed: (value: boolean) => void;
  onPublisherChangeConfirmed: (value: boolean) => void;
  onSkillSetChangeConfirmed: (value: boolean) => void;
  onSign: () => void;
  onInspectFile: (file: File, action: "verify" | "qualify" | "install") => void;
}) {
  return (
    <section
      className="prompt-package-desk skill-package-desk"
      aria-labelledby="skill-package-title"
    >
      <header className="context-section-heading">
        <div className="context-section-glyph" aria-hidden="true">
          <ShieldCheck size={14} />
        </div>
        <div>
          <span>{copy.context.skillPackageEyebrow}</span>
          <h3 id="skill-package-title">{copy.context.skillPackage}</h3>
        </div>
        <code>{enabledSkills.length}</code>
      </header>
      <p className="prompt-package-body">{copy.context.skillPackageBody}</p>

      {activeInstallation ? (
        <div className="skill-package-active">
          <span>{copy.context.skillPackageActive}</span>
          <code title={activeInstallation.skillCatalogSha256}>
            {activeInstallation.skillCatalogSha256.slice(0, 12)}
          </code>
          <small>{activeInstallation.loadedSkillNames.join(", ")}</small>
        </div>
      ) : null}

      <div className="prompt-package-grid">
        <label className="context-field">
          <span>{copy.context.skillPackagePublisher}</span>
          <input
            maxLength={120}
            value={publisher}
            disabled={busy}
            onChange={(event) => onPublisher(event.target.value)}
          />
        </label>
        <label className="context-field">
          <span>{copy.context.skillPackageSigner}</span>
          <select
            value={selectedAnchorId}
            disabled={busy || anchors.length === 0}
            onChange={(event) => onAnchor(event.target.value)}
          >
            {anchors.length === 0 ? (
              <option value="">{copy.context.skillPackageNoSigner}</option>
            ) : (
              anchors.map((anchor) => (
                <option key={anchor.id} value={anchor.id}>
                  {anchor.label} · {anchor.keyId.slice(0, 10)}
                </option>
              ))
            )}
          </select>
        </label>
      </div>

      <div className="prompt-package-actions skill-package-actions">
        <button type="button" disabled={busy || !canSign} onClick={onSign}>
          <Save size={12} aria-hidden="true" />
          {busy ? copy.context.skillPackageWorking : copy.context.skillSign}
        </button>
        <label
          className="prompt-package-file-action"
          aria-disabled={busy ? "true" : "false"}
        >
          <input
            type="file"
            accept="application/json,.json"
            disabled={busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) onInspectFile(file, "verify");
            }}
          />
          <ShieldCheck size={12} aria-hidden="true" />
          {copy.context.skillVerify}
        </label>
        <label
          className="prompt-package-file-action"
          aria-disabled={busy ? "true" : "false"}
        >
          <input
            type="file"
            accept="application/json,.json"
            disabled={busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) onInspectFile(file, "qualify");
            }}
          />
          <FileCheck size={12} aria-hidden="true" />
          {copy.context.skillQualify}
        </label>
        <label
          className="prompt-package-file-action"
          aria-disabled={busy ? "true" : "false"}
        >
          <input
            type="file"
            accept="application/json,.json"
            disabled={busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) onInspectFile(file, "install");
            }}
          />
          <FileCheck size={12} aria-hidden="true" />
          {copy.context.skillInstall}
        </label>
      </div>

      {activeInstallation ? (
        <div className="skill-package-risk-confirmations">
          <label className="skill-package-replace">
            <input
              type="checkbox"
              checked={replacementConfirmed}
              disabled={busy}
              onChange={(event) => onReplacementConfirmed(event.target.checked)}
            />
            <span>{copy.context.skillPackageReplaceConfirm}</span>
          </label>
          <label className="skill-package-replace">
            <input
              type="checkbox"
              checked={publisherChangeConfirmed}
              disabled={busy}
              onChange={(event) =>
                onPublisherChangeConfirmed(event.target.checked)
              }
            />
            <span>{copy.context.skillPackagePublisherChangeConfirm}</span>
          </label>
          <label className="skill-package-replace">
            <input
              type="checkbox"
              checked={skillSetChangeConfirmed}
              disabled={busy}
              onChange={(event) =>
                onSkillSetChangeConfirmed(event.target.checked)
              }
            />
            <span>{copy.context.skillPackageSkillSetChangeConfirm}</span>
          </label>
        </div>
      ) : null}
      {anchors.length === 0 ? (
        <p className="prompt-package-note">
          <ShieldCheck size={11} aria-hidden="true" />
          {copy.context.skillPackageSignerHint}
        </p>
      ) : null}
      {receipt ? <SkillPackageReceiptCard receipt={receipt} /> : null}
    </section>
  );
}

function SkillPackageReceiptCard({
  receipt,
}: {
  receipt: SkillPackageReceipt;
}) {
  return (
    <article className={`prompt-package-receipt status-${receipt.status}`}>
      <header>
        <span>{copy.context.skillPackageReceiptActions[receipt.action]}</span>
        <strong>{copy.context.skillPackageStatuses[receipt.status]}</strong>
      </header>
      <p>{receipt.reason}</p>
      <dl>
        {receipt.manifestSha256 ? (
          <HashRow
            label={copy.context.skillPackageManifestHash}
            value={receipt.manifestSha256}
          />
        ) : null}
        {receipt.envelopeSha256 ? (
          <HashRow
            label={copy.context.skillPackageEnvelopeHash}
            value={receipt.envelopeSha256}
          />
        ) : null}
        {"skillCatalogSha256" in receipt && receipt.skillCatalogSha256 ? (
          <HashRow
            label={copy.context.skillPackageCatalogHash}
            value={receipt.skillCatalogSha256}
          />
        ) : null}
        {"observedSkillCatalogSha256" in receipt &&
        receipt.observedSkillCatalogSha256 ? (
          <HashRow
            label={copy.context.skillPackageObservedCatalogHash}
            value={receipt.observedSkillCatalogSha256}
          />
        ) : null}
        {receipt.keyId ? (
          <HashRow label={copy.context.skillPackageKey} value={receipt.keyId} />
        ) : null}
        <div>
          <dt>{copy.context.skillPackageCount}</dt>
          <dd>{receipt.skillCount}</dd>
        </div>
        {"installationId" in receipt ? (
          <HashRow
            label={copy.context.skillPackageInstallation}
            value={receipt.installationId}
          />
        ) : null}
        {"replacedInstallationId" in receipt &&
        receipt.replacedInstallationId ? (
          <HashRow
            label={copy.context.skillPackageReplaced}
            value={receipt.replacedInstallationId}
          />
        ) : null}
      </dl>
    </article>
  );
}

function PromptPackageDesk({
  agent,
  anchors,
  publisher,
  selectedAnchorId,
  busy,
  canSign,
  receipt,
  onPublisher,
  onAnchor,
  onSign,
  onInspectFile,
}: {
  agent: AgentProfile;
  anchors: ExtensionPublisherTrustAnchor[];
  publisher: string;
  selectedAnchorId: string;
  busy: boolean;
  canSign: boolean;
  receipt: PromptPackageReceipt | undefined;
  onPublisher: (value: string) => void;
  onAnchor: (value: string) => void;
  onSign: () => void;
  onInspectFile: (file: File, action: "verify" | "qualify") => void;
}) {
  return (
    <section
      className="prompt-package-desk"
      aria-labelledby="prompt-package-title"
    >
      <header className="context-section-heading">
        <div className="context-section-glyph" aria-hidden="true">
          <FileCheck size={14} />
        </div>
        <div>
          <span>{copy.context.promptPackageEyebrow}</span>
          <h3 id="prompt-package-title">{copy.context.promptPackage}</h3>
        </div>
        <code title={agent.id}>
          {copy.context.revision} {agent.revision}
        </code>
      </header>
      <p className="prompt-package-body">{copy.context.promptPackageBody}</p>

      <div className="prompt-package-grid">
        <label className="context-field">
          <span>{copy.context.promptPackagePublisher}</span>
          <input
            maxLength={120}
            value={publisher}
            disabled={busy}
            onChange={(event) => onPublisher(event.target.value)}
          />
        </label>
        <label className="context-field">
          <span>{copy.context.promptPackageSigner}</span>
          <select
            value={selectedAnchorId}
            disabled={busy || anchors.length === 0}
            onChange={(event) => onAnchor(event.target.value)}
          >
            {anchors.length === 0 ? (
              <option value="">{copy.context.promptPackageNoSigner}</option>
            ) : (
              anchors.map((anchor) => (
                <option key={anchor.id} value={anchor.id}>
                  {anchor.label} · {anchor.keyId.slice(0, 10)}
                </option>
              ))
            )}
          </select>
        </label>
      </div>

      <div className="prompt-package-actions">
        <button type="button" disabled={busy || !canSign} onClick={onSign}>
          <Save size={12} aria-hidden="true" />
          {busy ? copy.context.promptPackageWorking : copy.context.promptSign}
        </button>
        <label
          className="prompt-package-file-action"
          aria-disabled={busy ? "true" : "false"}
        >
          <input
            type="file"
            accept="application/json,.json"
            disabled={busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) onInspectFile(file, "verify");
            }}
          />
          <ShieldCheck size={12} aria-hidden="true" />
          {copy.context.promptVerify}
        </label>
        <label
          className="prompt-package-file-action"
          aria-disabled={busy ? "true" : "false"}
        >
          <input
            type="file"
            accept="application/json,.json"
            disabled={busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) onInspectFile(file, "qualify");
            }}
          />
          <FileCheck size={12} aria-hidden="true" />
          {copy.context.promptQualify}
        </label>
      </div>

      {anchors.length === 0 ? (
        <p className="prompt-package-note">
          <ShieldCheck size={11} aria-hidden="true" />
          {copy.context.promptPackageSignerHint}
        </p>
      ) : null}
      {receipt ? <PromptPackageReceiptCard receipt={receipt} /> : null}
    </section>
  );
}

function PromptPackageReceiptCard({
  receipt,
}: {
  receipt: PromptPackageReceipt;
}) {
  return (
    <article className={`prompt-package-receipt status-${receipt.status}`}>
      <header>
        <span>{copy.context.promptPackageReceiptActions[receipt.action]}</span>
        <strong>{copy.context.promptPackageStatuses[receipt.status]}</strong>
      </header>
      <p>{receipt.reason}</p>
      <dl>
        {receipt.manifestSha256 ? (
          <HashRow
            label={copy.context.promptPackageManifestHash}
            value={receipt.manifestSha256}
          />
        ) : null}
        {receipt.envelopeSha256 ? (
          <HashRow
            label={copy.context.promptPackageEnvelopeHash}
            value={receipt.envelopeSha256}
          />
        ) : null}
        {"systemPromptSha256" in receipt && receipt.systemPromptSha256 ? (
          <HashRow
            label={copy.context.promptDigest}
            value={receipt.systemPromptSha256}
          />
        ) : null}
        {"observedSystemPromptSha256" in receipt &&
        receipt.observedSystemPromptSha256 ? (
          <HashRow
            label={copy.context.promptPackageObservedPromptHash}
            value={receipt.observedSystemPromptSha256}
          />
        ) : null}
        {receipt.keyId ? (
          <HashRow
            label={copy.context.promptPackageKey}
            value={receipt.keyId}
          />
        ) : null}
        {"agentRevision" in receipt ? (
          <div>
            <dt>{copy.context.promptPackageAgentRevision}</dt>
            <dd>{receipt.agentRevision}</dd>
          </div>
        ) : null}
        {"observedAgentRevision" in receipt &&
        receipt.observedAgentRevision !== undefined ? (
          <div>
            <dt>{copy.context.promptPackageObservedRevision}</dt>
            <dd>{receipt.observedAgentRevision}</dd>
          </div>
        ) : null}
      </dl>
    </article>
  );
}

function HashRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <code title={value}>{value.slice(0, 12)}</code>
      </dd>
    </div>
  );
}

function OptionGroup<T extends string>({
  legend,
  options,
  selected,
  disabled,
  onChange,
}: {
  legend: string;
  options: Array<{ value: T; label: string; detail: string }>;
  selected: T[];
  disabled: boolean;
  onChange: (value: T[]) => void;
}) {
  return (
    <fieldset className="context-option-group">
      <legend>{legend}</legend>
      <div className="context-option-grid">
        {options.map((option) => (
          <label key={option.value}>
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              disabled={disabled}
              onChange={(event) =>
                onChange(
                  toggleSelection(selected, option.value, event.target.checked),
                )
              }
            />
            <span>
              <strong>{option.label}</strong>
              <small>{option.detail}</small>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="context-field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          if (Number.isFinite(event.target.valueAsNumber)) {
            onChange(event.target.valueAsNumber);
          }
        }}
      />
    </label>
  );
}

function CredentialCard({
  reference,
  busy,
  onCheck,
  onToggle,
}: {
  reference: CredentialReference;
  busy: boolean;
  onCheck: (referenceId: string) => void;
  onToggle: (referenceId: string, enabled: boolean) => void;
}) {
  return (
    <article
      className={`credential-card availability-${reference.availability}`}
    >
      <header>
        <div>
          <span>{reference.providerId}</span>
          <strong>{reference.label}</strong>
        </div>
        <span className={`credential-state state-${reference.status}`}>
          {copy.context.credentialStatuses[reference.status]}
        </span>
      </header>
      <code>{credentialLocator(reference.source)}</code>
      <div className="credential-availability" role="status">
        <i aria-hidden="true" />
        <span>
          {copy.context.credentialAvailability[reference.availability]}
        </span>
        {reference.lastCheckedAt ? (
          <time dateTime={reference.lastCheckedAt}>
            {formatDate(reference.lastCheckedAt)}
          </time>
        ) : null}
      </div>
      {reference.lastError && reference.availability !== "unknown" ? (
        <p className="credential-error">{reference.lastError}</p>
      ) : null}
      <footer>
        <button
          type="button"
          disabled={busy || reference.status === "disabled"}
          onClick={() => onCheck(reference.id)}
        >
          <RefreshCw
            size={11}
            aria-hidden="true"
            className={busy ? "is-spinning" : ""}
          />
          {copy.context.checkReference}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            onToggle(reference.id, reference.status === "disabled")
          }
        >
          {reference.status === "active"
            ? copy.context.disableReference
            : copy.context.enableReference}
        </button>
      </footer>
    </article>
  );
}

function toggleSelection<T extends string>(
  current: T[],
  value: T,
  selected: boolean,
): T[] {
  return selected
    ? current.includes(value)
      ? current
      : [...current, value]
    : current.filter((candidate) => candidate !== value);
}

function credentialLocator(source: CredentialReferenceSource): string {
  return source.type === "environment"
    ? `ENV · ${source.variable}`
    : `KEYCHAIN · ${source.service} / ${source.account}`;
}

function UsagePriceTableCard({ catalog }: { catalog: UsagePriceTableCatalog }) {
  const providers = catalog.tables.map((table) => table.provider).join(", ");
  return (
    <section
      className="context-checkpoint usage-price-table-card"
      aria-labelledby="usage-price-table-title"
    >
      <header>
        <div>
          <span>{copy.context.priceTableEyebrow}</span>
          <h3 id="usage-price-table-title">{copy.context.priceTable}</h3>
        </div>
        <span>
          {catalog.tables.length} {copy.context.priceTables}
        </span>
      </header>
      <p>{copy.context.priceTableBody}</p>
      <dl>
        <div>
          <dt>{copy.context.providers}</dt>
          <dd>
            <code>{providers}</code>
          </dd>
        </div>
        <div>
          <dt>{copy.context.catalogHash}</dt>
          <dd>
            <code>{catalog.contentSha256.slice(0, 12)}</code>
          </dd>
        </div>
      </dl>
      <small>
        <ShieldCheck size={11} aria-hidden="true" />
        {copy.context.priceTableSafety}
      </small>
    </section>
  );
}

function ContextCheckpointCard({
  checkpoint,
  calibration,
}: {
  checkpoint: ContextCheckpointSnapshot;
  calibration?: ContextCheckpointCalibrationReport;
}) {
  const groups = [
    { label: copy.context.decisions, values: checkpoint.decisions },
    { label: copy.context.openLoops, values: checkpoint.openLoops },
    { label: copy.context.artifacts, values: checkpoint.artifacts },
  ].filter((group) => group.values.length > 0);
  return (
    <section
      className="context-checkpoint"
      aria-labelledby="context-checkpoint-title"
    >
      <header>
        <div>
          <span>{copy.context.checkpointEyebrow}</span>
          <h3 id="context-checkpoint-title">{copy.context.checkpoint}</h3>
        </div>
        <span>
          {copy.context.coverage} #{checkpoint.fromSeq}–#{checkpoint.toSeq}
        </span>
      </header>
      <p>{checkpoint.summary}</p>
      {groups.map((group) => (
        <div className="checkpoint-group" key={group.label}>
          <span>{group.label}</span>
          <ul>
            {group.values.map((value) => (
              <li key={value}>{value}</li>
            ))}
          </ul>
        </div>
      ))}
      <dl>
        <div>
          <dt>{copy.context.sourceHash}</dt>
          <dd>
            <code>{checkpoint.sourceSha256.slice(0, 12)}</code>
          </dd>
        </div>
        <div>
          <dt>{copy.context.summaryHash}</dt>
          <dd>
            <code>{checkpoint.summarySha256.slice(0, 12)}</code>
          </dd>
        </div>
      </dl>
      {calibration ? (
        <dl
          className="checkpoint-calibration-metrics"
          aria-label={copy.context.calibration}
        >
          <div>
            <dt>{copy.context.calibrationHash}</dt>
            <dd>
              <code>{calibration.contentSha256.slice(0, 12)}</code>
            </dd>
          </div>
          <div>
            <dt>{copy.context.coverageRate}</dt>
            <dd>
              <code>{formatPercent(calibration.coverageRate)}</code>
            </dd>
          </div>
          <div>
            <dt>{copy.context.compression}</dt>
            <dd>
              <code>{formatRatio(calibration.compressionRatio)}</code>
            </dd>
          </div>
          <div>
            <dt>{copy.context.fallbacks}</dt>
            <dd>
              <code>
                {calibration.failureCount} /{" "}
                {calibration.fallbackOmittedMessageCount}
              </code>
            </dd>
          </div>
        </dl>
      ) : null}
      <small>
        <ShieldCheck size={11} aria-hidden="true" />
        {calibration
          ? `${copy.context.checkpointSafety} ${copy.context.calibrationSafety}`
          : copy.context.checkpointSafety}
      </small>
    </section>
  );
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatRatio(value: number): string {
  return value > 0 ? `${value.toFixed(value >= 10 ? 0 : 1)}x` : "0x";
}

function ContextRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="context-row">
      <dt>
        {icon}
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

function agentProfileDelta(
  current: AgentProfile,
  target: AgentProfile,
): AgentProfileField[] {
  const fields: AgentProfileField[] = [
    "name",
    "description",
    "systemPrompt",
    "model",
    "thinkingLevel",
    "toolPolicy",
    "enabledTools",
    "enabledSkills",
    "enabledSubagents",
    "subagentLimits",
    "runLimits",
    "automaticRecovery",
    "modelAdvisor",
    "promptVariables",
    "toolLoopGuard",
  ];
  return fields.filter((field) => {
    if (field === "automaticRecovery") {
      return (
        JSON.stringify(
          current.automaticRecovery ?? {
            mode: "manual",
            maxAttempts: 2,
            backoffMs: 5_000,
          },
        ) !==
        JSON.stringify(
          target.automaticRecovery ?? {
            mode: "manual",
            maxAttempts: 2,
            backoffMs: 5_000,
          },
        )
      );
    }
    if (field === "modelAdvisor") {
      return (
        JSON.stringify(comparableModelAdvisor(current)) !==
        JSON.stringify(comparableModelAdvisor(target))
      );
    }
    if (field === "toolLoopGuard") {
      return (
        JSON.stringify(comparableToolLoopGuard(current)) !==
        JSON.stringify(comparableToolLoopGuard(target))
      );
    }
    return JSON.stringify(current[field]) !== JSON.stringify(target[field]);
  });
}

function comparableModelAdvisor(agent: AgentProfile) {
  const policy = agent.modelAdvisor ?? DEFAULT_MODEL_ADVISOR_POLICY;
  return {
    mode: policy.mode,
    enabledRules: [...policy.enabledRules].sort(),
    maxCorrectionAttempts: policy.maxCorrectionAttempts ?? 0,
    reviewModel: agent.modelAdvisor?.reviewModel,
  };
}

function comparableToolLoopGuard(agent: AgentProfile): ToolLoopGuardPolicy {
  return {
    enabled: agent.toolLoopGuard?.enabled ?? true,
    threshold: agent.toolLoopGuard?.threshold ?? 3,
    exemptTools: [...(agent.toolLoopGuard?.exemptTools ?? [])].sort(),
  };
}

function validPromptVariables(
  definitions: readonly PromptVariableDefinition[],
): boolean {
  if (definitions.length > 32) return false;
  const names = definitions.map((definition) => definition.name);
  if (new Set(names).size !== names.length) return false;
  const literalBytes = definitions.reduce(
    (total, definition) =>
      total +
      (definition.type === "literal"
        ? new TextEncoder().encode(
            definition.value.replace(/\r\n?/gu, "\n").trim(),
          ).length
        : 0),
    0,
  );
  return (
    literalBytes <= 16 * 1024 &&
    definitions.every((definition) =>
      validPromptVariableDefinition(definition, definitions),
    )
  );
}

function validPromptVariableDefinition(
  definition: PromptVariableDefinition,
  definitions: readonly PromptVariableDefinition[],
): boolean {
  if (
    !validPromptVariableName(definition.name) ||
    definitions.filter((candidate) => candidate.name === definition.name)
      .length !== 1
  ) {
    return false;
  }
  if (definition.type === "literal") {
    return validPromptVariableLiteral(definition.value);
  }
  if (definition.type === "current_date") {
    return (
      definition.format === "readable-date" ||
      definition.format === "iso-date" ||
      definition.format === "local-date-time"
    );
  }
  return definition.type === "skill_catalog";
}

function validPromptVariableName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]{0,63}$/u.test(value);
}

function validPromptVariableLiteral(value: string): boolean {
  const normalized = value.replace(/\r\n?/gu, "\n").trim();
  return (
    normalized.length > 0 &&
    !normalized.includes("\u0000") &&
    [...normalized].length <= 2_000 &&
    new TextEncoder().encode(normalized).length <= 4 * 1024
  );
}

function parseToolLoopGuardExemptTools(
  value: string,
): ToolLoopGuardPolicy["exemptTools"] | undefined {
  if (!value.trim()) return [];
  const tools = value
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean);
  if (
    tools.length > 32 ||
    new Set(tools).size !== tools.length ||
    tools.some((tool) => !/^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/u.test(tool))
  ) {
    return undefined;
  }
  return tools.sort();
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function parseModelKey(value: string): { provider: string; id: string } {
  const separator = value.indexOf("/");
  if (separator < 1 || separator === value.length - 1) {
    return { provider: "napier", id: "demo" };
  }
  return {
    provider: value.slice(0, separator),
    id: value.slice(separator + 1),
  };
}

function downloadJson(value: unknown, filename: string): void {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(value, null, 2)}\n`], {
      type: "application/json",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function readJsonFile(file: File): Promise<unknown> {
  return JSON.parse(await file.text()) as unknown;
}

function utf8Size(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
    value,
  );
}

function formatSignedDelta(value: number): string {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : ""}${formatCount(value)}`;
}

function sameStringSet(left: string[], right: string[]): boolean {
  const normalizedLeft = [...left].sort();
  const normalizedRight = [...right].sort();
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
}

function skillContentAppliedReason(
  review: SkillContentReview,
  applied: boolean,
): string {
  if (!applied || review.action === "noop")
    return copy.context.skillContentNoop;
  return review.action === "replace"
    ? copy.context.skillContentReplaced
    : copy.context.skillContentInstalled;
}

function toErrorMessage(error: unknown): string {
  return formatApiErrorMessage(error);
}
