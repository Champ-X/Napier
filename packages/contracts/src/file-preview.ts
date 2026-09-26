/** Shared file preview classification and bounded decoding; no platform APIs. */
export const MAX_WORKSPACE_FILE_PREVIEW_BYTES = 128 * 1024 * 1024;
export const MAX_TEXT_FILE_PREVIEW_BYTES = 2 * 1024 * 1024;

const TEXT = "text/plain; charset=utf-8";
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
  htm: "text/html; charset=utf-8",
  html: "text/html; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  mdx: "text/markdown; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  css: "text/css; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  tsv: "text/tab-separated-values; charset=utf-8",
  tab: "text/tab-separated-values; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  cjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  jsonl: "application/x-ndjson; charset=utf-8",
  ndjson: "application/x-ndjson; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  yaml: "text/yaml; charset=utf-8",
  yml: "text/yaml; charset=utf-8",
  c: TEXT,
  cc: TEXT,
  cpp: TEXT,
  h: TEXT,
  hpp: TEXT,
  go: TEXT,
  java: TEXT,
  jsx: TEXT,
  kt: TEXT,
  kts: TEXT,
  less: TEXT,
  php: TEXT,
  py: TEXT,
  rb: TEXT,
  rs: TEXT,
  sass: TEXT,
  scss: TEXT,
  sh: TEXT,
  sql: TEXT,
  toml: TEXT,
  ts: TEXT,
  tsx: TEXT,
  txt: TEXT,
  zsh: TEXT,
  bash: TEXT,
  log: TEXT,
  ini: TEXT,
  cfg: TEXT,
  pdf: "application/pdf",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
};

export function filePreviewContentType(path: string): string {
  const filename = path.split(/[\\/]/u).at(-1) ?? "";
  const dot = filename.lastIndexOf(".");
  const extension = dot < 0 ? "" : filename.slice(dot + 1).toLowerCase();
  return Object.hasOwn(CONTENT_TYPES, extension)
    ? CONTENT_TYPES[extension]!
    : "application/octet-stream";
}

export function isTextPreviewContentType(contentType: string): boolean {
  const type = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return (
    type.startsWith("text/") ||
    type === "application/json" ||
    type === "application/xml" ||
    type === "application/x-ndjson" ||
    type === "image/svg+xml"
  );
}

/** Accept strict UTF-8 and BOM-marked UTF-16; never silently replace bad bytes. */
export function decodeFilePreviewText(
  bytes: Uint8Array,
  options: { allowIncompleteTail?: boolean } = {},
): string {
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? "utf-16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? "utf-16be"
        : "utf-8";
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes, {
      stream: options.allowIncompleteTail === true,
    });
    if (text.includes("\0")) throw new Error("Binary text");
    return text;
  } catch {
    throw new Error(
      "Text preview requires valid UTF-8 or BOM-marked UTF-16 text",
    );
  }
}
