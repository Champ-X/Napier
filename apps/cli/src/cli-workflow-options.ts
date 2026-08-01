import {
  optionalResourceId,
  parseTimeout,
  requiredValue,
} from "./cli-option-values.js";
import type { CliExecutionOptions } from "./cli-options.js";

const MAX_WORKFLOW_INPUT_BYTES = 64 * 1_024;
const MAX_WORKFLOW_BREAKPOINTS = 16;
const MAX_TITLE_CHARS = 160;

export interface CliWorkflowOptions extends CliExecutionOptions {
  manifestPath: string;
  inputJson?: string;
  agentId?: string;
  threadId?: string;
  planId?: string;
  title?: string;
  retryBlocked: boolean;
  breakBeforeNodeIds?: string[];
  continueBreakpoint?: boolean;
  fromNodeId?: string;
  singleNode?: boolean;
  stepNodes?: boolean;
  simulateOutputJson?: string;
  replaceInputJson?: string;
  replaceWorkflowInputJson?: string;
  modelOverridesJson?: string;
  expectedPreviewSha256?: string;
  previewExperiment?: boolean;
  confirmSideEffects?: boolean;
  approval?: "approve" | "reject";
  decisionNote?: string;
}

export const WORKFLOW_VALUE_OPTIONS = new Set([
  "--workspace",
  "--data-root",
  "--manifest",
  "--input-json",
  "--agent",
  "--thread",
  "--plan",
  "--title",
  "--timeout-ms",
  "--from-node",
  "--simulate-output-json",
  "--replace-input-json",
  "--replace-workflow-input-json",
  "--model-overrides-json",
  "--expected-preview",
  "--decision-note",
  "--break-before",
]);

export const WORKFLOW_FLAG_OPTIONS = new Set([
  "--retry-blocked",
  "--continue-breakpoint",
  "--preview-experiment",
  "--confirm-side-effects",
  "--single-node",
  "--step-nodes",
  "--approve",
  "--reject",
]);

export function parseWorkflowOptions(
  values: Map<string, string>,
  flags: ReadonlySet<string>,
  jsonl: boolean,
): { kind: "workflow"; options: CliWorkflowOptions } {
  const workspace = requiredValue(values, "--workspace");
  const manifestPath = requiredValue(values, "--manifest");
  const planId = optionalResourceId(values, "--plan");
  const threadId = optionalResourceId(values, "--thread");
  const agentId = optionalResourceId(values, "--agent");
  const fromNodeId = optionalResourceId(values, "--from-node");
  const breakBeforeNodeIds = workflowBreakpointNodeIds(
    values.get("--break-before"),
  );
  const inputJson = values.get("--input-json");
  const simulateOutputJson = values.get("--simulate-output-json");
  const replaceInputJson = values.get("--replace-input-json");
  const replaceWorkflowInputJson = values.get("--replace-workflow-input-json");
  const modelOverridesJson = values.get("--model-overrides-json");
  const expectedPreviewSha256 = values.get("--expected-preview")?.trim();
  const decisionNote = values.get("--decision-note")?.trim();
  const rawTitle = values.get("--title");
  const title = rawTitle?.replace(/\s+/gu, " ").trim();
  if (rawTitle !== undefined && (!title || title.length > MAX_TITLE_CHARS)) {
    throw new Error(`--title must be 1-${MAX_TITLE_CHARS} characters`);
  }
  if (
    expectedPreviewSha256 !== undefined &&
    !/^[a-f0-9]{64}$/u.test(expectedPreviewSha256)
  ) {
    throw new Error("--expected-preview must be a SHA-256 digest");
  }
  assertBoundedJsonOption(simulateOutputJson, "--simulate-output-json");
  assertBoundedJsonOption(replaceInputJson, "--replace-input-json");
  assertBoundedJsonOption(
    replaceWorkflowInputJson,
    "--replace-workflow-input-json",
  );
  assertBoundedJsonOption(modelOverridesJson, "--model-overrides-json");
  if (flags.has("--approve") && flags.has("--reject")) {
    throw new Error("--approve and --reject are mutually exclusive");
  }
  const approval = flags.has("--approve")
    ? "approve"
    : flags.has("--reject")
      ? "reject"
      : undefined;
  if (decisionNote !== undefined && !approval) {
    throw new Error("--decision-note requires --approve or --reject");
  }
  if (
    decisionNote !== undefined &&
    Buffer.byteLength(decisionNote, "utf8") > 4 * 1_024
  ) {
    throw new Error("--decision-note exceeds 4096 UTF-8 bytes");
  }
  const workflowExperiment =
    fromNodeId !== undefined || replaceWorkflowInputJson !== undefined;
  if (fromNodeId && replaceWorkflowInputJson !== undefined) {
    throw new Error(
      "--from-node cannot be used with --replace-workflow-input-json",
    );
  }
  if (workflowExperiment) {
    assertWorkflowExperimentOptions({
      planId,
      threadId,
      inputJson,
      agentId,
      breakBeforeNodeIds,
      flags,
      expectedPreviewSha256,
      approval,
      simulateOutputJson,
      replaceInputJson,
      replaceWorkflowInputJson,
    });
  } else if (planId) {
    if (!threadId) throw new Error("--thread is required with --plan");
    if (
      inputJson !== undefined ||
      agentId ||
      title ||
      simulateOutputJson !== undefined ||
      replaceInputJson !== undefined ||
      replaceWorkflowInputJson !== undefined ||
      modelOverridesJson !== undefined ||
      expectedPreviewSha256 !== undefined ||
      flags.has("--preview-experiment") ||
      flags.has("--confirm-side-effects") ||
      flags.has("--single-node") ||
      flags.has("--step-nodes") ||
      breakBeforeNodeIds.length > 0
    ) {
      throw new Error(
        "Experiment options cannot be used with a normal Workflow resume",
      );
    }
  } else if (inputJson === undefined) {
    throw new Error("--input-json is required for a new Workflow");
  }
  assertWorkflowControlOptions(flags, planId, approval);
  assertBoundedJsonOption(inputJson, "--input-json");
  if (!workflowExperiment && threadId && title) {
    throw new Error("--title cannot be used with an existing --thread");
  }
  if (
    !workflowExperiment &&
    (modelOverridesJson !== undefined ||
      simulateOutputJson !== undefined ||
      replaceInputJson !== undefined ||
      replaceWorkflowInputJson !== undefined ||
      expectedPreviewSha256 !== undefined ||
      flags.has("--preview-experiment") ||
      flags.has("--confirm-side-effects") ||
      flags.has("--single-node") ||
      flags.has("--step-nodes"))
  ) {
    throw new Error("Workflow experiment options require --from-node");
  }
  return {
    kind: "workflow",
    options: {
      workspace,
      manifestPath,
      timeoutMs: parseTimeout(values.get("--timeout-ms")),
      jsonl,
      retryBlocked: flags.has("--retry-blocked"),
      ...(flags.has("--continue-breakpoint")
        ? { continueBreakpoint: true }
        : {}),
      ...(values.has("--data-root")
        ? { dataRoot: requiredValue(values, "--data-root") }
        : {}),
      ...(inputJson !== undefined ? { inputJson } : {}),
      ...(agentId ? { agentId } : {}),
      ...(threadId ? { threadId } : {}),
      ...(planId ? { planId } : {}),
      ...(title ? { title } : {}),
      ...(breakBeforeNodeIds.length > 0 ? { breakBeforeNodeIds } : {}),
      ...(fromNodeId ? { fromNodeId } : {}),
      ...(flags.has("--single-node") ? { singleNode: true } : {}),
      ...(flags.has("--step-nodes") ? { stepNodes: true } : {}),
      ...(simulateOutputJson !== undefined ? { simulateOutputJson } : {}),
      ...(replaceInputJson !== undefined ? { replaceInputJson } : {}),
      ...(replaceWorkflowInputJson !== undefined
        ? { replaceWorkflowInputJson }
        : {}),
      ...(modelOverridesJson !== undefined ? { modelOverridesJson } : {}),
      ...(expectedPreviewSha256 ? { expectedPreviewSha256 } : {}),
      ...(flags.has("--preview-experiment") ? { previewExperiment: true } : {}),
      ...(flags.has("--confirm-side-effects")
        ? { confirmSideEffects: true }
        : {}),
      ...(approval ? { approval } : {}),
      ...(decisionNote ? { decisionNote } : {}),
    },
  };
}

function assertWorkflowExperimentOptions(input: {
  planId: string | undefined;
  threadId: string | undefined;
  inputJson: string | undefined;
  agentId: string | undefined;
  breakBeforeNodeIds: string[];
  flags: ReadonlySet<string>;
  expectedPreviewSha256: string | undefined;
  approval: "approve" | "reject" | undefined;
  simulateOutputJson: string | undefined;
  replaceInputJson: string | undefined;
  replaceWorkflowInputJson: string | undefined;
}): void {
  if (!input.planId || !input.threadId) {
    throw new Error("Workflow experiments require --thread and --plan");
  }
  if (
    input.inputJson !== undefined ||
    input.agentId ||
    input.breakBeforeNodeIds.length > 0 ||
    input.flags.has("--continue-breakpoint")
  ) {
    throw new Error(
      "Run and breakpoint options cannot be used with --from-node",
    );
  }
  if (input.flags.has("--retry-blocked")) {
    throw new Error("--retry-blocked cannot be used with --from-node");
  }
  if (
    input.flags.has("--confirm-side-effects") &&
    !input.expectedPreviewSha256
  ) {
    throw new Error("--confirm-side-effects requires --expected-preview");
  }
  if (
    input.flags.has("--preview-experiment") &&
    (input.flags.has("--confirm-side-effects") || input.expectedPreviewSha256)
  ) {
    throw new Error(
      "--preview-experiment cannot include execution confirmation",
    );
  }
  if (input.approval) {
    throw new Error("--approve and --reject cannot be used with experiments");
  }
  if (
    Number(input.flags.has("--single-node")) +
      Number(input.flags.has("--step-nodes")) +
      Number(input.simulateOutputJson !== undefined) +
      Number(input.replaceInputJson !== undefined) +
      Number(input.replaceWorkflowInputJson !== undefined) >
    1
  ) {
    throw new Error("Checkpoint experiment modes are mutually exclusive");
  }
  if (
    (input.flags.has("--single-node") ||
      input.flags.has("--step-nodes") ||
      input.simulateOutputJson !== undefined ||
      input.replaceInputJson !== undefined ||
      input.replaceWorkflowInputJson !== undefined) &&
    !input.flags.has("--preview-experiment") &&
    !input.expectedPreviewSha256
  ) {
    throw new Error(
      "Checkpoint experiment execution requires --expected-preview",
    );
  }
}

function assertWorkflowControlOptions(
  flags: ReadonlySet<string>,
  planId: string | undefined,
  approval: "approve" | "reject" | undefined,
): void {
  if (flags.has("--continue-breakpoint") && !planId) {
    throw new Error("--continue-breakpoint requires --plan");
  }
  if (flags.has("--continue-breakpoint") && approval) {
    throw new Error(
      "--continue-breakpoint cannot be used with --approve or --reject",
    );
  }
  if (flags.has("--continue-breakpoint") && flags.has("--retry-blocked")) {
    throw new Error(
      "--continue-breakpoint and --retry-blocked are mutually exclusive",
    );
  }
  if (approval && !planId) {
    throw new Error("--approve and --reject require --plan");
  }
  if (flags.has("--retry-blocked") && !planId) {
    throw new Error("--retry-blocked requires --plan");
  }
}

function assertBoundedJsonOption(
  value: string | undefined,
  name: string,
): void {
  if (
    value !== undefined &&
    Buffer.byteLength(value, "utf8") > MAX_WORKFLOW_INPUT_BYTES
  ) {
    throw new Error(`${name} exceeds ${MAX_WORKFLOW_INPUT_BYTES} UTF-8 bytes`);
  }
}

function workflowBreakpointNodeIds(value: string | undefined): string[] {
  if (value === undefined) return [];
  const nodeIds = value.split(",").map((nodeId) => nodeId.trim());
  if (
    nodeIds.length < 1 ||
    nodeIds.length > MAX_WORKFLOW_BREAKPOINTS ||
    nodeIds.some((nodeId) => !/^[a-z][a-z0-9_-]{0,63}$/u.test(nodeId)) ||
    new Set(nodeIds).size !== nodeIds.length
  ) {
    throw new Error(
      `--break-before requires 1-${MAX_WORKFLOW_BREAKPOINTS} unique node IDs`,
    );
  }
  return nodeIds;
}
