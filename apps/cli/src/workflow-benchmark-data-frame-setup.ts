import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "@napier/runtime";

import type { LoadedWorkflowBenchmarkCase } from "./workflow-benchmark-case.js";

export async function setupWorkflowBenchmarkDataFrameSource(
  workspaceRoot: string,
  loaded: LoadedWorkflowBenchmarkCase,
): Promise<{ path: string; sha256: string } | undefined> {
  if (loaded.benchmarkCase.schemaVersion !== 5) return undefined;
  if (loaded.sourceData === undefined) {
    throw new Error("Workflow benchmark DataFrame source is unavailable");
  }
  const target = resolveWorkspaceEntry(
    workspaceRoot,
    loaded.benchmarkCase.workspaceDataPath,
  );
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, loaded.sourceData, { flag: "wx" });
  const source = await readFile(target);
  const sourceSha256 = sha256(source);
  if (sourceSha256 !== loaded.benchmarkCase.sourceDataSha256) {
    throw new Error("Workflow benchmark DataFrame source hash mismatch");
  }
  return { path: target, sha256: sourceSha256 };
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
    throw new Error("Workflow benchmark data path escapes its workspace");
  }
  return resolved;
}
