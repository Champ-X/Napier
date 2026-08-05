import {
  optionalModelRef,
  optionalResourceId,
  parseTimeout,
  requiredValue,
} from "./cli-option-values.js";
import { optionalCapabilityPreset } from "./cli-capability-options.js";
import { parseCredentialEnvironment } from "./cli-credential-options.js";
import type { CliExecutionOptions } from "./cli-execution-options.js";
import type { AgentCapabilityPresetId } from "@napier/contracts/agent-capabilities";
import type { RunEvent } from "@napier/contracts";

const MAX_PROMPT_BYTES = 64 * 1_024;
const MAX_TITLE_CHARS = 160;

export interface CliRunOptions extends CliExecutionOptions {
  prompt: string;
  agentId?: string;
  threadId?: string;
  sourceContinuityRunId?: string;
  title?: string;
  credentialEnv?: string;
  capabilityPreset?: AgentCapabilityPresetId;
}

export const RUN_VALUE_OPTIONS = new Set([
  "--workspace",
  "--data-root",
  "--prompt",
  "--model",
  "--credential-env",
  "--agent",
  "--preset",
  "--thread",
  "--source-run",
  "--title",
  "--timeout-ms",
]);

export function parseRunOptions(
  values: Map<string, string>,
  jsonl: boolean,
): { kind: "run"; options: CliRunOptions } {
  const workspace = requiredValue(values, "--workspace");
  const prompt = requiredValue(values, "--prompt");
  if (Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_BYTES) {
    throw new Error(`--prompt exceeds ${MAX_PROMPT_BYTES} UTF-8 bytes`);
  }
  const threadId = optionalResourceId(values, "--thread");
  const sourceContinuityRunId = optionalResourceId(values, "--source-run");
  const agentId = optionalResourceId(values, "--agent");
  if (threadId && values.has("--title")) {
    throw new Error("--title cannot be used with an existing --thread");
  }
  if (sourceContinuityRunId && !threadId) {
    throw new Error("--source-run requires an existing --thread");
  }
  const rawTitle = values.get("--title");
  const title = rawTitle?.trim();
  if (rawTitle !== undefined && (!title || title.length > MAX_TITLE_CHARS)) {
    throw new Error(`--title must be 1-${MAX_TITLE_CHARS} characters`);
  }
  const model = optionalModelRef(values);
  const credentialEnv = parseCredentialEnvironment(values, model);
  const capabilityPreset = optionalCapabilityPreset(values);
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
      ...(credentialEnv ? { credentialEnv } : {}),
      ...(capabilityPreset ? { capabilityPreset } : {}),
      ...(agentId ? { agentId } : {}),
      ...(threadId ? { threadId } : {}),
      ...(sourceContinuityRunId ? { sourceContinuityRunId } : {}),
      ...(title ? { title } : {}),
    },
  };
}

export function cliRunPromptOptions(
  options: CliRunOptions,
  threadId: string,
  signal: AbortSignal,
  onEvent?: (event: RunEvent) => Promise<void>,
) {
  return {
    threadId,
    text: options.prompt,
    ...(options.model ? { model: options.model } : {}),
    capabilityPreset: options.capabilityPreset,
    ...(options.sourceContinuityRunId
      ? { sourceContinuityRunId: options.sourceContinuityRunId }
      : {}),
    signal,
    ...(onEvent ? { onEvent } : {}),
  };
}
