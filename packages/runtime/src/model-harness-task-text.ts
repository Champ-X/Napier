const CODE_EXTENSIONS = new Set([
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "tsx",
  "py",
  "pyi",
  "rs",
  "go",
  "java",
  "kt",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "cs",
  "rb",
  "php",
  "swift",
  "sh",
  "bash",
  "html",
  "css",
  "scss",
  "vue",
  "svelte",
]);
const RESOURCE_EXTENSIONS = new Set([
  "md",
  "mdx",
  "txt",
  "json",
  "jsonl",
  "yaml",
  "yml",
  "toml",
  "ini",
  "xml",
  "pdf",
  "docx",
  "csv",
  "tsv",
  "sql",
  "sqlite",
]);

/** Resource identifiers are task operands, not instructions. Preserve useful
 * language/data hints without treating a basename like search.ts as a verb. */
export function modelHarnessTaskText(text: string): string {
  return text
    .replace(/\bcall[\s-]+sites?\b/giu, "callsite")
    .replace(
      /(?:\b(?:open|visit|navigate(?:\s+to)?|go\s+to)|打开|访问)\s*[`"']?https?:\/\/[^\s<>`]+/giu,
      "open website",
    )
    .replace(/https?:\/\/[^\s<>`]+/giu, " resource ")
    .replace(/\S+/gu, (token) => {
      const name = token.replace(/^[`"'(<\[]+|[`"')>\],;:.!?]+$/gu, "");
      const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
      if (!name.includes(".")) return token;
      if (CODE_EXTENSIONS.has(extension)) return "source code";
      if (!RESOURCE_EXTENSIONS.has(extension)) return token;
      if (["csv", "tsv"].includes(extension)) return "csv";
      if (["sql", "sqlite"].includes(extension)) return extension;
      return "resource";
    });
}
