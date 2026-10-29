import path from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { preserveAgentToolIdentity } from "./agent-tool-metadata.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { SubagentWorktreeSnapshot } from "./subagent-worktree-diff.js";
import type { SubagentWorktreeSession } from "./subagent-worktree-snapshot.js";

export interface WorktreeReadScope {
  path: string;
  kind: "file" | "tree" | "names";
}
export interface WorktreeReadDependency extends WorktreeReadScope {
  sha256: string;
}
const FILE_TOOLS = new Set([
  "read_file",
  "inspect_data",
  "inspect_code",
  "read_symbol",
  "ast_query",
  "ast_edit_preview",
]);
const TREE_TOOLS = new Set(["search_files", "list_symbols"]);
const WRITE_TOOLS = new Set(["apply_patch", "candidate_file"]);

// Every exposed tool passes here. Unknown tools (including commands, LSP and
// debuggers) conservatively depend on the entire visible source tree.
export function trackWorktreeReads(
  tools: AgentTool[],
  session: SubagentWorktreeSession,
): AgentTool[] {
  return tools.map((tool) => preserveAgentToolIdentity(tool, {
    ...tool,
    execute: async (...args: Parameters<AgentTool["execute"]>) => {
      if (!WRITE_TOOLS.has(tool.name)) {
        const input = args[1] as { path?: unknown };
        const exact = FILE_TOOLS.has(tool.name);
        const scoped =
          exact || TREE_TOOLS.has(tool.name) || tool.name === "list_files";
        const supplied =
          scoped && typeof input.path === "string" ? input.path : ".";
        const relative =
          path
            .relative(session.root, path.resolve(session.root, supplied))
            .split(path.sep)
            .join("/") || ".";
        const safe =
          relative !== ".." &&
          !relative.startsWith("../") &&
          !path.isAbsolute(relative);
        const scope: WorktreeReadScope = {
          path: safe ? relative : ".",
          kind:
            safe && tool.name === "list_files"
              ? "names"
              : safe && exact
                ? "file"
                : "tree",
        };
        if (
          !session.readScopes.some(
            (old) => old.kind === scope.kind && old.path === scope.path,
          )
        )
          session.readScopes.push(scope);
      }
      return tool.execute(...args);
    },
  }));
}

export function worktreeReadDependencies(
  snapshot: SubagentWorktreeSnapshot,
  scopes: WorktreeReadScope[],
  writePaths: string[],
): WorktreeReadDependency[] {
  const writes = new Set(writePaths);
  return scopes.map((scope) => ({
    ...scope,
    sha256: readDependencyHash(snapshot, scope, writes),
  }));
}

export function readDependencyHash(
  snapshot: SubagentWorktreeSnapshot,
  scope: WorktreeReadScope,
  writes: ReadonlySet<string>,
): string {
  const relevant = snapshot.files.filter(
    (file) => !writes.has(file.path) && inScope(file.path, scope),
  );
  return sha256(
    canonicalJson({
      files: relevant.map((file) =>
        scope.kind === "names"
          ? file.path
          : { path: file.path, hash: file.fileSha256, mode: file.mode },
      ),
      directories:
        scope.kind === "file"
          ? []
          : (snapshot.directories ?? []).filter((entry) =>
              inScope(entry, scope),
            ),
    }),
  );
}

function inScope(entry: string, scope: WorktreeReadScope): boolean {
  return scope.kind === "file"
    ? entry === scope.path
    : scope.path === "." ||
        entry === scope.path ||
        entry.startsWith(`${scope.path}/`);
}
