import type { ModelRef } from "@napier/contracts";

import {
  optionalModelRef,
  optionalResourceId,
  parseTimeout,
  requiredValue,
} from "./cli-option-values.js";
import { parseCredentialEnvironment } from "./cli-credential-options.js";

const MAX_TITLE_CHARS = 160;

export interface CliChatOptions {
  workspace: string;
  dataRoot?: string;
  jsonl: boolean;
  model?: ModelRef;
  timeoutMs: number;
  agentId?: string;
  threadId?: string;
  title?: string;
  credentialEnv?: string;
}

export interface CliChatAction {
  kind: "chat";
  options: CliChatOptions;
}

export interface CliTuiAction {
  kind: "tui";
  options: CliChatOptions;
}

export const CHAT_VALUE_OPTIONS = new Set([
  "--workspace",
  "--data-root",
  "--model",
  "--credential-env",
  "--agent",
  "--thread",
  "--title",
  "--timeout-ms",
]);

export function parseChatOptions(
  values: Map<string, string>,
  jsonl: boolean,
): CliChatAction {
  return {
    kind: "chat",
    options: parseInteractiveOptions(values, jsonl, "chat"),
  };
}

export function parseTuiOptions(
  values: Map<string, string>,
  jsonl: boolean,
): CliTuiAction {
  return {
    kind: "tui",
    options: parseInteractiveOptions(values, jsonl, "tui"),
  };
}

function parseInteractiveOptions(
  values: Map<string, string>,
  jsonl: boolean,
  command: "chat" | "tui",
): CliChatOptions {
  if (jsonl) throw new Error(`--jsonl cannot be used with ${command}`);
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
  const credentialEnv = parseCredentialEnvironment(values, model);
  return {
    workspace: requiredValue(values, "--workspace"),
    timeoutMs: parseTimeout(values.get("--timeout-ms")),
    jsonl: false,
    ...(values.has("--data-root")
      ? { dataRoot: requiredValue(values, "--data-root") }
      : {}),
    ...(model ? { model } : {}),
    ...(credentialEnv ? { credentialEnv } : {}),
    ...(agentId ? { agentId } : {}),
    ...(threadId ? { threadId } : {}),
    ...(title ? { title } : {}),
  };
}
