import path from "node:path";

import {
  assertWorkspaceSourceCurrent,
  loadWorkspaceSourceFile,
} from "./workspace-source.js";

export type TypescriptAstLanguage =
  | "typescript"
  | "typescriptreact"
  | "javascript"
  | "javascriptreact";

export interface TypescriptAstSource {
  workspaceRoot: string;
  target: string;
  path: string;
  pathSha256: string;
  source: string;
  fileSha256: string;
  fileBytes: number;
  language: TypescriptAstLanguage;
  scriptKind: import("typescript").ScriptKind;
}

export const MAX_TYPESCRIPT_AST_FILE_BYTES = 1024 * 1024;
const TYPESCRIPT_AST_EXTENSIONS = new Set([
  ".ts",
  ".mts",
  ".cts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
]);

export async function loadTypescriptAstSource(
  ts: typeof import("typescript"),
  workspaceRootInput: string,
  sourcePath: string,
  label: string,
  expectedSha256?: string,
): Promise<TypescriptAstSource> {
  const source = await loadWorkspaceSourceFile(workspaceRootInput, sourcePath, {
    label,
    maxBytes: MAX_TYPESCRIPT_AST_FILE_BYTES,
    extensions: TYPESCRIPT_AST_EXTENSIONS,
    extensionError: `${label} supports TypeScript and JavaScript source files`,
    ...(expectedSha256 ? { expectedSha256 } : {}),
  });
  const language = typescriptAstLanguage(source.path)!;
  return {
    ...source,
    language,
    scriptKind: typescriptAstScriptKind(ts, language),
  };
}

export async function assertTypescriptAstSourceCurrent(
  source: TypescriptAstSource,
  label: string,
): Promise<void> {
  await assertWorkspaceSourceCurrent(source, {
    label,
    maxBytes: MAX_TYPESCRIPT_AST_FILE_BYTES,
    changedMessage: `${label} source changed during inspection`,
  });
}

function typescriptAstLanguage(
  relativePath: string,
): TypescriptAstLanguage | undefined {
  switch (path.extname(relativePath).toLowerCase()) {
    case ".ts":
    case ".mts":
    case ".cts":
      return "typescript";
    case ".tsx":
      return "typescriptreact";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".jsx":
      return "javascriptreact";
    default:
      return undefined;
  }
}

function typescriptAstScriptKind(
  ts: typeof import("typescript"),
  language: TypescriptAstLanguage,
): import("typescript").ScriptKind {
  switch (language) {
    case "typescript":
      return ts.ScriptKind.TS;
    case "typescriptreact":
      return ts.ScriptKind.TSX;
    case "javascript":
      return ts.ScriptKind.JS;
    case "javascriptreact":
      return ts.ScriptKind.JSX;
  }
}
