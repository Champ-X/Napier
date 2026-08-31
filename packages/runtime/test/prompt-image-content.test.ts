import type { Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import {
  assertPromptImageCapability,
  promptUserContent,
} from "../src/prompt-image-content.js";

const image = { mimeType: "image/png" as const, data: "iVBORw==" };

describe("Prompt image content", () => {
  it("builds the Pi image content consumed by OpenAI-compatible providers", () => {
    expect(promptUserContent("Inspect this", [image])).toEqual([
      { type: "text", text: "Inspect this" },
      { type: "image", mimeType: "image/png", data: "iVBORw==" },
    ]);
    expect(promptUserContent("Text only", undefined)).toBe("Text only");
  });

  it("fails closed when attachments target a text-only or unknown model", () => {
    expect(() =>
      assertPromptImageCapability(model(["text", "image"]), [image]),
    ).not.toThrow();
    expect(() => assertPromptImageCapability(model(["text"]), [image])).toThrow(
      "Selected model does not support image input",
    );
    expect(() => assertPromptImageCapability(undefined, [image])).toThrow(
      "Selected model does not support image input",
    );
    expect(() =>
      assertPromptImageCapability(undefined, undefined),
    ).not.toThrow();
  });
});

function model(input: Model<"openai-completions">["input"]) {
  return { input } as Model<"openai-completions">;
}
