import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ThreadSummary } from "@napier/contracts";
import { Hono } from "hono";

import { setBodyContentSha256Header } from "./http-response-evidence.js";

const MAX_RECENT_WORKSPACES = 12;

export interface RecentWorkspace {
  root: string;
  name: string;
  lastOpenedAt: string;
}

interface ParsedRecentWorkspace {
  root: string;
  lastOpenedAt: string;
}

/**
 * The recent-workspaces registry lives OUTSIDE any per-workspace ledger. Each
 * workspace keeps its own `<root>/.napier` store, so a switch swaps the whole
 * service graph and anything stored in a ledger disappears with the folder.
 * This machine-level index must therefore persist independently of the store
 * and survive service rebuilds.
 */
function registryPath(): string {
  const stateHome =
    process.env["NAPIER_STATE_HOME"] ?? path.join(os.homedir(), ".napier");
  return path.join(stateHome, "recent-workspaces.json");
}

function workspaceName(root: string): string {
  return path.basename(root) || root;
}

export async function readRecentWorkspaces(): Promise<RecentWorkspace[]> {
  let raw: string;
  try {
    raw = await readFile(registryPath(), "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const entries: RecentWorkspace[] = [];
  for (const item of parsed) {
    const candidate = parseRecentWorkspace(item);
    if (!candidate || transientWorkspaceRoot(candidate.root)) continue;
    const root = await existingCanonicalDirectory(candidate.root);
    if (!root || seen.has(root)) continue;
    seen.add(root);
    entries.push({
      root,
      name: workspaceName(root),
      lastOpenedAt: candidate.lastOpenedAt,
    });
    if (entries.length >= MAX_RECENT_WORKSPACES) break;
  }
  if (!sameRegistry(parsed, entries)) await writeRegistry(entries);
  return entries;
}

/**
 * Record `root` without changing the position of an existing workspace. The
 * sidebar is a user-visible workspace tree, so switching folders must not
 * reshuffle it. Best-effort: registry IO failures never block a rebind.
 */
export async function recordRecentWorkspace(
  root: string,
): Promise<RecentWorkspace[]> {
  if (!path.isAbsolute(root) || transientWorkspaceRoot(root)) {
    return readRecentWorkspaces();
  }
  const canonicalRoot = (await existingCanonicalDirectory(root)) ?? root;
  const existing = await readRecentWorkspaces();
  const recorded: RecentWorkspace = {
    root: canonicalRoot,
    name: workspaceName(canonicalRoot),
    lastOpenedAt: new Date().toISOString(),
  };
  const existingIndex = existing.findIndex(
    (entry) => entry.root === canonicalRoot,
  );
  const next =
    existingIndex >= 0
      ? existing.map((entry, index) =>
          index === existingIndex ? recorded : entry,
        )
      : [...existing, recorded].slice(0, MAX_RECENT_WORKSPACES);
  await writeRegistry(next);
  return next;
}

function parseRecentWorkspace(
  input: unknown,
): ParsedRecentWorkspace | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  const root = record["root"];
  if (typeof root !== "string" || !path.isAbsolute(root)) return undefined;
  return {
    root,
    lastOpenedAt:
      typeof record["lastOpenedAt"] === "string"
        ? record["lastOpenedAt"]
        : new Date(0).toISOString(),
  };
}

async function existingCanonicalDirectory(
  root: string,
): Promise<string | undefined> {
  try {
    const canonical = await realpath(root);
    return (await stat(canonical)).isDirectory() ? canonical : undefined;
  } catch {
    return undefined;
  }
}

function transientWorkspaceRoot(root: string): boolean {
  const normalized = path.resolve(root);
  const temporaryParents = [os.tmpdir(), "/tmp", "/private/tmp"].map((entry) =>
    path.resolve(entry),
  );
  const underSystemTemp = temporaryParents.some(
    (entry) =>
      normalized === entry || normalized.startsWith(`${entry}${path.sep}`),
  );
  if (!underSystemTemp) return false;
  return normalized
    .split(path.sep)
    .some((segment) => /^napier-(?:sdk-|test-|fix-)/u.test(segment));
}

function sameRegistry(raw: unknown[], entries: RecentWorkspace[]): boolean {
  if (raw.length !== entries.length) return false;
  return entries.every((entry, index) => {
    const candidate = raw[index];
    return (
      Boolean(candidate) &&
      typeof candidate === "object" &&
      (candidate as Record<string, unknown>)["root"] === entry.root &&
      (candidate as Record<string, unknown>)["name"] === entry.name &&
      (candidate as Record<string, unknown>)["lastOpenedAt"] ===
        entry.lastOpenedAt
    );
  });
}

async function writeRegistry(entries: RecentWorkspace[]): Promise<void> {
  try {
    const target = registryPath();
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  } catch {
    // Best-effort: registry hygiene must never block startup or a rebind.
  }
}

export type ListWorkspaceThreads = (root: string) => Promise<ThreadSummary[]>;

export function registerRecentWorkspacesHttp(
  app: Hono,
  listWorkspaceThreads?: ListWorkspaceThreads,
): void {
  app.get("/api/workspace/recent", async (context) => {
    const recent = await readRecentWorkspaces();
    setBodyContentSha256Header(context, recent);
    return context.json(recent);
  });
  app.get("/api/workspace/threads", async (context) => {
    if (!listWorkspaceThreads) {
      return context.json(
        { error: "Workspace thread browsing is not available" },
        409,
      );
    }
    const requestedRoot = context.req.query("root");
    if (!requestedRoot || !path.isAbsolute(requestedRoot)) {
      return context.json({ error: "Workspace root is invalid" }, 400);
    }
    const canonicalRoot = await existingCanonicalDirectory(requestedRoot);
    if (!canonicalRoot) {
      return context.json({ error: "Workspace root does not exist" }, 404);
    }
    const recent = await readRecentWorkspaces();
    if (!recent.some((entry) => entry.root === canonicalRoot)) {
      return context.json({ error: "Workspace is not in the recent list" }, 404);
    }
    const threads = await listWorkspaceThreads(canonicalRoot);
    setBodyContentSha256Header(context, threads);
    return context.json(threads);
  });
}
