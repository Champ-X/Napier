import type { Api, Model, UserMessage } from "@earendil-works/pi-ai";
import type { PromptImageInput } from "@napier/contracts";

export function assertPromptImageCapability(
  model: Model<Api> | undefined,
  images: readonly PromptImageInput[] | undefined,
): void {
  if (!images?.length) return;
  if (!model?.input.includes("image")) {
    throw new Error("Selected model does not support image input");
  }
}

export function promptUserContent(
  text: string,
  images: readonly PromptImageInput[] | undefined,
): UserMessage["content"] {
  if (!images?.length) return text;
  return [
    { type: "text", text },
    ...images.map((image) => ({
      type: "image" as const,
      data: image.data,
      mimeType: image.mimeType,
    })),
  ];
}
