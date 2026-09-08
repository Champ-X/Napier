import type { Context, Message } from "@earendil-works/pi-ai";
import { canonicalJson, sha256 } from "./ed25519.js";
import { visualSafeSerialized } from "./token-meter-content.js";

export interface CompleteContextUnit {
  start: number;
  end: number;
  user: boolean;
}

/** A parallel tool batch is indivisible; no pending call may enter a checkpoint. */
export function completeContextUnits(
  messages: readonly Message[],
): CompleteContextUnit[] {
  const units: CompleteContextUnit[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    if (message.role === "toolResult")
      throw new Error("Run context contains an orphan tool result");
    const start = index;
    if (message.role === "assistant") {
      const calls = message.content.filter((item) => item.type === "toolCall");
      const pending = new Map(calls.map((call) => [call.id, call.name]));
      if (pending.size !== calls.length)
        throw new Error("Run context contains duplicate tool calls");
      for (const call of calls) {
        if (seen.has(call.id))
          throw new Error("Run context reuses a tool call ID");
        seen.add(call.id);
      }
      for (let count = 0; count < calls.length; count++) {
        const result = messages[++index];
        if (
          result?.role !== "toolResult" ||
          pending.get(result.toolCallId) !== result.toolName
        )
          throw new Error("Run context tool exchange is incomplete");
        pending.delete(result.toolCallId);
      }
    }
    units.push({ start, end: index + 1, user: message.role === "user" });
  }
  return units;
}

/** Request extensions may prune result text, but cannot change the source identities. */
export function contextCorrespondsToSource(
  source: Context,
  active: Context,
): boolean {
  return (
    source.messages.length === active.messages.length &&
    source.messages.every((message, index) => {
      const candidate = active.messages[index]!;
      if (message.role !== "toolResult" || candidate.role !== "toolResult")
        return canonicalJson(message) === canonicalJson(candidate);
      const { content: _source, ...identity } = message;
      const { content: _active, ...otherIdentity } = candidate;
      return canonicalJson(identity) === canonicalJson(otherIdentity);
    })
  );
}

export function pinnedContextUsers(messages: readonly Message[]): Message[] {
  return messages.filter((message) => message.role === "user");
}

/** Bounded, data-only evidence. Image payloads and private reasoning are never copied. */
export function contextUnitEvidence(
  messages: readonly Message[],
  unit: CompleteContextUnit,
  maximumCharacters = 24_000,
): string {
  return messages
    .slice(unit.start, unit.end)
    .map((message, offset) => {
      const projected =
        message.role === "assistant"
          ? {
              ...message,
              content: message.content.filter(
                (item) => item.type !== "thinking",
              ),
            }
          : message;
      const text = visualSafeSerialized(projected).text;
      const limit = Math.max(
        256,
        Math.min(
          message.role === "user" ? 4_000 : 6_000,
          Math.floor(maximumCharacters / (unit.end - unit.start)),
        ),
      );
      const body =
        text.length <= limit
          ? text
          : `${text.slice(0, (limit * 2) / 3)}\n[Evidence excerpt; ${text.length} characters; SHA-256 ${sha256(text)}]\n${text.slice(-limit / 3)}`;
      return `Message ${unit.start + offset}: ${body.replaceAll("<", "\\u003c").replaceAll(">", "\\u003e")}`;
    })
    .join("\n");
}
