import { createHash } from "node:crypto";
import type { AssistantMessageEvent } from "@earendil-works/pi-ai";

export const MAX_THINKING_TRACE_BYTES = 128 * 1024;

export interface ModelThinkingTraceSnapshot {
  encoding: "utf8_deltas";
  observedBytes: number;
  observedChunks: number;
  observedSha256: string;
  capturedBytes: number;
  capturedSha256: string;
  truncated: boolean;
  text: string;
}

/** Private diagnostic prefix, independent of the output commit/loop policy.
 * It never scores progress, adds a prompt, or extends a deadline. */
export class ModelThinkingTrace {
  private readonly prefix = Buffer.alloc(MAX_THINKING_TRACE_BYTES);
  private readonly digest = createHash("sha256");
  private capturedBytes = 0;
  private observedBytes = 0;
  private observedChunks = 0;

  observeEvent(event: AssistantMessageEvent): void {
    if (event.type === "thinking_delta") this.observe(event.delta);
  }

  observe(delta: string): void {
    if (!delta) return;
    const bytes = Buffer.from(delta, "utf8");
    this.digest.update(bytes);
    this.observedBytes += bytes.length;
    this.observedChunks += 1;
    this.capturedBytes += bytes.copy(this.prefix, this.capturedBytes);
  }

  snapshot(): ModelThinkingTraceSnapshot {
    // A full buffer can end inside a UTF-8 codepoint. Drop only that incomplete
    // suffix; never insert replacement text into the recorded prefix.
    let end = this.capturedBytes;
    let text = "";
    for (let trim = 0; trim <= 3; trim += 1) {
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(
          this.prefix.subarray(0, end),
        );
        break;
      } catch {
        end -= 1;
      }
    }
    const capturedSha256 = createHash("sha256")
      .update(text, "utf8")
      .digest("hex");
    return {
      encoding: "utf8_deltas",
      observedBytes: this.observedBytes,
      observedChunks: this.observedChunks,
      observedSha256: this.digest.copy().digest("hex"),
      capturedBytes: Buffer.byteLength(text, "utf8"),
      capturedSha256,
      truncated: Buffer.byteLength(text, "utf8") < this.observedBytes,
      text,
    };
  }
}
