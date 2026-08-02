import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { constants, DatabaseSync } from "node:sqlite";

import { sha256 } from "@napier/runtime";

import type { LoadedWorkflowBenchmarkCase } from "./workflow-benchmark-case.js";

const BENCHMARK_SETUP_ACTIONS = new Set([
  constants.SQLITE_CREATE_TABLE,
  constants.SQLITE_INSERT,
  constants.SQLITE_READ,
  constants.SQLITE_SELECT,
]);

export async function setupWorkflowBenchmarkDatabase(
  workspaceRoot: string,
  loaded: LoadedWorkflowBenchmarkCase,
): Promise<{ path: string; sha256: string } | undefined> {
  if (loaded.benchmarkCase.schemaVersion !== 2) return undefined;
  if (loaded.setupSqlSource === undefined) {
    throw new Error("Workflow benchmark setup SQL is unavailable");
  }
  const databasePath = resolveWorkspaceEntry(
    workspaceRoot,
    loaded.benchmarkCase.databasePath,
  );
  await mkdir(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath, {
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
    timeout: 0,
  });
  try {
    requireSqliteControls(database);
    database.enableDefensive(true);
    database.setAuthorizer((actionCode, arg1, _arg2, databaseName) =>
      benchmarkSetupActionAllowed(actionCode, arg1, databaseName)
        ? constants.SQLITE_OK
        : constants.SQLITE_DENY,
    );
    database.exec(loaded.setupSqlSource);
  } finally {
    database.close();
  }
  return {
    path: databasePath,
    sha256: sha256(await readFile(databasePath)),
  };
}

function requireSqliteControls(database: DatabaseSync): void {
  if (
    typeof database.setAuthorizer !== "function" ||
    typeof database.enableDefensive !== "function"
  ) {
    throw new Error("Workflow benchmark SQLite controls are unavailable");
  }
}

function benchmarkSetupActionAllowed(
  actionCode: number,
  arg1: string | null,
  databaseName: string | null,
): boolean {
  if (databaseName !== null && databaseName !== "main") return false;
  if (actionCode === constants.SQLITE_UPDATE) return arg1 === "sqlite_master";
  return BENCHMARK_SETUP_ACTIONS.has(actionCode);
}

function resolveWorkspaceEntry(
  workspaceRoot: string,
  relativePath: string,
): string {
  const resolved = path.resolve(workspaceRoot, relativePath);
  const relative = path.relative(workspaceRoot, resolved);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Workflow benchmark database path escapes its workspace");
  }
  return resolved;
}
