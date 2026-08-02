import {
  optionalModelRef,
  optionalResourceId,
  parseTimeout,
  requiredValue,
} from "./cli-option-values.js";
import type { CliExecutionOptions } from "./cli-execution-options.js";

const MAX_PROMPT_BYTES = 64 * 1_024;
const MAX_TITLE_CHARS = 160;
const CREDENTIAL_ENVIRONMENT = /^[A-Z_][A-Z0-9_]{1,127}$/u;

export interface CliRunOptions extends CliExecutionOptions {
  prompt: string;
  agentId?: string;
  threadId?: string;
  title?: string;
  credentialEnv?: string;
}

export const RUN_VALUE_OPTIONS = new Set([
  "--workspace",
  "--data-root",
  "--prompt",
  "--model",
  "--credential-env",
  "--agent",
  "--thread",
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
  const credentialEnv = values.get("--credential-env")?.trim();
  if (credentialEnv !== undefined) {
    if (!CREDENTIAL_ENVIRONMENT.test(credentialEnv)) {
      throw new Error("--credential-env is invalid");
    }
    if (!model || model.provider === "napier") {
      throw new Error("--credential-env requires a live --model");
    }
  }
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
      ...(agentId ? { agentId } : {}),
      ...(threadId ? { threadId } : {}),
      ...(title ? { title } : {}),
    },
  };
}
