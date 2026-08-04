import type {
  WebFetchResearchCapture,
  WebFetchSource,
} from "./web-fetch-model.js";

export function createWebFetchResearchCapture(
  source: WebFetchSource,
  maxChars: number,
): WebFetchResearchCapture {
  const selected = selectResearchLines(source.lines, maxChars);
  return {
    url: source.finalUrl,
    title: source.title,
    lines: selected.lines,
    textChars: selected.textChars,
    truncated: source.truncated || selected.truncated,
    webSourceContentSha256: source.contentSha256,
    webSourceBodySha256: source.bodySha256,
    webSourceFormat: source.format,
    webSourceLineCount: source.lineCount,
    webSourceRenderMode: source.renderMode,
    browserFallbackStatus: source.browserFallbackStatus,
    ...(source.browserFallbackDiagnostic
      ? { browserFallbackDiagnostic: source.browserFallbackDiagnostic }
      : {}),
    ...(source.browserFallback
      ? { browserFallback: structuredClone(source.browserFallback) }
      : {}),
  };
}

function selectResearchLines(
  lines: readonly string[],
  maxChars: number,
): { lines: string[]; textChars: number; truncated: boolean } {
  if (!Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > 24_000) {
    throw new Error("Web fetch Research Source limit is invalid");
  }
  const selected: string[] = [];
  let textChars = 0;
  let readableLineCount = 0;
  for (const original of lines) {
    const line = original.slice(0, 1_000).trim();
    if (!line) continue;
    readableLineCount += 1;
    if (selected.length >= 400) continue;
    const separator = selected.length > 0 ? 1 : 0;
    if (textChars + separator + line.length > maxChars) {
      const remaining = maxChars - textChars - separator;
      if (remaining > 0) {
        selected.push(line.slice(0, remaining));
        textChars += separator + remaining;
      }
      continue;
    }
    selected.push(line);
    textChars += separator + line.length;
  }
  if (selected.length === 0) {
    throw new Error("Web fetch Source has no research-readable text");
  }
  return {
    lines: selected,
    textChars,
    truncated: selected.length < readableLineCount || textChars >= maxChars,
  };
}
