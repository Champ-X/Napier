import type { AssistantMessageEvent } from "@earendil-works/pi-ai";

import { sha256 } from "./ed25519.js";
import type { ModelThinkingLoopEvidence } from "./model-thinking-loop-policy.js";
import { parseModelTurnWatchdogError } from "./model-turn-deadline.js";

export class ModelSemanticStallObserver {
  private thinkingBytes = 0;
  private thinkingChunks = 0;
  private executableProgress = false;

  observe(event: AssistantMessageEvent): void {
    if (event.type === "thinking_delta") {
      this.thinkingChunks += 1;
      this.thinkingBytes += Buffer.byteLength(event.delta, "utf8");
      return;
    }
    if (hasExecutableProgress(event)) this.executableProgress = true;
  }

  evidence(
    diagnostic: string | undefined,
    attempt: 1 | 2,
  ): ModelThinkingLoopEvidence | undefined {
    const watchdog = parseModelTurnWatchdogError(diagnostic);
    if (
      watchdog?.evidence.reason !== "semantic_progress_timeout" ||
      this.executableProgress ||
      this.thinkingBytes < 1 ||
      this.thinkingChunks < 1
    ) {
      return undefined;
    }
    const unit = "semantic_progress_timeout";
    return {
      reason: "semantic_stall",
      attempt,
      observedBytes: this.thinkingBytes,
      observedThinkingChunks: this.thinkingChunks,
      repeatedUnitBytes: Buffer.byteLength(unit, "utf8"),
      repeatedUnitSha256: sha256(unit),
    };
  }

  terminalEvidence(
    event: AssistantMessageEvent,
    attempt: 1 | 2,
  ): ModelThinkingLoopEvidence | undefined {
    if (event.type === "error")
      return this.evidence(event.error.errorMessage, attempt);
    if (
      event.type !== "done" ||
      this.executableProgress ||
      !["stop", "length"].includes(event.message.stopReason)
    )
      return undefined;
    const blocks = event.message.content;
    // Terminal content is authoritative even when a provider omits deltas.
    if (
      blocks.some(
        (b) =>
          b.type === "toolCall" ||
          (b.type === "text" && b.text.trim().length > 0),
      )
    )
      return undefined;
    const thinking = blocks.filter((b) => b.type === "thinking");
    const bytes = Math.max(
      this.thinkingBytes,
      thinking.reduce((n, b) => n + Buffer.byteLength(b.thinking, "utf8"), 0),
    );
    if (bytes === 0) return undefined;
    const unit = `thinking_only_terminal:${event.message.stopReason}`;
    return {
      reason: "thinking_only_terminal",
      attempt,
      observedBytes: bytes,
      observedThinkingChunks: Math.max(this.thinkingChunks, thinking.length),
      repeatedUnitBytes: Buffer.byteLength(unit, "utf8"),
      repeatedUnitSha256: sha256(unit),
    };
  }
}

function hasExecutableProgress(event: AssistantMessageEvent): boolean {
  if (event.type === "text_delta" || event.type === "toolcall_delta") {
    return event.delta.trim().length > 0;
  }
  if (event.type === "text_end") return event.content.trim().length > 0;
  return event.type === "toolcall_end";
}
