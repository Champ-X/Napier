import type { JsonValue } from "@napier/contracts";

import { sha256 } from "./ed25519.js";

const PRIVATE_SOURCE_TOOLS = new Set([
  "research_source",
  "web_fetch",
  "web_fetch_save",
]);

export class PrivateSourceModelContentBoundary {
  private active = false;

  observeToolResult(toolName: string): void {
    if (PRIVATE_SOURCE_TOOLS.has(toolName)) {
      this.active = true;
    }
  }

  redact(defaultRedacted: boolean): boolean {
    return defaultRedacted || this.active;
  }

  modelProjection(input: {
    text: string;
    reasoning: string;
    defaultRedacted: boolean;
    error?: string;
  }): Record<string, JsonValue> {
    if (!this.redact(input.defaultRedacted)) {
      return { text: input.text, reasoning: input.reasoning };
    }
    return {
      textSha256: sha256(input.text),
      textBytes: Buffer.byteLength(input.text, "utf8"),
      reasoningSha256: sha256(input.reasoning),
      reasoningBytes: Buffer.byteLength(input.reasoning, "utf8"),
      contentRedacted: true,
      ...(input.error
        ? {
            errorSha256: sha256(input.error),
            errorBytes: Buffer.byteLength(input.error, "utf8"),
          }
        : {}),
    };
  }

  reasoningProjection(reasoning: string): Record<string, JsonValue> {
    return this.active
      ? {
          reasoningSha256: sha256(reasoning),
          reasoningBytes: Buffer.byteLength(reasoning, "utf8"),
          reasoningRedacted: true,
        }
      : { reasoning };
  }
}
