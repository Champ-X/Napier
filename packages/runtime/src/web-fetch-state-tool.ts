export function isWebFetchStateToolName(
  value: unknown,
): value is "web_fetch" | "web_fetch_save" {
  return value === "web_fetch" || value === "web_fetch_save";
}
