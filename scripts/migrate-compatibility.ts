import { cp, lstat, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

import { LocalStore } from "../packages/runtime/src/store.js";

interface MigrationOptions {
  apply: boolean;
  dataRoot?: string;
  workspaceRoot: string;
}

export async function migrateCompatibilityStore(options: MigrationOptions) {
  if (!options.dataRoot)
    throw new Error("Store migration requires --data-root");
  const dataRoot = path.resolve(options.dataRoot);
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const workspaceJson = path.join(dataRoot, "workspace.json");
  const ledger = path.join(dataRoot, "ledger.sqlite");
  const [legacyPresent, ledgerPresent] = await Promise.all([
    regularFile(workspaceJson),
    regularFile(ledger),
  ]);
  if (ledgerPresent) {
    return {
      kind: "napier.compatibility-migration",
      schemaVersion: 1,
      migration: "store",
      status: "already_current",
      applied: false,
    } as const;
  }
  if (!legacyPresent) {
    throw new Error("Legacy Store workspace.json is unavailable");
  }
  if (!options.apply) {
    return {
      kind: "napier.compatibility-migration",
      schemaVersion: 1,
      migration: "store",
      status: "ready",
      applied: false,
    } as const;
  }
  const backupRoot = siblingBackupPath(dataRoot);
  await cp(dataRoot, backupRoot, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  const store = new LocalStore({ dataRoot, workspaceRoot });
  try {
    await store.initialize();
  } finally {
    store.close();
  }
  if (!(await regularFile(ledger))) {
    throw new Error("Store migration did not create ledger.sqlite");
  }
  return {
    kind: "napier.compatibility-migration",
    schemaVersion: 1,
    migration: "store",
    status: "migrated",
    applied: true,
    backupRoot,
    rollback:
      "Stop Napier, preserve the failed ledger.sqlite files, remove only those ledger files, then restore this backup directory as the data root.",
  } as const;
}

export async function migrateCompatibilitySkills(options: MigrationOptions) {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const sourceRoot = path.join(workspaceRoot, "skills");
  const targetRoot = path.join(workspaceRoot, ".agents", "skills");
  if (!(await directory(sourceRoot))) {
    return {
      kind: "napier.compatibility-migration",
      schemaVersion: 1,
      migration: "skills",
      status: "nothing_to_migrate",
      applied: false,
      copiedSkills: [],
    } as const;
  }
  const names = (await readdir(sourceRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const conflicts = [];
  const pending = [];
  for (const name of names) {
    const target = path.join(targetRoot, name);
    if (await exists(target)) conflicts.push(name);
    else pending.push(name);
  }
  if (conflicts.length > 0) {
    throw new Error(
      "Standard Skill targets already exist: " + conflicts.join(", "),
    );
  }
  if (!options.apply) {
    return {
      kind: "napier.compatibility-migration",
      schemaVersion: 1,
      migration: "skills",
      status: pending.length > 0 ? "ready" : "nothing_to_migrate",
      applied: false,
      copiedSkills: pending,
    } as const;
  }
  await mkdir(targetRoot, { recursive: true });
  for (const name of pending) {
    await cp(path.join(sourceRoot, name), path.join(targetRoot, name), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  }
  return {
    kind: "napier.compatibility-migration",
    schemaVersion: 1,
    migration: "skills",
    status: pending.length > 0 ? "migrated" : "nothing_to_migrate",
    applied: pending.length > 0,
    copiedSkills: pending,
    rollback:
      "Remove only the copied .agents/skills entries listed in copiedSkills; the legacy skills source remains unchanged.",
  } as const;
}

function siblingBackupPath(dataRoot: string): string {
  const timestamp = new Date().toISOString().replaceAll(/[:.]/gu, "-");
  return dataRoot + ".compat-backup-" + timestamp;
}

async function regularFile(target: string): Promise<boolean> {
  const value = await lstat(target).catch(() => undefined);
  if (value?.isSymbolicLink())
    throw new Error("Migration path cannot be a symlink");
  return value?.isFile() ?? false;
}

async function directory(target: string): Promise<boolean> {
  const value = await lstat(target).catch(() => undefined);
  if (value?.isSymbolicLink())
    throw new Error("Migration path cannot be a symlink");
  return value?.isDirectory() ?? false;
}

async function exists(target: string): Promise<boolean> {
  return Boolean(await lstat(target).catch(() => undefined));
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const migration = process.argv[2];
  if (migration !== "store" && migration !== "skills") {
    throw new Error(
      "Usage: migrate-compatibility.ts store|skills --workspace-root PATH [--data-root PATH] [--apply]",
    );
  }
  const workspaceRoot = argument("--workspace-root");
  if (!workspaceRoot) throw new Error("Migration requires --workspace-root");
  const options = {
    apply: process.argv.includes("--apply"),
    workspaceRoot,
    ...(argument("--data-root") ? { dataRoot: argument("--data-root") } : {}),
  };
  const result =
    migration === "store"
      ? await migrateCompatibilityStore(options)
      : await migrateCompatibilitySkills(options);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

if (
  path.resolve(process.argv[1] ?? "") === path.resolve(import.meta.filename)
) {
  await main();
}
