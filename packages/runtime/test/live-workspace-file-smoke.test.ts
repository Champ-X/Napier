import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import {
  AgentRuntime,
  LocalStore,
  ModelRegistry,
  WorkspaceFileMutationManager,
} from "../src/index.js";

const LIVE_FILES_ENABLED = process.env.NAPIER_LIVE_WORKSPACE_FILE_SMOKE === "1";
const describeLive = LIVE_FILES_ENABLED ? describe : describe.skip;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describeLive("live Workspace file lifecycle smoke", () => {
  it("moves, trashes, lists, and restores real bytes through the Agent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-live-files-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "data");
    await Promise.all([
      mkdir(workspaceRoot, { recursive: true }),
      mkdir(dataRoot, { recursive: true }),
    ]);
    await writeFile(path.join(workspaceRoot, "draft.txt"), "live delivery\n");
    const store = new LocalStore({ workspaceRoot, dataRoot });
    await store.initialize();
    const files = new WorkspaceFileMutationManager({
      store,
      workspaceRoot,
      dataRoot,
    });
    await files.initialize();
    const agent = await store.updateAgent(store.listAgents()[0]!.id, {
      toolPolicy: "workspace",
      enabledTools: ["workspace_file_preview", "workspace_file_apply"],
    });
    const thread = await store.createThread({
      title: "Live Workspace file lifecycle",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "live-workspace-files" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("workspace_file_preview", {
          action: "preview",
          operation: "move",
          sourcePath: "draft.txt",
          destinationPath: "final.txt",
        }),
        { stopReason: "toolUse" },
      ),
      applyLatestPreview,
      fauxAssistantMessage(
        fauxToolCall("workspace_file_preview", {
          action: "preview",
          operation: "trash",
          path: "final.txt",
        }),
        { stopReason: "toolUse" },
      ),
      applyLatestPreview,
      fauxAssistantMessage(
        fauxToolCall("workspace_file_preview", { action: "list_trash" }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const trashId = latestMatch(
          JSON.stringify(context.messages),
          /trash_[a-z0-9]{20}/gu,
        );
        expect(trashId).toBeDefined();
        return fauxAssistantMessage(
          fauxToolCall("workspace_file_preview", {
            action: "preview",
            operation: "restore",
            trashId,
          }),
          { stopReason: "toolUse" },
        );
      },
      applyLatestPreview,
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(
          "Workspace file operation applied: restore",
        );
        return fauxAssistantMessage(
          "The file was moved, recovered from reversible trash, and verified.",
        );
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const registry = new ModelRegistry();
    registry.registerProvider(provider.provider);
    const runtime = new AgentRuntime(
      store,
      registry,
      undefined,
      undefined,
      undefined,
      files,
    );

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Move draft.txt to final.txt, trash it reversibly, then restore it.",
      model: { provider: "live-workspace-files", id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    expect(await readFile(path.join(workspaceRoot, "final.txt"), "utf8")).toBe(
      "live delivery\n",
    );
    expect((await files.listTrash(thread.id)).items).toEqual([]);
    expect(
      (await store.listEvents(thread.id)).filter(
        (event) => event.type === "workspace.file.mutated",
      ),
    ).toHaveLength(3);
    store.close();
  }, 30_000);
});

function applyLatestPreview(context: {
  messages: unknown[];
}): ReturnType<typeof fauxAssistantMessage> {
  const previewId = latestMatch(
    JSON.stringify(context.messages),
    /filepreview_[a-z0-9]{20}/gu,
  );
  expect(previewId).toBeDefined();
  return fauxAssistantMessage(
    fauxToolCall("workspace_file_apply", { previewId }),
    { stopReason: "toolUse" },
  );
}

function latestMatch(source: string, pattern: RegExp): string | undefined {
  return [...source.matchAll(pattern)].at(-1)?.[0];
}
