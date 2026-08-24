import type {
  SubagentCollectedOutcome,
  SubagentHandle,
  SubagentMessage,
  SubagentRequest,
  SubagentSnapshot,
} from "@napier/contracts/subagent-supervisor";

import { canonicalJson, sha256 } from "./ed25519.js";
import { createId, nowIso } from "./ids.js";
import type { SubagentContext, SubagentProvider } from "./subagent-provider.js";

const MAX_MESSAGE_CHARACTERS = 8_000;

export class SubagentSupervisor {
  constructor(private readonly provider: SubagentProvider) {}

  start(
    request: SubagentRequest,
    context: SubagentContext = {},
  ): Promise<SubagentHandle> {
    return this.provider.start(request, context);
  }

  async send(
    handle: SubagentHandle,
    input: { kind?: "steering" | "input"; text: string },
  ): Promise<SubagentMessage> {
    const text = normalizeMessageText(input.text);
    const content = {
      kind: "napier.subagent-message" as const,
      schemaVersion: 1 as const,
      id: createId("submsg"),
      taskId: handle.taskId,
      messageKind: input.kind ?? ("steering" as const),
      text,
      createdAt: nowIso(),
    };
    const message: SubagentMessage = {
      ...content,
      contentSha256: sha256(canonicalJson(content)),
    };
    await this.provider.send(handle, message);
    return message;
  }

  inspect(handle: SubagentHandle): Promise<SubagentSnapshot> {
    return this.provider.inspect(handle);
  }

  cancel(handle: SubagentHandle, reason: string): Promise<void> {
    const normalized = reason.replace(/\s+/gu, " ").trim();
    if (!normalized || normalized.length > 500) {
      throw new Error("Subagent cancellation reason is invalid");
    }
    return this.provider.cancel(handle, normalized);
  }

  collect(handle: SubagentHandle): Promise<SubagentCollectedOutcome> {
    return this.provider.collect(handle);
  }
}

function normalizeMessageText(value: string): string {
  const text = value.trim();
  if (
    !text ||
    text.length > MAX_MESSAGE_CHARACTERS ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)
  ) {
    throw new Error("Subagent message is outside its text bounds");
  }
  return text;
}
