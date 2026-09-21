import { DatabaseSync } from "node:sqlite";
import { chmod, lstat, mkdir, open } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "./ed25519.js";

export interface MemorySearchDocument {
  id: string;
  content: string;
}

/** Derived per-workspace/per-agent index. Callers supply the complete, currently
 * eligible set before every search. Stored rows never authorize memory use. */
export async function searchTaskMemoryIndex(input: {
  documents: readonly MemorySearchDocument[];
  queryTerms: readonly string[];
  tokenize(text: string): string[];
  workspaceRoot: string;
  agentId: string;
  dataRoot?: string;
}) {
  if (input.dataRoot) {
    try {
      const directory = path.join(input.dataRoot, "memory-search-v1");
      await mkdir(directory, { recursive: true, mode: 0o700 });
      if ((await lstat(directory)).isSymbolicLink())
        throw new Error("Memory index directory must not be a symlink");
      const filename = path.join(
        directory,
        `${sha256(JSON.stringify([input.workspaceRoot, input.agentId]))}.sqlite`,
      );
      try {
        const file = await open(filename, "wx", 0o600);
        await file.close();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      if (
        !(await lstat(filename)).isFile() ||
        (await lstat(filename)).isSymbolicLink()
      )
        throw new Error("Memory index must be a regular file");
      await chmod(filename, 0o600);
      return { ...search(filename, input), storage: "persistent" as const };
    } catch (error) {
      return {
        ...search(":memory:", input),
        storage: "memory_fallback" as const,
        failureSha256: sha256(
          error instanceof Error ? error.message : String(error),
        ),
      };
    }
  }
  return { ...search(":memory:", input), storage: "memory" as const };
}

function search(
  filename: string,
  input: {
    documents: readonly MemorySearchDocument[];
    queryTerms: readonly string[];
    tokenize(text: string): string[];
  },
) {
  const db = new DatabaseSync(filename, { allowExtension: false });
  try {
    db.exec(
      "PRAGMA busy_timeout=1000; CREATE VIRTUAL TABLE IF NOT EXISTS memory_search USING fts5(id UNINDEXED, contentSha256 UNINDEXED, content, tokenize='unicode61')",
    );
    // Synchronization and query share one transaction; another Run cannot swap
    // the searchable set between freshness filtering and ranking.
    db.exec("BEGIN IMMEDIATE");
    const existing = new Map(
      db
        .prepare("SELECT id, contentSha256 FROM memory_search")
        .all()
        .map((row) => [String(row.id), String(row.contentSha256)]),
    );
    const remove = db.prepare("DELETE FROM memory_search WHERE id=?");
    const insert = db.prepare(
      "INSERT INTO memory_search(id,contentSha256,content) VALUES (?,?,?)",
    );
    const wanted = new Set(input.documents.map((document) => document.id));
    let deleted = 0;
    let updated = 0;
    for (const id of existing.keys())
      if (!wanted.has(id)) {
        remove.run(id);
        deleted++;
      }
    for (const document of input.documents) {
      const fingerprint = sha256(document.content);
      if (existing.get(document.id) === fingerprint) continue;
      remove.run(document.id);
      insert.run(
        document.id,
        fingerprint,
        input.tokenize(document.content).join(" "),
      );
      updated++;
    }
    const scores = new Map<string, number>();
    if (input.queryTerms.length > 0) {
      const match = input.queryTerms
        .map((term) => `"${term.replaceAll('"', '""')}"`)
        .join(" OR ");
      for (const row of db
        .prepare(
          "SELECT id, bm25(memory_search) AS rank FROM memory_search WHERE memory_search MATCH ? ORDER BY rank, id",
        )
        .all(match)) {
        if (wanted.has(String(row.id)))
          scores.set(String(row.id), 2 - Number(row.rank));
      }
    }
    db.exec("COMMIT");
    return {
      scores,
      updated,
      deleted,
      reused: input.documents.length - updated,
    };
  } finally {
    db.close();
  }
}
