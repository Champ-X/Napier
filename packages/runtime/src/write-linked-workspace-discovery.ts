import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";

import { isProtectedWorkspacePathSegment } from "./workspace-file-scope.js";

export const MAX_WRITE_LINKED_WORKSPACE_PACKAGES = 64;

export async function nearestWriteLinkedPackageRoot(
  workspaceRoot: string,
  changedPath: string,
): Promise<{ root: string; truncated: boolean }> {
  let current = path.dirname(path.resolve(workspaceRoot, changedPath));
  while (
    current === workspaceRoot ||
    current.startsWith(`${workspaceRoot}${path.sep}`)
  ) {
    try {
      const info = await lstat(path.join(current, "package.json"));
      if (info.isSymbolicLink() || !info.isFile()) {
        return { root: workspaceRoot, truncated: true };
      }
      return { root: current, truncated: false };
    } catch (error) {
      if (!missing(error)) {
        return { root: workspaceRoot, truncated: true };
      }
    }
    if (current === workspaceRoot) {
      return { root: workspaceRoot, truncated: false };
    }
    current = path.dirname(current);
  }
  return { root: workspaceRoot, truncated: true };
}

export async function expandWriteLinkedWorkspacePattern(
  workspaceRoot: string,
  pattern: string,
): Promise<string[] | undefined> {
  if (!safeWorkspacePattern(pattern)) return undefined;
  let current = [workspaceRoot];
  for (const segment of pattern.split("/")) {
    const next = [];
    for (const parent of current) {
      if (segment === "*") {
        let entries;
        try {
          entries = await readdir(parent, { withFileTypes: true });
        } catch {
          return undefined;
        }
        for (const entry of entries) {
          if (entry.isSymbolicLink()) return undefined;
          if (
            !entry.isDirectory() ||
            isProtectedWorkspacePathSegment(entry.name)
          ) {
            continue;
          }
          next.push(path.join(parent, entry.name));
          if (next.length > MAX_WRITE_LINKED_WORKSPACE_PACKAGES) {
            return undefined;
          }
        }
      } else {
        const candidate = path.join(parent, segment);
        try {
          const info = await lstat(candidate);
          if (info.isSymbolicLink()) return undefined;
          if (!info.isDirectory()) continue;
          next.push(candidate);
          if (next.length > MAX_WRITE_LINKED_WORKSPACE_PACKAGES) {
            return undefined;
          }
        } catch (error) {
          if (missing(error)) continue;
          return undefined;
        }
      }
    }
    current = next;
  }
  const roots = [];
  for (const candidate of current) {
    const canonical = await realpath(candidate).catch(() => "");
    if (!canonical || canonical !== candidate) return undefined;
    if (canonical.startsWith(`${workspaceRoot}${path.sep}`)) {
      roots.push(candidate);
    } else {
      return undefined;
    }
  }
  return roots.sort();
}

export function writeLinkedWorkspacePatterns(
  value: unknown,
): string[] | undefined {
  const record = jsonRecord(value);
  const candidates = Array.isArray(value)
    ? value
    : record && Array.isArray(record["packages"])
      ? record["packages"]
      : undefined;
  return candidates &&
    candidates.length <= MAX_WRITE_LINKED_WORKSPACE_PACKAGES &&
    candidates.every((candidate) => typeof candidate === "string")
    ? [...new Set(candidates as string[])].sort()
    : undefined;
}

function safeWorkspacePattern(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 300 &&
    !value.startsWith("!") &&
    value
      .split("/")
      .every(
        (segment) =>
          Boolean(segment) &&
          (segment === "*" ||
            (!segment.includes("*") &&
              segment !== "." &&
              segment !== ".." &&
              !isProtectedWorkspacePathSegment(segment))),
      )
  );
}

function missing(error: unknown): boolean {
  return (
    error instanceof Error && "code" in error && String(error.code) === "ENOENT"
  );
}

function jsonRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
