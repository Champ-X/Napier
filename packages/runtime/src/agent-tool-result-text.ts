export function agentToolResultText(result: unknown): string {
  if (
    !result ||
    typeof result !== "object" ||
    !("content" in result) ||
    !Array.isArray(result.content)
  ) {
    return String(result ?? "");
  }
  return result.content
    .filter((item): item is { type: "text"; text: string } => {
      return Boolean(
        item &&
        typeof item === "object" &&
        item.type === "text" &&
        typeof item.text === "string",
      );
    })
    .map((item) => item.text)
    .join("\n");
}
