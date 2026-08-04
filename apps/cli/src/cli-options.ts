import type { AgentMessageExperimentToolResultMode } from "@napier/contracts";

import {
  parseChatOptions,
  parseTuiOptions,
  type CliChatAction,
  type CliTuiAction,
} from "./cli-chat-options.js";
import {
  commandFlagOptions,
  commandValueOptions,
  knownCliCommand,
} from "./cli-command-options.js";
import {
  parseCliOptions,
  parseNonNegativeInteger,
  parsePositiveInteger,
} from "./cli-option-parser.js";
import { CLI_HELP, CLI_VERSION } from "./cli-help.js";
import type {
  CliExecutionOptions,
  CliWorkspaceOptions,
} from "./cli-execution-options.js";
import {
  optionalModelRef,
  optionalResourceId,
  parseTimeout,
  requiredResourceId,
  requiredValue,
} from "./cli-option-values.js";
import {
  parseWorkflowOptions as parseWorkflowOptionsDomain,
  type CliWorkflowOptions,
} from "./cli-workflow-options.js";
import {
  parseRunOptions,
  type CliRunOptions,
} from "./cli-run-options.js";
import { parseFirstUseCliAction } from "./cli-first-use.js";
import type { CliFirstUseAction } from "./cli-first-use-model.js";

export type { CliWorkflowOptions };
export type { CliRunOptions };
export type {
  CliExecutionOptions,
  CliWorkspaceOptions,
} from "./cli-execution-options.js";

export { CLI_HELP, CLI_VERSION };
const MAX_BRANCH_TITLE_CHARS = 100;

export interface CliResumeOptions extends CliExecutionOptions {
  threadId: string;
  runId?: string;
}

export interface CliBranchOptions extends CliWorkspaceOptions {
  threadId: string;
  fromSeq: number;
  title?: string;
}

export interface CliAgentMessageExperimentOptions extends CliExecutionOptions {
  threadId: string;
  sourceRunId: string;
  sourceMessageSeq: number;
  title?: string;
  toolResultMode?: AgentMessageExperimentToolResultMode;
  expectedPreviewSha256?: string;
  preview: boolean;
}

export interface CliModelInvocationExperimentOptions extends CliExecutionOptions {
  threadId: string;
  sourceRunId: string;
  sourceTurnIndex: number;
  title?: string;
  expectedPreviewSha256?: string;
  preview: boolean;
}

export interface CliToolInvocationExperimentOptions extends CliWorkspaceOptions {
  threadId: string;
  sourceRunId: string;
  sourceCallId: string;
  title?: string;
  expectedPreviewSha256?: string;
  preview: boolean;
  timeoutMs: number;
}

export interface CliRpcOptions {
  workspace: string;
  dataRoot?: string;
}

export type CliAction =
  | { kind: "help" }
  | { kind: "version" }
  | CliFirstUseAction
  | { kind: "run"; options: CliRunOptions }
  | CliChatAction
  | CliTuiAction
  | { kind: "resume"; options: CliResumeOptions }
  | { kind: "branch"; options: CliBranchOptions }
  | {
      kind: "experiment";
      options: CliAgentMessageExperimentOptions;
    }
  | {
      kind: "model-experiment";
      options: CliModelInvocationExperimentOptions;
    }
  | {
      kind: "tool-experiment";
      options: CliToolInvocationExperimentOptions;
    }
  | { kind: "rpc"; options: CliRpcOptions }
  | { kind: "workflow"; options: CliWorkflowOptions };

const RESUME_VALUE_OPTIONS = new Set([
  "--workspace",
  "--data-root",
  "--model",
  "--thread",
  "--run",
  "--timeout-ms",
]);
const BRANCH_VALUE_OPTIONS = new Set([
  "--workspace",
  "--data-root",
  "--thread",
  "--from-seq",
  "--title",
]);
const EXPERIMENT_VALUE_OPTIONS = new Set([
  "--workspace",
  "--data-root",
  "--thread",
  "--run",
  "--message-seq",
  "--model",
  "--title",
  "--tool-results",
  "--expected-preview",
  "--timeout-ms",
]);
const EXPERIMENT_FLAG_OPTIONS = new Set(["--preview"]);
const MODEL_EXPERIMENT_VALUE_OPTIONS = new Set([
  "--workspace",
  "--data-root",
  "--thread",
  "--run",
  "--turn-index",
  "--model",
  "--title",
  "--expected-preview",
  "--timeout-ms",
]);
const MODEL_EXPERIMENT_FLAG_OPTIONS = new Set(["--preview"]);
const TOOL_EXPERIMENT_VALUE_OPTIONS = new Set([
  "--workspace",
  "--data-root",
  "--thread",
  "--run",
  "--call-id",
  "--title",
  "--expected-preview",
  "--timeout-ms",
]);
const TOOL_EXPERIMENT_FLAG_OPTIONS = new Set(["--preview"]);
const RPC_VALUE_OPTIONS = new Set(["--workspace", "--data-root"]);
export function parseCliArgs(argv: string[]): CliAction {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    return { kind: "help" };
  }
  if (argv[0] === "--version" || argv[0] === "-v") {
    if (argv.length !== 1) throw new Error("--version accepts no arguments");
    return { kind: "version" };
  }
  const command = argv[0]!;
  if (!knownCliCommand(command)) throw new Error("Unknown command");
  if (argv.length === 2 && (argv[1] === "--help" || argv[1] === "-h")) {
    return { kind: "help" };
  }
  const { values, flags, jsonl } = parseCliOptions(
    argv.slice(1),
    commandValueOptions(command, {
      resume: RESUME_VALUE_OPTIONS,
      branch: BRANCH_VALUE_OPTIONS,
      experiment: EXPERIMENT_VALUE_OPTIONS,
      modelExperiment: MODEL_EXPERIMENT_VALUE_OPTIONS,
      toolExperiment: TOOL_EXPERIMENT_VALUE_OPTIONS,
      rpc: RPC_VALUE_OPTIONS,
    }),
    commandFlagOptions(command, {
      experiment: EXPERIMENT_FLAG_OPTIONS,
      modelExperiment: MODEL_EXPERIMENT_FLAG_OPTIONS,
      toolExperiment: TOOL_EXPERIMENT_FLAG_OPTIONS,
    }),
  );
  const firstUse = parseFirstUseCliAction(command, values, flags, jsonl);
  if (firstUse) return firstUse;
  if (command === "run") return parseRunOptions(values, jsonl);
  if (command === "chat") return parseChatOptions(values, jsonl);
  if (command === "tui") return parseTuiOptions(values, jsonl);
  if (command === "resume") return parseResumeOptions(values, jsonl);
  if (command === "branch") return parseBranchOptions(values, jsonl);
  if (command === "experiment") {
    return parseAgentMessageExperimentOptions(values, flags, jsonl);
  }
  if (command === "model-experiment") {
    return parseModelInvocationExperimentOptions(values, flags, jsonl);
  }
  if (command === "tool-experiment") {
    return parseToolInvocationExperimentOptions(values, flags, jsonl);
  }
  if (command === "rpc") return parseRpcOptions(values, jsonl);
  return parseWorkflowOptions(values, flags, jsonl);
}

function parseResumeOptions(
  values: Map<string, string>,
  jsonl: boolean,
): Extract<CliAction, { kind: "resume" }> {
  const model = optionalModelRef(values);
  const runId = optionalResourceId(values, "--run");
  return {
    kind: "resume",
    options: {
      workspace: requiredValue(values, "--workspace"),
      threadId: requiredResourceId(values, "--thread"),
      timeoutMs: parseTimeout(values.get("--timeout-ms")),
      jsonl,
      ...(values.has("--data-root")
        ? { dataRoot: requiredValue(values, "--data-root") }
        : {}),
      ...(model ? { model } : {}),
      ...(runId ? { runId } : {}),
    },
  };
}

function parseBranchOptions(
  values: Map<string, string>,
  jsonl: boolean,
): Extract<CliAction, { kind: "branch" }> {
  const rawTitle = values.get("--title");
  const title = rawTitle?.replace(/\s+/gu, " ").trim();
  if (
    rawTitle !== undefined &&
    (!title || title.length > MAX_BRANCH_TITLE_CHARS)
  ) {
    throw new Error(`--title must be 1-${MAX_BRANCH_TITLE_CHARS} characters`);
  }
  return {
    kind: "branch",
    options: {
      workspace: requiredValue(values, "--workspace"),
      threadId: requiredResourceId(values, "--thread"),
      fromSeq: parsePositiveInteger(
        requiredValue(values, "--from-seq"),
        "--from-seq",
      ),
      jsonl,
      ...(values.has("--data-root")
        ? { dataRoot: requiredValue(values, "--data-root") }
        : {}),
      ...(title ? { title } : {}),
    },
  };
}

function parseRpcOptions(
  values: Map<string, string>,
  jsonl: boolean,
): Extract<CliAction, { kind: "rpc" }> {
  if (jsonl) throw new Error("--jsonl cannot be used with rpc");
  return {
    kind: "rpc",
    options: {
      workspace: requiredValue(values, "--workspace"),
      ...(values.has("--data-root")
        ? { dataRoot: requiredValue(values, "--data-root") }
        : {}),
    },
  };
}

function parseAgentMessageExperimentOptions(
  values: Map<string, string>,
  flags: ReadonlySet<string>,
  jsonl: boolean,
): Extract<CliAction, { kind: "experiment" }> {
  const preview = flags.has("--preview");
  const expectedPreviewSha256 = values.get("--expected-preview")?.trim();
  if (
    expectedPreviewSha256 !== undefined &&
    !/^[a-f0-9]{64}$/u.test(expectedPreviewSha256)
  ) {
    throw new Error("--expected-preview must be a SHA-256 digest");
  }
  if (preview && expectedPreviewSha256) {
    throw new Error("--preview cannot include --expected-preview");
  }
  if (!preview && !expectedPreviewSha256) {
    throw new Error("Agent experiment execution requires --expected-preview");
  }
  const rawTitle = values.get("--title");
  const title = rawTitle?.replace(/\s+/gu, " ").trim();
  if (
    rawTitle !== undefined &&
    (!title ||
      title.length > MAX_BRANCH_TITLE_CHARS ||
      /[\u0000-\u001f\u007f<>]/u.test(title))
  ) {
    throw new Error(
      `--title must be 1-${MAX_BRANCH_TITLE_CHARS} safe characters`,
    );
  }
  const model = optionalModelRef(values);
  const toolResultMode = parseToolResultMode(values.get("--tool-results"));
  return {
    kind: "experiment",
    options: {
      workspace: requiredValue(values, "--workspace"),
      threadId: requiredResourceId(values, "--thread"),
      sourceRunId: requiredResourceId(values, "--run"),
      sourceMessageSeq: parsePositiveInteger(
        requiredValue(values, "--message-seq"),
        "--message-seq",
      ),
      timeoutMs: parseTimeout(values.get("--timeout-ms")),
      jsonl,
      preview,
      ...(values.has("--data-root")
        ? { dataRoot: requiredValue(values, "--data-root") }
        : {}),
      ...(model ? { model } : {}),
      ...(title ? { title } : {}),
      ...(toolResultMode ? { toolResultMode } : {}),
      ...(expectedPreviewSha256 ? { expectedPreviewSha256 } : {}),
    },
  };
}

function parseModelInvocationExperimentOptions(
  values: Map<string, string>,
  flags: ReadonlySet<string>,
  jsonl: boolean,
): Extract<CliAction, { kind: "model-experiment" }> {
  const preview = flags.has("--preview");
  const expectedPreviewSha256 = values.get("--expected-preview")?.trim();
  if (
    expectedPreviewSha256 !== undefined &&
    !/^[a-f0-9]{64}$/u.test(expectedPreviewSha256)
  ) {
    throw new Error("--expected-preview must be a SHA-256 digest");
  }
  if (preview && expectedPreviewSha256) {
    throw new Error("--preview cannot include --expected-preview");
  }
  if (!preview && !expectedPreviewSha256) {
    throw new Error(
      "Model invocation experiment execution requires --expected-preview",
    );
  }
  const rawTitle = values.get("--title");
  const title = rawTitle?.replace(/\s+/gu, " ").trim();
  if (
    rawTitle !== undefined &&
    (!title ||
      title.length > MAX_BRANCH_TITLE_CHARS ||
      /[\u0000-\u001f\u007f<>]/u.test(title))
  ) {
    throw new Error(
      `--title must be 1-${MAX_BRANCH_TITLE_CHARS} safe characters`,
    );
  }
  const model = optionalModelRef(values);
  return {
    kind: "model-experiment",
    options: {
      workspace: requiredValue(values, "--workspace"),
      threadId: requiredResourceId(values, "--thread"),
      sourceRunId: requiredResourceId(values, "--run"),
      sourceTurnIndex: parseNonNegativeInteger(
        requiredValue(values, "--turn-index"),
        "--turn-index",
      ),
      timeoutMs: parseTimeout(values.get("--timeout-ms")),
      jsonl,
      preview,
      ...(values.has("--data-root")
        ? { dataRoot: requiredValue(values, "--data-root") }
        : {}),
      ...(model ? { model } : {}),
      ...(title ? { title } : {}),
      ...(expectedPreviewSha256 ? { expectedPreviewSha256 } : {}),
    },
  };
}

function parseToolInvocationExperimentOptions(
  values: Map<string, string>,
  flags: ReadonlySet<string>,
  jsonl: boolean,
): Extract<CliAction, { kind: "tool-experiment" }> {
  const preview = flags.has("--preview");
  const expectedPreviewSha256 = values.get("--expected-preview")?.trim();
  if (
    expectedPreviewSha256 !== undefined &&
    !/^[a-f0-9]{64}$/u.test(expectedPreviewSha256)
  ) {
    throw new Error("--expected-preview must be a SHA-256 digest");
  }
  if (preview && expectedPreviewSha256) {
    throw new Error("--preview cannot include --expected-preview");
  }
  if (!preview && !expectedPreviewSha256) {
    throw new Error(
      "Tool invocation experiment execution requires --expected-preview",
    );
  }
  const rawTitle = values.get("--title");
  const title = rawTitle?.replace(/\s+/gu, " ").trim();
  if (
    rawTitle !== undefined &&
    (!title ||
      title.length > MAX_BRANCH_TITLE_CHARS ||
      /[\u0000-\u001f\u007f<>]/u.test(title))
  ) {
    throw new Error(
      `--title must be 1-${MAX_BRANCH_TITLE_CHARS} safe characters`,
    );
  }
  const sourceCallId = requiredValue(values, "--call-id");
  if (
    sourceCallId.length > 256 ||
    /[\u0000-\u001f\u007f]/u.test(sourceCallId)
  ) {
    throw new Error("--call-id is invalid");
  }
  return {
    kind: "tool-experiment",
    options: {
      workspace: requiredValue(values, "--workspace"),
      threadId: requiredResourceId(values, "--thread"),
      sourceRunId: requiredResourceId(values, "--run"),
      sourceCallId,
      timeoutMs: parseTimeout(values.get("--timeout-ms")),
      jsonl,
      preview,
      ...(values.has("--data-root")
        ? { dataRoot: requiredValue(values, "--data-root") }
        : {}),
      ...(title ? { title } : {}),
      ...(expectedPreviewSha256 ? { expectedPreviewSha256 } : {}),
    },
  };
}

function parseWorkflowOptions(
  values: Map<string, string>,
  flags: ReadonlySet<string>,
  jsonl: boolean,
): Extract<CliAction, { kind: "workflow" }> {
  return parseWorkflowOptionsDomain(values, flags, jsonl);
}

function parseToolResultMode(
  value: string | undefined,
): AgentMessageExperimentToolResultMode | undefined {
  if (value === undefined || value === "live") {
    return value === undefined ? undefined : "live";
  }
  if (value === "reuse-source") return "reuse_source";
  throw new Error("--tool-results must be live or reuse-source");
}
