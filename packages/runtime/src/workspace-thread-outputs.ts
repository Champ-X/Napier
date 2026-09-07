import { lstat } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "./ed25519.js";
import type { ThreadSummary, RunEvent } from "@napier/contracts";

const THREAD_ID = /^thread_[A-Za-z0-9_-]+$/u;
interface OutputStore {
  workspaceRoot: string;
  listThreads(): ThreadSummary[];
  listEventsRange(
    threadId: string,
    fromSeq: number,
    toSeq: number,
    types?: readonly string[],
  ): Promise<RunEvent[]>;
}

export function assertOutputMutationPaths(
  threadId: string,
  plan: {
    request: { operation: string };
    sourcePath?: string;
    destinationPath?: string;
  },
): void {
  if (plan.sourcePath && plan.request.operation !== "restore") {
    assertThreadOutputPath(threadId, plan.sourcePath);
  }
  if (plan.destinationPath) {
    // Creating the shared parent is harmless; moving/trashing it is not.
    if (
      plan.request.operation === "create_directory" &&
      plan.destinationPath === "outputs"
    )
      return;
    assertThreadOutputPath(threadId, plan.destinationPath);
  }
}

export function threadOutputDirectory(threadId: string): string {
  if (!THREAD_ID.test(threadId)) throw new Error("Invalid output Thread ID");
  return `outputs/${threadId}`;
}

export function formatThreadOutputGuidance(threadId: string): string {
  const directory = threadOutputDirectory(threadId);
  return [
    `This Thread's generated output directory is ${directory}/.`,
    "For new standalone deliverables (slides, HTML sites, reports, documents, images, or data exports), create a new subdirectory there and keep all scripts, styles, assets, and verification files together. Declare the exact paths in the Plan and link those paths in the final answer. Never reuse a previous task's index.html or verification directory for a new deliverable.",
    "Continue this Thread's existing deliverable in place. Read other Threads' outputs as inputs, but copy them into this Thread's output directory before changing them. Existing project/source-code maintenance stays at its requested repository paths; do not relocate application source into the output directory.",
  ].join("\n");
}

/** Output directories are write-owned by their Thread, including directory moves/trash. */
export function assertThreadOutputPath(
  threadId: string,
  relativePath: string,
): void {
  const value = path.normalize(relativePath).split(path.sep).join("/");
  const normalized = process.platform === "linux" ? value : value.toLowerCase();
  const [directory, owner] = normalized.split("/");
  if (directory !== "outputs") return;
  if (
    owner === (process.platform === "linux" ? threadId : threadId.toLowerCase())
  )
    return;
  if (!owner || THREAD_ID.test(owner)) {
    throw new Error(
      `This path contains another Thread's outputs. Preserve them and write a copy under ${threadOutputDirectory(threadId)}/.`,
    );
  }
}

/** Protect legacy generated files as well, using durable write receipts, not model claims. */
export async function assertWorkspaceOutputReplacement(
  store: OutputStore,
  threadId: string,
  relativePath: string,
  beforeSha256: string | null,
): Promise<void> {
  assertThreadOutputPath(threadId, relativePath);
  if (
    !beforeSha256 ||
    relativePath.startsWith(`${threadOutputDirectory(threadId)}/`)
  )
    return;
  // Ordinary source maintenance in a project retains its existing paths and semantics.
  if (await isProjectPath(store.workspaceRoot, relativePath)) return;
  const pathSha256 = sha256(path.normalize(relativePath));
  for (const thread of store.listThreads()) {
    if (thread.id === threadId || thread.eventCount < 1) continue;
    const events = await store.listEventsRange(
      thread.id,
      1,
      thread.eventCount,
      ["tool.completed"],
    );
    if (
      events.some((event) => {
        if (
          !event.payload ||
          typeof event.payload !== "object" ||
          Array.isArray(event.payload)
        )
          return false;
        const details = event.payload["details"];
        return (
          details !== null &&
          typeof details === "object" &&
          !Array.isArray(details) &&
          details["kind"] === "napier.workspace-patch" &&
          details["pathSha256"] === pathSha256 &&
          details["afterSha256"] === beforeSha256
        );
      })
    ) {
      throw new Error(
        `This file was produced by another Thread (${thread.id}). Preserve it; create this task's deliverable under ${threadOutputDirectory(threadId)}/ with its own assets and verification files.`,
      );
    }
  }
}

async function isProjectPath(
  root: string,
  relativePath: string,
): Promise<boolean> {
  const boundary = path.resolve(root);
  let directory = path.dirname(path.resolve(boundary, relativePath));
  while (
    directory === boundary ||
    directory.startsWith(`${boundary}${path.sep}`)
  ) {
    for (const marker of [
      ".git",
      "package.json",
      "pyproject.toml",
      "Cargo.toml",
      "go.mod",
    ]) {
      try {
        await lstat(path.join(directory, marker));
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    if (directory === boundary) break;
    directory = path.dirname(directory);
  }
  return false;
}
