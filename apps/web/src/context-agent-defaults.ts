import type { ModelAdvisorRuleId } from "@napier/contracts";

export const DEFAULT_AGENT_RUN_LIMITS = {
  maxTurns: 24,
  maxTotalTokens: 250_000,
  maxCostUsd: 10,
  timeoutMs: 900_000,
} as const;

export const DEFAULT_AGENT_MODEL_ADVISOR_POLICY = {
  mode: "observe" as const,
  enabledRules: [
    "unverified_verification_claim" as const,
    "destructive_command_reference" as const,
  ],
  maxCorrectionAttempts: 0,
};

export const AGENT_MODEL_ADVISOR_RULES: ModelAdvisorRuleId[] = [
  "unverified_verification_claim",
  "destructive_command_reference",
];
