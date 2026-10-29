import path from "node:path";
import { isProtectedWorkspacePathSegment } from "./workspace-file-scope.js";

export const GENERATED_WORKTREE_DIRECTORIES = new Set([
  ".vite", "benchmark-results", "coverage", "dist", "playwright-report", "test-results",
]);

export function isUnavailableWorktreeSegment(segment: string): boolean {
  return isProtectedWorkspacePathSegment(segment) || GENERATED_WORKTREE_DIRECTORIES.has(segment.toLowerCase());
}

export function normalizeSubagentWorktreePath(value: string): string {
  if (typeof value !== "string" || !value || value.length > 500 || path.isAbsolute(value) ||
      value.includes("\\") || /[\u0000-\u001f\u007f]/u.test(value))
    throw new Error("Subagent worktree path must be workspace-relative");
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || isUnavailableWorktreeSegment(segment)))
    throw new Error("Subagent worktree path targets an unavailable scope");
  return segments.join("/");
}
