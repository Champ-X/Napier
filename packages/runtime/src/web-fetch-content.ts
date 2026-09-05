import {
  MAX_WEB_FETCH_CONTENT_CHARS,
  MAX_WEB_FETCH_LINES,
  MAX_WEB_FETCH_PDF_PAGES,
  WEB_FETCH_PARSE_TIMEOUT_MS,
  type ParsedWebContent,
  type WebFetchSourceFormat,
} from "./web-fetch-model.js";
import { hasConservativeBrowserShell } from "./web-fetch-browser-shell.js";
import {
  detectWebFetchImage,
  type WebFetchImageType,
} from "./web-fetch-image.js";

const TEXT_MIMES = new Set([
  "application/javascript",
  "application/sql",
  "application/xml",
  "application/x-javascript",
  "application/yaml",
  "text/css",
  "text/csv",
  "text/javascript",
  "text/tab-separated-values",
  "text/xml",
  "text/yaml",
]);

export async function parseWebFetchBody(input: {
  body: Buffer;
  contentType: string;
  finalUrl: string;
  signal?: AbortSignal;
  allowPdfWithoutText?: boolean;
}): Promise<ParsedWebContent> {
  throwIfAborted(input.signal);
  const mime = normalizeMime(input.contentType);
  const image = detectWebFetchImage(input.body);
  if (image) {
    return parseImageBody(input.body, input.finalUrl, image);
  }
  if (
    mime === "application/pdf" ||
    urlExtension(input.finalUrl) === ".pdf" ||
    input.body.subarray(0, 5).toString("ascii") === "%PDF-"
  ) {
    return parsePdfBody(
      input.body,
      input.signal,
      input.allowPdfWithoutText === true,
    );
  }
  const text = decodeUtf8(input.body);
  if (
    mime === "text/html" ||
    mime === "application/xhtml+xml" ||
    looksLikeHtml(text)
  ) {
    return parseHtmlBody(text, input.finalUrl, input.signal);
  }
  if (
    mime === "application/json" ||
    mime.endsWith("+json") ||
    urlExtension(input.finalUrl) === ".json" ||
    ((!mime || mime === "application/octet-stream") && looksLikeJson(text))
  ) {
    return parseJsonBody(text, input.finalUrl);
  }
  if (
    mime.startsWith("text/") ||
    TEXT_MIMES.has(mime) ||
    ((!mime || mime === "application/octet-stream") &&
      looksLikeText(input.body))
  ) {
    return parseTextBody(
      text,
      input.finalUrl,
      textFormat(mime, input.finalUrl),
    );
  }
  throw new Error(
    `Web fetch content type is unsupported: ${mime || "unknown"}`,
  );
}

function parseImageBody(
  body: Buffer,
  finalUrl: string,
  image: WebFetchImageType,
): ParsedWebContent {
  const title =
    decodeUrlFilename(finalUrl) || `Image (${image.kind.toUpperCase()})`;
  return finalizeContent({
    format: "image",
    title,
    text: `[Image source: ${title}; ${image.mime}; ${body.byteLength} bytes]`,
  });
}

async function parsePdfBody(
  body: Buffer,
  signal?: AbortSignal,
  allowWithoutText = false,
): Promise<ParsedWebContent> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const operationSignal = boundedParseSignal(signal);
  throwIfAborted(operationSignal);
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(body),
    useSystemFonts: true,
    stopAtErrors: true,
  });
  const abort = () => {
    void loadingTask.destroy();
  };
  operationSignal.addEventListener("abort", abort, { once: true });
  try {
    const document = await loadingTask.promise;
    if (document.numPages > MAX_WEB_FETCH_PDF_PAGES) {
      throw new Error(`PDF page count exceeds ${MAX_WEB_FETCH_PDF_PAGES}`);
    }
    const metadata = await document.getMetadata().catch(() => undefined);
    const info = record(metadata?.info);
    const blocks: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      throwIfAborted(operationSignal);
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({
        disableNormalization: false,
      });
      const text = content.items
        .flatMap((item) =>
          item && typeof item === "object" && "str" in item
            ? [String(item.str)]
            : [],
        )
        .join(" ")
        .replace(/\s+/gu, " ")
        .trim();
      if (text) blocks.push(`## Page ${pageNumber}\n\n${text}`);
    }
    if (blocks.length === 0) {
      if (!allowWithoutText) {
        throw new Error("PDF contains no extractable text");
      }
      blocks.push("[PDF contains no extractable text; raw bytes only]");
    }
    return finalizeContent({
      format: "pdf",
      title: textField(info?.["Title"]) || "PDF document",
      ...(textField(info?.["Author"])
        ? { author: textField(info?.["Author"]) }
        : {}),
      ...(normalizePdfDate(textField(info?.["CreationDate"]))
        ? {
            publishedAt: normalizePdfDate(textField(info?.["CreationDate"]))!,
          }
        : {}),
      text: blocks.join("\n\n"),
      pageCount: document.numPages,
    });
  } catch (error) {
    if (operationSignal.aborted) throw cancellationError(operationSignal);
    throw new Error(
      `PDF text extraction failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  } finally {
    operationSignal.removeEventListener("abort", abort);
    await loadingTask.destroy().catch(() => undefined);
  }
}

async function parseHtmlBody(
  html: string,
  finalUrl: string,
  signal?: AbortSignal,
): Promise<ParsedWebContent> {
  const operationSignal = boundedParseSignal(signal);
  const [{ Readability }, { parseHTML }] = await Promise.all([
    import("@mozilla/readability"),
    import("linkedom"),
  ]);
  throwIfAborted(operationSignal);
  const { document } = parseHTML(html);
  Object.defineProperty(document, "documentURI", {
    configurable: true,
    value: finalUrl,
  });
  for (const element of document.querySelectorAll(
    "script, style, noscript, template, svg",
  )) {
    element.remove();
  }
  const articleHeading = normalizeText(
    document.querySelector("h1")?.textContent,
  );
  const fallbackTitle =
    normalizeText(document.title) || new URL(finalUrl).hostname;
  const fallbackText = normalizeParagraphs(document.body?.textContent ?? "");
  const fallbackPublishedAt = htmlMetadata(
    document,
    "article:published_time",
    "date",
  );
  const result = new Readability(document, {
    charThreshold: 100,
    keepClasses: false,
  }).parse();
  throwIfAborted(operationSignal);
  const title = articleHeading || normalizeText(result?.title) || fallbackTitle;
  const bodyText = readableHtmlText(result?.content ?? "") || fallbackText;
  if (!bodyText && !hasConservativeBrowserShell(html)) {
    throw new Error("HTML page contains no readable text");
  }
  return finalizeContent({
    format: "html",
    title,
    ...(normalizeText(result?.byline)
      ? { author: normalizeText(result?.byline) }
      : {}),
    ...(normalizeText(result?.publishedTime) || fallbackPublishedAt
      ? {
          publishedAt:
            normalizeText(result?.publishedTime) || fallbackPublishedAt!,
        }
      : {}),
    text: `# ${title}${bodyText ? `\n\n${bodyText}` : ""}`,
  });
}

function parseJsonBody(text: string, finalUrl: string): ParsedWebContent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Web fetch JSON is invalid");
  }
  return finalizeContent({
    format: "json",
    title:
      new URL(finalUrl).pathname.split("/").filter(Boolean).at(-1) || "JSON",
    text: JSON.stringify(parsed, null, 2),
  });
}

function parseTextBody(
  text: string,
  finalUrl: string,
  format: WebFetchSourceFormat,
): ParsedWebContent {
  const normalized = normalizeNewlines(text).trim();
  if (!normalized) throw new Error("Web fetch text body is empty");
  return finalizeContent({
    format,
    title:
      new URL(finalUrl).pathname.split("/").filter(Boolean).at(-1) || "Text",
    text: normalized,
  });
}

function finalizeContent(input: {
  format: WebFetchSourceFormat;
  title: string;
  author?: string;
  publishedAt?: string;
  text: string;
  pageCount?: number;
}): ParsedWebContent {
  const full = normalizeNewlines(input.text).trim();
  const textTruncated = full.length > MAX_WEB_FETCH_CONTENT_CHARS;
  const bounded = full.slice(0, MAX_WEB_FETCH_CONTENT_CHARS);
  const allLines = bounded.split("\n");
  const lineTruncated = allLines.length > MAX_WEB_FETCH_LINES;
  const lines = allLines.slice(0, MAX_WEB_FETCH_LINES);
  return {
    format: input.format,
    title: normalizeText(input.title).slice(0, 500),
    ...(input.author
      ? { author: normalizeText(input.author).slice(0, 300) }
      : {}),
    ...(input.publishedAt
      ? { publishedAt: normalizeText(input.publishedAt).slice(0, 120) }
      : {}),
    lines,
    truncated: textTruncated || lineTruncated,
    ...(input.pageCount !== undefined ? { pageCount: input.pageCount } : {}),
  };
}

function normalizeParagraphs(value: string): string {
  return normalizeNewlines(value)
    .split("\n")
    .map((line) => line.replace(/[ \t]+/gu, " ").trim())
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function readableHtmlText(value: string): string {
  if (!value) return "";
  return normalizeParagraphs(
    decodeHtmlText(
      value
        .replace(/<br\b[^>]*>/giu, "\n")
        .replace(
          /<\/?(?:article|aside|blockquote|div|figcaption|figure|footer|h[1-6]|header|li|main|nav|ol|p|pre|section|table|tbody|td|th|thead|tr|ul)\b[^>]*>/giu,
          "\n",
        ),
    ),
  );
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/gu, " ").trim();
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/gu, "\n").replace(/\u0000/gu, "");
}

function normalizeMime(contentType: string): string {
  return contentType.split(";", 1)[0]!.trim().toLowerCase();
}

function textFormat(mime: string, finalUrl: string): WebFetchSourceFormat {
  return mime.includes("markdown") ||
    /\.(?:md|mdown|markdown)$/iu.test(finalUrl)
    ? "markdown"
    : "text";
}

function looksLikeHtml(value: string): boolean {
  return /<!doctype\s+html|<html\b|<body\b|<article\b/iu.test(
    value.slice(0, 8_192),
  );
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function looksLikeText(value: Buffer): boolean {
  return !value.subarray(0, 8_192).includes(0);
}

function decodeUtf8(value: Buffer): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(value);
}

function decodeUrlFilename(value: string): string {
  const filename = new URL(value).pathname.split("/").filter(Boolean).at(-1);
  if (!filename) return "";
  try {
    return decodeURIComponent(filename);
  } catch {
    return filename;
  }
}

function urlExtension(value: string): string {
  try {
    return (
      new URL(value).pathname.toLowerCase().match(/\.[a-z0-9]{1,10}$/u)?.[0] ??
      ""
    );
  } catch {
    return "";
  }
}

function htmlMetadata(
  document: Document,
  property: string,
  itemProp: string,
): string | undefined {
  return (
    document
      .querySelector(`meta[property="${property}"]`)
      ?.getAttribute("content") ??
    document
      .querySelector(`meta[itemprop="${itemProp}"]`)
      ?.getAttribute("content") ??
    undefined
  );
}

function normalizePdfDate(value: string): string | undefined {
  const match = /^D:(\d{4})(\d{2})(\d{2})/u.exec(value);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : value || undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function textField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw cancellationError(signal);
}

function cancellationError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Web fetch was cancelled");
}

function boundedParseSignal(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(WEB_FETCH_PARSE_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function decodeHtmlText(value: string): string {
  return value
    .replace(/<[^>]*>/gu, " ")
    .replace(/&#(\d+);/gu, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/giu, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&apos;|&#39;/giu, "'");
}
