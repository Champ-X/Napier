import type {
  AgentMessageExperimentToolResultMode,
  ModelRef,
} from "@napier/contracts";

import {
  CHAT_VALUE_OPTIONS,
  parseChatOptions,
  type CliChatAction,
} from "./cli-chat-options.js";
import {
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  optionalModelRef,
  optionalResourceId,
  parseTimeout,
  requiredResourceId,
  requiredValue,
} from "./cli-option-values.js";
import {
  parseWorkflowOptions as parseWorkflowOptionsDomain,
  WORKFLOW_FLAG_OPTIONS,
  WORKFLOW_VALUE_OPTIONS,
  type CliWorkflowOptions,
} from "./cli-workflow-options.js";

export type { CliWorkflowOptions };

export const CLI_VERSION = "0.1.0";
const MAX_PROMPT_BYTES = 64 * 1_024;
const MAX_TITLE_CHARS = 160;
const MAX_BRANCH_TITLE_CHARS = 100;

export interface CliWorkspaceOptions {
  workspace: string;
  dataRoot?: string;
  jsonl: boolean;
}

export interface CliExecutionOptions extends CliWorkspaceOptions {
  model?: ModelRef;
  timeoutMs: number;
}

export interface CliRunOptions extends CliExecutionOptions {
  prompt: string;
  agentId?: string;
  threadId?: string;
  title?: string;
}

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
  | { kind: "run"; options: CliRunOptions }
  | CliChatAction
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

const RUN_VALUE_OPTIONS = new Set([
  "--workspace",
  "--data-root",
  "--prompt",
  "--model",
  "--agent",
  "--thread",
  "--title",
  "--timeout-ms",
]);
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
  const command = argv[0];
  if (
    command !== "run" &&
    command !== "chat" &&
    command !== "resume" &&
    command !== "branch" &&
    command !== "experiment" &&
    command !== "model-experiment" &&
    command !== "tool-experiment" &&
    command !== "rpc" &&
    command !== "workflow"
  ) {
    throw new Error("Unknown command");
  }
  if (argv.length === 2 && (argv[1] === "--help" || argv[1] === "-h")) {
    return { kind: "help" };
  }
  const { values, flags, jsonl } = parseOptions(
    argv.slice(1),
    command === "run"
      ? RUN_VALUE_OPTIONS
      : command === "chat"
        ? CHAT_VALUE_OPTIONS
        : command === "resume"
          ? RESUME_VALUE_OPTIONS
          : command === "branch"
            ? BRANCH_VALUE_OPTIONS
            : command === "experiment"
              ? EXPERIMENT_VALUE_OPTIONS
              : command === "model-experiment"
                ? MODEL_EXPERIMENT_VALUE_OPTIONS
                : command === "tool-experiment"
                  ? TOOL_EXPERIMENT_VALUE_OPTIONS
                  : command === "rpc"
                    ? RPC_VALUE_OPTIONS
                    : WORKFLOW_VALUE_OPTIONS,
    command === "workflow"
      ? WORKFLOW_FLAG_OPTIONS
      : command === "experiment"
        ? EXPERIMENT_FLAG_OPTIONS
        : command === "model-experiment"
          ? MODEL_EXPERIMENT_FLAG_OPTIONS
          : command === "tool-experiment"
            ? TOOL_EXPERIMENT_FLAG_OPTIONS
            : new Set(),
  );
  if (command === "run") return parseRunOptions(values, jsonl);
  if (command === "chat") return parseChatOptions(values, jsonl);
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

function parseRunOptions(
  values: Map<string, string>,
  jsonl: boolean,
): Extract<CliAction, { kind: "run" }> {
  const workspace = requiredValue(values, "--workspace");
  const prompt = requiredValue(values, "--prompt");
  if (Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_BYTES) {
    throw new Error(`--prompt exceeds ${MAX_PROMPT_BYTES} UTF-8 bytes`);
  }
  const threadId = optionalResourceId(values, "--thread");
  const agentId = optionalResourceId(values, "--agent");
  if (threadId && values.has("--title")) {
    throw new Error("--title cannot be used with an existing --thread");
  }
  const rawTitle = values.get("--title");
  const title = rawTitle?.trim();
  if (rawTitle !== undefined && (!title || title.length > MAX_TITLE_CHARS)) {
    throw new Error(`--title must be 1-${MAX_TITLE_CHARS} characters`);
  }
  const model = optionalModelRef(values);
  return {
    kind: "run",
    options: {
      workspace,
      prompt,
      timeoutMs: parseTimeout(values.get("--timeout-ms")),
      jsonl,
      ...(values.has("--data-root")
        ? { dataRoot: requiredValue(values, "--data-root") }
        : {}),
      ...(model ? { model } : {}),
      ...(agentId ? { agentId } : {}),
      ...(threadId ? { threadId } : {}),
      ...(title ? { title } : {}),
    },
  };
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

function parseOptions(
  argv: string[],
  allowedValues: ReadonlySet<string>,
  allowedFlags: ReadonlySet<string> = new Set(),
): {
  values: Map<string, string>;
  flags: Set<string>;
  jsonl: boolean;
} {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  let jsonl = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (flag === "--jsonl") {
      if (jsonl) throw new Error("Duplicate option: --jsonl");
      jsonl = true;
      continue;
    }
    if (allowedFlags.has(flag)) {
      if (flags.has(flag)) throw new Error(`Duplicate option: ${flag}`);
      flags.add(flag);
      continue;
    }
    if (!allowedValues.has(flag)) throw new Error("Unknown option");
    if (values.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    values.set(flag, value);
    index += 1;
  }
  return { values, flags, jsonl };
}

function parsePositiveInteger(value: string, flag: string): number {
  if (!/^[0-9]+$/u.test(value)) throw new Error(`${flag} is invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string, flag: string): number {
  if (!/^[0-9]+$/u.test(value)) throw new Error(`${flag} is invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return parsed;
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

export const CLI_HELP = `Napier CLI ${CLI_VERSION}

Usage:
  napier run --workspace <path> --prompt <text> [options]
  napier chat --workspace <path> [options]
  napier resume --workspace <path> --thread <thread-id> [options]
  napier branch --workspace <path> --thread <thread-id> --from-seq <n> [options]
  napier experiment --workspace <path> --thread <thread-id> --run <run-id> --message-seq <n> [options]
  napier model-experiment --workspace <path> --thread <thread-id> --run <run-id> --turn-index <n> [options]
  napier tool-experiment --workspace <path> --thread <thread-id> --run <run-id> --call-id <id> [options]
  napier rpc --workspace <path> [options]
  napier workflow --workspace <path> --manifest <path> [options]

Commands:
  run                    Start a new Run on a new or existing Thread
  chat                   Open a multi-turn interactive Agent session
  resume                 Continue an interrupted Run as a linked child
  branch                 Fork message history at an exact Ledger sequence
  experiment             Re-run a historical Agent message read-only
  model-experiment       Re-run one captured provider call without tools
  tool-experiment        Re-run one captured built-in read-only tool call
  rpc                    Serve local JSON-RPC 2.0 over stdio
  workflow               Execute or resume a typed Plan/Blueprint Workflow

Workspace options:
  --data-root <path>     Napier state directory (default: <workspace>/.napier)
  --jsonl                Emit StreamFrame JSON objects on stdout

Run and resume options:
  --model <provider/id>  Model for this Run
  --timeout-ms <ms>      External wall-time limit (${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS})

Chat options:
  --agent <agent-id>     Agent for the first new Thread
  --thread <thread-id>   Continue this existing Thread
  --title <text>         Title for the first new Thread
  --model <provider/id>  Initial model; switch later with /model

Run options:
  --prompt <text>        User prompt for the Run
  --agent <agent-id>     Agent for a new Thread
  --thread <thread-id>   Append to an existing Thread
  --title <text>         Title for a new Thread

Resume options:
  --thread <thread-id>   Waiting Thread containing an interrupted Run
  --run <run-id>         Specific interrupted Run (default: latest)

Branch options:
  --thread <thread-id>   Source Thread
  --from-seq <n>         Existing source Ledger sequence
  --title <text>         Optional branch title

Agent experiment options:
  --thread <thread-id>   Source Agent Thread
  --run <run-id>         Terminal source user Run
  --message-seq <n>      Exact source message Ledger sequence
  --model <provider/id>  Optional candidate model
  --title <text>         Optional isolated target title
  --tool-results <mode>  live (default) or reuse-source
  --preview              Preview frozen inputs without mutation
  --expected-preview     Required preview SHA-256 for execution
  --timeout-ms <ms>      External wall-time limit (${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS})

Model invocation experiment options:
  --thread <thread-id>   Source Agent Thread
  --run <run-id>         Terminal source Run with a local call capsule
  --turn-index <n>       Zero-based source model context turn
  --model <provider/id>  Optional candidate provider-backed model
  --title <text>         Optional isolated target title
  --preview              Preview frozen provider context without mutation
  --expected-preview     Required preview SHA-256 for execution
  --timeout-ms <ms>      External wall-time limit (${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS})

Tool invocation experiment options:
  --thread <thread-id>   Source Agent Thread
  --run <run-id>         Terminal source Run with a local tool capsule
  --call-id <id>         Exact source tool call ID
  --title <text>         Optional isolated target title
  --preview              Preview frozen arguments and current scope
  --expected-preview     Required preview SHA-256 for execution
  --timeout-ms <ms>      External wall-time limit (${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS})

RPC options:
  --workspace <path>     Workspace served by the long-lived Runtime
  --data-root <path>     Napier state directory (default: <workspace>/.napier)

Workflow options:
  --manifest <path>      Workspace-relative Workflow manifest JSON
  --input-json <json>    Typed input for a new Workflow
  --thread <thread-id>   Existing target Thread
  --agent <agent-id>     Agent for a new target Thread
  --title <text>         Title for a new target Thread
  --plan <plan-id>       Resume an existing Workflow Plan
  --retry-blocked        Explicitly reopen retryable blocked nodes
  --break-before <ids>   Pause before comma-separated node IDs
  --continue-breakpoint  Explicitly continue the open Workflow breakpoint
  --approve              Approve the open Workflow Approval node, then resume
  --reject               Reject the open Workflow Approval node, then resume
  --decision-note <text> Optional answer note used with --approve/--reject
  --from-node <node-id>  Fork an experiment from this Workflow node
  --single-node          Execute selected checkpoint; hold direct successors
  --step-nodes           Execute one node, then step through the rerun subgraph
  --simulate-output-json Simulate checkpoint output, then execute descendants
  --replace-input-json  Replace checkpoint input, then execute its subgraph
  --replace-workflow-input-json Replace top-level input and rerun the Workflow
  --model-overrides-json Per-node ModelRef overrides for rerun nodes
  --preview-experiment   Preview a checkpoint experiment without mutation
  --confirm-side-effects Confirm the exact current side-effect preview
  --expected-preview     SHA-256 returned by experiment preview

Other:
  -h, --help             Show help
  -v, --version          Show version
`;
