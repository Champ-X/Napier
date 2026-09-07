import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { sha256 } from "../src/ed25519.js";
import { LocalStore } from "../src/store.js";
import { createWorkspaceTools } from "../src/tools.js";
import { WorkspaceFileMutationManager } from "../src/workspace-file-mutations.js";
import {
  assertWorkspaceOutputReplacement,
  formatThreadOutputGuidance,
  threadOutputDirectory,
} from "../src/workspace-thread-outputs.js";
import { createActiveTestRun } from "./active-run-test-fixture.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-thread-outputs-"));
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot);
  const store = new LocalStore({ workspaceRoot, dataRoot });
  cleanups.push(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  await store.initialize();
  const first = await createActiveTestRun(store, "First output");
  const second = await createActiveTestRun(store, "Second output");
  const patch = (threadId: string) =>
    createWorkspaceTools(workspaceRoot, {
      dataRoot,
      includeWriteTools: true,
      authorizePatch: (file, hash) =>
        assertWorkspaceOutputReplacement(store, threadId, file, hash),
    }).find((tool) => tool.name === "apply_patch")!;
  return { store, root, workspaceRoot, dataRoot, first, second, patch };
}

describe("Thread outputs", () => {
  it("creates two index.html files independently and permits same-Thread follow-up edits", async () => {
    const { first, second, patch, workspaceRoot } = await fixture();
    const firstPath = `${threadOutputDirectory(first.thread.id)}/slides/index.html`;
    const secondPath = `${threadOutputDirectory(second.thread.id)}/slides/index.html`;
    for (const [owner, file, content] of [
      [first, firstPath, "First deck"],
      [second, secondPath, "Second deck"],
    ] as const) {
      await patch(owner.thread.id).execute("create", {
        operation: "create",
        path: file,
        expectedSha256: null,
        content,
        createParentDirectories: true,
      });
    }
    await expect(
      patch(second.thread.id).execute("overwrite", {
        operation: "replace",
        path: firstPath,
        expectedSha256: sha256("First deck"),
        edits: [{ oldText: "First deck", newText: "Overwritten" }],
      }),
    ).rejects.toThrow("another Thread");
    await patch(first.thread.id).execute("continue", {
      operation: "replace",
      path: firstPath,
      expectedSha256: sha256("First deck"),
      edits: [{ oldText: "First deck", newText: "Updated first deck" }],
    });
    expect(await readFile(path.join(workspaceRoot, firstPath), "utf8")).toBe(
      "Updated first deck",
    );
    expect(await readFile(path.join(workspaceRoot, secondPath), "utf8")).toBe(
      "Second deck",
    );
    expect(formatThreadOutputGuidance(second.thread.id)).toContain(
      threadOutputDirectory(second.thread.id),
    );
  });

  it("protects a legacy root artifact using persisted receipts, while project source edits remain in place", async () => {
    const { store, first, second, patch, workspaceRoot } = await fixture();
    const created = await patch(first.thread.id).execute("create", {
      operation: "create",
      path: "index.html",
      expectedSha256: null,
      content: "Original deck",
    });
    await store.appendEvent({
      threadId: first.thread.id,
      runId: first.run.id,
      type: "tool.completed",
      category: "tool",
      payload: {
        callId: "call_create",
        toolName: "apply_patch",
        status: "completed",
        outputTextSha256: sha256("created"),
        outputTextBytes: 7,
        details: JSON.parse(JSON.stringify(created.details)),
      },
    });
    const replace = {
      operation: "replace",
      path: "index.html",
      expectedSha256: sha256("Original deck"),
      edits: [{ oldText: "Original deck", newText: "New deck" }],
    };
    await expect(
      patch(second.thread.id).execute("replace", replace),
    ).rejects.toThrow("produced by another Thread");
    expect(await readFile(path.join(workspaceRoot, "index.html"), "utf8")).toBe(
      "Original deck",
    );
    await mkdir(path.join(workspaceRoot, ".git"));
    await patch(second.thread.id).execute("maintain-project", replace);
    expect(await readFile(path.join(workspaceRoot, "index.html"), "utf8")).toBe(
      "New deck",
    );
  });

  it("rejects moves and trash of another Thread output or the shared parent", async () => {
    const { store, first, second, workspaceRoot, dataRoot } = await fixture();
    const file = `${threadOutputDirectory(first.thread.id)}/index.html`;
    await mkdir(path.dirname(path.join(workspaceRoot, file)), {
      recursive: true,
    });
    await writeFile(path.join(workspaceRoot, file), "Retained deck");
    const manager = new WorkspaceFileMutationManager({
      store,
      workspaceRoot,
      dataRoot,
    });
    await manager.initialize();
    for (const request of [
      { operation: "trash", path: file },
      { operation: "trash", path: "outputs" },
      { operation: "move", sourcePath: file, destinationPath: "stolen.html" },
      {
        operation: "create_directory",
        path: `${threadOutputDirectory(first.thread.id)}/new`,
      },
    ] as const) {
      await expect(
        manager.preview(second.thread.id, second.run.id, request),
      ).rejects.toThrow("another Thread");
    }
    expect(await readFile(path.join(workspaceRoot, file), "utf8")).toBe(
      "Retained deck",
    );
  });
});
