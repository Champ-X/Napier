import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  ThreadDetail,
  WorkspaceTrashList,
  WorkspaceTrashRestoreResult,
} from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { createApp, createServices } from "../src/app.js";

const temporaryRoots: string[] = [];
const openServices: Awaited<ReturnType<typeof createServices>>[] = [];

afterEach(async () => {
  for (const services of openServices.splice(0)) {
    await services.workspaceProcesses.shutdown();
    await services.recovery.stop();
    await services.automation.stop();
    await services.channels.stop();
    await services.extensions.shutdown();
    services.store.close();
  }
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Workspace file recovery HTTP API", () => {
  it("lists Thread-scoped trash, blocks collision, and restores explicitly", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-files-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "data");
    await mkdir(workspaceRoot, { recursive: true });
    const services = await createServices({ workspaceRoot, dataRoot });
    openServices.push(services);
    const app = createApp(services);
    const thread = services.store.listThreads()[0]!;
    const run = services.store.listRuns(thread.id)[0]!;
    const source = path.join(workspaceRoot, "recover.txt");
    await writeFile(source, "recoverable\n");
    const preview = await services.workspaceFileMutations.preview(
      thread.id,
      run.id,
      { operation: "trash", path: "recover.txt" },
    );
    await services.workspaceFileMutations.apply(thread.id, run.id, preview.id);

    const listResponse = await app.request(
      `/api/threads/${thread.id}/workspace-trash`,
    );
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as WorkspaceTrashList;
    expect(list.items).toEqual([
      expect.objectContaining({
        id: preview.trashId,
        originalPath: "recover.txt",
      }),
    ]);

    const otherThread = await services.store.createThread({
      title: "Other",
      agentId: services.store.listAgents()[0]!.id,
    });
    const otherListResponse = await app.request(
      `/api/threads/${otherThread.id}/workspace-trash`,
    );
    expect(
      ((await otherListResponse.json()) as WorkspaceTrashList).items,
    ).toEqual([]);
    const deniedResponse = await app.request(
      `/api/threads/${otherThread.id}/workspace-trash/${preview.trashId}/restore`,
      { method: "POST" },
    );
    expect(deniedResponse.status).toBe(404);

    await writeFile(source, "collision\n");
    const conflictResponse = await app.request(
      `/api/threads/${thread.id}/workspace-trash/${preview.trashId}/restore`,
      { method: "POST" },
    );
    expect(conflictResponse.status).toBe(409);
    expect(await readFile(source, "utf8")).toBe("collision\n");
    await unlink(source);

    const restoreResponse = await app.request(
      `/api/threads/${thread.id}/workspace-trash/${preview.trashId}/restore`,
      { method: "POST" },
    );
    expect(restoreResponse.status).toBe(200);
    expect(
      (await restoreResponse.json()) as WorkspaceTrashRestoreResult,
    ).toEqual(
      expect.objectContaining({
        trashId: preview.trashId,
        restoredPath: "recover.txt",
        evidence: expect.objectContaining({
          operation: "restore",
          initiatedBy: "operator",
        }),
      }),
    );
    expect(await readFile(source, "utf8")).toBe("recoverable\n");

    const invalidResponse = await app.request(
      `/api/threads/${thread.id}/workspace-trash/not-valid/restore`,
      { method: "POST" },
    );
    expect(invalidResponse.status).toBe(400);
    const detailResponse = await app.request(`/api/threads/${thread.id}`);
    const detail = (await detailResponse.json()) as ThreadDetail;
    expect(JSON.stringify(detail.events)).not.toContain("recover.txt");
  });
});
