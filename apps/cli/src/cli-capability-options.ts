import {
  AGENT_CAPABILITY_PRESET_IDS,
  type AgentCapabilityPresetId,
} from "@napier/contracts/agent-capabilities";

import { optionalResourceId, requiredValue } from "./cli-option-values.js";
import type { CliWorkspaceOptions } from "./cli-execution-options.js";

export interface CliCapabilityOptions extends CliWorkspaceOptions {
  agentId?: string;
  presetId?: AgentCapabilityPresetId;
  upgradeRecommended: boolean;
  restoreRecommended: boolean;
  expectedRevision?: number;
  diffSha256?: string;
  apply: boolean;
}

export const CAPABILITY_VALUE_OPTIONS = new Set([
  "--workspace",
  "--data-root",
  "--agent",
  "--preset",
  "--expected-revision",
  "--diff-sha256",
]);
export const CAPABILITY_FLAG_OPTIONS = new Set([
  "--apply",
  "--upgrade-recommended",
  "--restore-recommended",
]);

export function optionalCapabilityPreset(
  values: Map<string, string>,
): AgentCapabilityPresetId | undefined {
  if (!values.has("--preset")) return undefined;
  const preset = requiredValue(values, "--preset");
  if (
    !AGENT_CAPABILITY_PRESET_IDS.includes(preset as AgentCapabilityPresetId)
  ) {
    throw new Error(
      `--preset must be one of ${AGENT_CAPABILITY_PRESET_IDS.join(", ")}`,
    );
  }
  return preset as AgentCapabilityPresetId;
}

export function parseCapabilityOptions(
  values: Map<string, string>,
  flags: ReadonlySet<string>,
  jsonl: boolean,
): { kind: "capabilities"; options: CliCapabilityOptions } {
  const preset = optionalCapabilityPreset(values);
  const upgradeRecommended = flags.has("--upgrade-recommended");
  const restoreRecommended = flags.has("--restore-recommended");
  const operationCount =
    Number(Boolean(preset)) +
    Number(upgradeRecommended) +
    Number(restoreRecommended);
  if (operationCount > 1) {
    throw new Error(
      "--preset, --upgrade-recommended, and --restore-recommended are mutually exclusive",
    );
  }
  if (flags.has("--apply") && operationCount === 0) {
    throw new Error(
      "--apply requires --preset, --upgrade-recommended, or --restore-recommended",
    );
  }
  if (
    !upgradeRecommended &&
    !restoreRecommended &&
    (values.has("--expected-revision") || values.has("--diff-sha256"))
  ) {
    throw new Error(
      "--expected-revision and --diff-sha256 require --upgrade-recommended or --restore-recommended",
    );
  }
  if (
    (upgradeRecommended || restoreRecommended) &&
    !flags.has("--apply") &&
    (values.has("--expected-revision") || values.has("--diff-sha256"))
  ) {
    throw new Error(
      "Capability preview does not accept apply preconditions",
    );
  }
  if ((upgradeRecommended || restoreRecommended) && flags.has("--apply")) {
    if (!values.has("--expected-revision") || !values.has("--diff-sha256")) {
      throw new Error(
        "Capability apply requires --expected-revision and --diff-sha256",
      );
    }
  }
  return {
    kind: "capabilities",
    options: {
      workspace: requiredValue(values, "--workspace"),
      jsonl,
      apply: flags.has("--apply"),
      upgradeRecommended,
      restoreRecommended,
      ...(values.has("--data-root")
        ? { dataRoot: requiredValue(values, "--data-root") }
        : {}),
      ...(optionalResourceId(values, "--agent")
        ? { agentId: optionalResourceId(values, "--agent")! }
        : {}),
      ...(preset ? { presetId: preset } : {}),
      ...(values.has("--expected-revision")
        ? { expectedRevision: capabilityRevision(values) }
        : {}),
      ...(values.has("--diff-sha256")
        ? { diffSha256: capabilityDiffSha256(values) }
        : {}),
    },
  };
}

function capabilityRevision(values: Map<string, string>): number {
  const value = requiredValue(values, "--expected-revision");
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new Error("--expected-revision must be a positive integer");
  }
  const revision = Number(value);
  if (!Number.isSafeInteger(revision)) {
    throw new Error("--expected-revision is invalid");
  }
  return revision;
}

function capabilityDiffSha256(values: Map<string, string>): string {
  const value = requiredValue(values, "--diff-sha256");
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error("--diff-sha256 must be a lower-case SHA-256");
  }
  return value;
}
