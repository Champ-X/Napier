import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Hono } from "hono";

import { setBodyContentSha256Header } from "./http-response-evidence.js";

const MAX_RECENT_WORKSPACES = 12;

export interface RecentWorkspace {
  root: string;
  name: string;
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
    if (!item || typeof item !== "object") continue;
    const root = (item as Record<string, unknown>)["root"];
    const lastOpenedAt = (item as Record<string, unknown>)["lastOpenedAt"];
    if (
      typeof root !== "string" ||
      !path.isAbsolute(root) ||
      seen.has(root)
    ) {
      continue;
    }
    seen.add(root);
    entries.push({
      root,
      name: workspaceName(root),
      lastOpenedAt:
        typeof lastOpenedAt === "string" ? lastOpenedAt : new Date(0).toISOString(),
    });
    if (entries.length >= MAX_RECENT_WORKSPACES) break;
  }
  return entries;
}

/**
 * Move `root` to the front of the recent list (most-recently-opened first),
 * de-duplicated and capped. Best-effort: registry IO failures never block a
 * rebind or startup.
 */
export async function recordRecentWorkspace(
  root: string,
): Promise<RecentWorkspace[]> {
  if (!path.isAbsolute(root)) return readRecentWorkspaces();
  const existing = await readRecentWorkspaces();
  const next: RecentWorkspace[] = [
    { root, name: workspaceName(root), lastOpenedAt: new Date().toISOString() },
    ...existing.filter((entry) => entry.root !== root),
  ].slice(0, MAX_RECENT_WORKSPACES);
  try {
    const target = registryPath();
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  } catch {
    // Best-effort: a read-only home or missing permission must not break the
    // workspace switch itself.
  }
  return next;
}

export function registerRecentWorkspacesHttp(app: Hono): void {
  app.get("/api/workspace/recent", async (context) => {
    const recent = await readRecentWorkspaces();
    setBodyContentSha256Header(context, recent);
    return context.json(recent);
  });
}
