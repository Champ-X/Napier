import {
  type TypescriptAstNode,
  type TypescriptAstSelector,
} from "./typescript-ast-model.js";
import { type TypescriptAstLanguage } from "./typescript-ast-source.js";

export interface TypescriptAstQueryRequest {
  path: string;
  selector: TypescriptAstSelector;
  maxResults?: number;
  signal?: AbortSignal;
}

export type TypescriptAstEditOperation =
  | "replace"
  | "remove"
  | "insert_before"
  | "insert_after";

export interface TypescriptAstEditPreviewRequest {
  path: string;
  expectedSha256: string;
  selector: TypescriptAstSelector;
  nodeSha256: string;
  operation: TypescriptAstEditOperation;
  replacement?: string;
  signal?: AbortSignal;
}

export interface TypescriptAstQueryDetails {
  kind: "napier.typescript-ast";
  schemaVersion: 1;
  action: "query";
  status: "found" | "not_found";
  complete: boolean;
  truncated: boolean;
  language: TypescriptAstLanguage;
  pathSha256: string;
  fileSha256: string;
  fileBytes: number;
  parseDiagnosticCount: number;
  visitedNodeCount: number;
  matchedNodeCount: number;
  returnedNodeCount: number;
  omittedNodeCount: number;
  rangeChars: number;
  displayBytes: number;
  nodeSetSha256: string;
  kindCountsSha256: string;
  typescriptVersion: string;
  durationMs: number;
  resultSha256: string;
}

export interface TypescriptAstQueryResult {
  details: TypescriptAstQueryDetails;
  path: string;
  nodes: TypescriptAstNode[];
}

export interface TypescriptAstEditPreviewDetails {
  kind: "napier.typescript-ast";
  schemaVersion: 1;
  action: "edit_preview";
  operation: TypescriptAstEditOperation;
  language: TypescriptAstLanguage;
  targetKind: TypescriptAstNode["kind"];
  pathSha256: string;
  fileSha256: string;
  fileBytes: number;
  parseDiagnosticCount: number;
  targetNodeSha256: string;
  targetTextSha256: string;
  replacementBytes: number;
  replacementSha256: string;
  applicationOldBytes: number;
  applicationNewBytes: number;
  applicationOldSha256: string;
  applicationNewSha256: string;
  applicationContextExpanded: boolean;
  afterFileSha256: string;
  afterFileBytes: number;
  visitedNodeCount: number;
  typescriptVersion: string;
  durationMs: number;
  resultSha256: string;
}

export interface TypescriptAstEditPreviewResult {
  details: TypescriptAstEditPreviewDetails;
  path: string;
  target: TypescriptAstNode;
  applicationOldText: string;
  applicationNewText: string;
}
