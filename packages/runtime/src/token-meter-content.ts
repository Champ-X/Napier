import type { Context, Message, Tool } from "@earendil-works/pi-ai";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { TokenMeterContentClass } from "./token-meter-calibration.js";
import type { TokenMeterVisualItem } from "./token-meter-provider.js";

export function modelContextContentClass(
  context: Context,
): TokenMeterContentClass {
  if (context.messages.some(messageHasImage)) return "multimodal";
  if (
    (context.tools?.length ?? 0) > 0 ||
    context.messages.some(
      (message) =>
        message.role === "toolResult" ||
        (message.role === "assistant" &&
          message.content.some((item) => item.type === "toolCall")),
    )
  ) {
    return "structured";
  }
  return "text";
}

export function visualSafeSerialized(value: unknown): {
  text: string;
  contentSha256: string;
  visualItems: TokenMeterVisualItem[];
} {
  const visualItems: TokenMeterVisualItem[] = [];
  return {
    text: canonicalJson(visualSafeProjection(value, visualItems)),
    contentSha256: sha256(canonicalJson(value)),
    visualItems,
  };
}

export function modelContextMessageSetSha256(
  messages: readonly Message[],
): string {
  return sha256(
    canonicalJson(
      messages.map((message) => ({
        role: message.role,
        contentSha256: sha256(canonicalJson(message)),
      })),
    ),
  );
}

export function modelContextToolDefinitionSetSha256(
  tools: readonly Tool[],
): string {
  const digests = tools
    .map((tool) => ({
      nameSha256: sha256(tool.name),
      definitionSha256: sha256(canonicalJson(tokenMeterToolProjection(tool))),
    }))
    .sort((left, right) =>
      left.nameSha256 === right.nameSha256
        ? left.definitionSha256.localeCompare(right.definitionSha256)
        : left.nameSha256.localeCompare(right.nameSha256),
    );
  return sha256(canonicalJson(digests));
}

export function tokenMeterToolProjection(tool: Tool): unknown {
  return {
    name: tool.name,
    description: tool.description ?? null,
    parameters: tool.parameters ?? null,
    constrainedSampling: tool.constrainedSampling ?? null,
  };
}

function messageHasImage(message: Message): boolean {
  if (message.role === "assistant" || typeof message.content === "string") {
    return false;
  }
  return message.content.some((item) => item.type === "image");
}

function visualSafeProjection(
  value: unknown,
  visualItems: TokenMeterVisualItem[],
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => visualSafeProjection(item, visualItems));
  }
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (
    record["type"] === "image" &&
    typeof record["data"] === "string" &&
    typeof record["mimeType"] === "string"
  ) {
    const visual = {
      mimeType: record["mimeType"],
      encodedBytes: Buffer.byteLength(record["data"], "utf8"),
      contentSha256: sha256(record["data"]),
    };
    visualItems.push(visual);
    return { type: "image", ...visual };
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [
      key,
      visualSafeProjection(item, visualItems),
    ]),
  );
}
