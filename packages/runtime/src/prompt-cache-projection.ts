import type { Context } from "@earendil-works/pi-ai";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  projectToolSurface,
  ToolSurfaceProjection,
} from "./tool-surface-projection.js";

/** Run-local observations of actual invocation bytes. Prefix reuse is a
 * diagnostic, never a claim about the provider's cache implementation. */
export class PromptCacheProjection {
  private readonly toolSurface = new ToolSurfaceProjection();
  private previous?: {
    turnIndex: number;
    invocationIdentitySha256: string;
    system: Buffer;
    orderedToolDefinitionsSha256: string;
    messages: Array<{ contentSha256: string; bytes: number }>;
  };

  observe(input: {
    turnIndex: number;
    invocationIdentitySha256: string;
    contextEnvelopeSha256: string;
    context: Context;
  }) {
    const system = Buffer.from(input.context.systemPrompt ?? "", "utf8");
    const orderedToolDefinitionsSha256 = sha256(
      canonicalJson(projectToolSurface(input.context.tools)),
    );
    const previous = this.previous;
    const messages = input.context.messages.map((message) => {
      const serialized = canonicalJson(message);
      return {
        contentSha256: sha256(serialized),
        bytes: Buffer.byteLength(serialized),
      };
    });
    const sameInvocationIdentity =
      previous?.invocationIdentitySha256 === input.invocationIdentitySha256;
    const sameOrderedTools =
      previous?.orderedToolDefinitionsSha256 === orderedToolDefinitionsSha256;
    let commonSystemPrefixBytes = 0;
    if (previous && sameInvocationIdentity) {
      const end = Math.min(system.length, previous.system.length);
      while (
        commonSystemPrefixBytes < end &&
        system[commonSystemPrefixBytes] ===
          previous.system[commonSystemPrefixBytes]
      )
        commonSystemPrefixBytes++;
    }
    const sameSystemPrompt = previous?.system.equals(system) ?? false;
    let commonMessagePrefixCount = 0;
    let commonMessagePrefixBytes = 0;
    if (
      previous &&
      sameInvocationIdentity &&
      sameOrderedTools &&
      sameSystemPrompt
    ) {
      const end = Math.min(messages.length, previous.messages.length);
      while (
        commonMessagePrefixCount < end &&
        messages[commonMessagePrefixCount]!.contentSha256 ===
          previous.messages[commonMessagePrefixCount]!.contentSha256
      ) {
        commonMessagePrefixBytes += messages[commonMessagePrefixCount]!.bytes;
        commonMessagePrefixCount++;
      }
    }
    const content = {
      kind: "napier.prompt-cache-projection",
      schemaVersion: 2,
      measurement: "adjacent_invocation_utf8_prefix",
      providerCacheHit: "not_inferred",
      turnIndex: input.turnIndex,
      contextEnvelopeSha256: input.contextEnvelopeSha256,
      invocationIdentitySha256: input.invocationIdentitySha256,
      previousTurnIndex: previous?.turnIndex ?? null,
      systemPromptSha256: sha256(system),
      systemPromptBytes: system.length,
      orderedToolDefinitionsSha256,
      ...this.toolSurface.observe(input.context.tools),
      sameInvocationIdentity,
      sameOrderedTools,
      commonSystemPrefixBytes,
      sameSystemPrompt,
      messagePrefixMeasurement: "complete_canonical_messages_not_provider_wire",
      messageCount: messages.length,
      messageBytes: messages.reduce((sum, message) => sum + message.bytes, 0),
      messageDigestSetSha256: sha256(canonicalJson(messages)),
      commonMessagePrefixCount,
      commonMessagePrefixBytes,
      // Tool schemas may precede the system text on the provider wire. A
      // changed schema or serving identity therefore cannot claim reuse.
      schemaCompatibleSystemPrefixBytes: sameOrderedTools
        ? commonSystemPrefixBytes
        : 0,
    };
    this.previous = {
      turnIndex: input.turnIndex,
      invocationIdentitySha256: input.invocationIdentitySha256,
      system,
      orderedToolDefinitionsSha256,
      messages,
    };
    return { ...content, contentSha256: sha256(canonicalJson(content)) };
  }
}
