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

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent Workspace file lifecycle", () => {
  it("previews and applies a real move through the Agent loop", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-agent-files-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "data");
    await Promise.all([
      mkdir(workspaceRoot, { recursive: true }),
      mkdir(dataRoot, { recursive: true }),
    ]);
    await writeFile(path.join(workspaceRoot, "draft.txt"), "deliverable\n");
    const store = new LocalStore({ workspaceRoot, dataRoot });
    await store.initialize();
    const manager = new WorkspaceFileMutationManager({
      store,
      workspaceRoot,
      dataRoot,
    });
    await manager.initialize();
    const agent = await store.updateAgent(store.listAgents()[0]!.id, {
      toolPolicy: "workspace",
      enabledTools: ["workspace_file_preview", "workspace_file_apply"],
    });
    const thread = await store.createThread({
      title: "Workspace file lifecycle",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "faux-workspace-files" });
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
      (context) => {
        const previewId = JSON.stringify(context.messages).match(
          /filepreview_[a-z0-9]{20}/u,
        )?.[0];
        expect(previewId).toBeDefined();
        return fauxAssistantMessage(
          fauxToolCall("workspace_file_apply", { previewId }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(
          "Postcondition: verified",
        );
        return fauxAssistantMessage(
          "The previewed Workspace move completed and was verified.",
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
      manager,
    );

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Move draft.txt to final.txt with a preview first.",
      model: { provider: "faux-workspace-files", id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    expect(await readFile(path.join(workspaceRoot, "final.txt"), "utf8")).toBe(
      "deliverable\n",
    );
    const events = await store.listEvents(thread.id);
    expect(
      events
        .filter((event) => event.type === "tool.started")
        .map((event) => [event.payload["toolName"], event.payload["effect"]]),
    ).toEqual([
      ["workspace_file_preview", "read"],
      ["workspace_file_apply", "write"],
    ]);
    for (const [toolName, sideEffect, concurrency] of [
      ["workspace_file_preview", "none", "safe"],
      ["workspace_file_apply", "reversible", "exclusive"],
    ] as const) {
      const started = events.find(
        (event) =>
          event.type === "tool.started" &&
          event.payload["toolName"] === toolName,
      );
      const completed = events.find(
        (event) =>
          event.type === "tool.completed" &&
          event.payload["toolName"] === toolName,
      );
      const startedProtocol = started?.payload["toolProtocol"] as
        | Record<string, unknown>
        | undefined;
      expect(startedProtocol).toEqual(
        expect.objectContaining({
          kind: "napier.tool-ui-projection",
          schemaVersion: 2,
          toolId: toolName,
          semanticVersion: "2.0.0",
          definitionSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          implementationSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          status: "started",
          sideEffect,
          concurrency,
          compatibilityMode: "native",
        }),
      );
      expect(completed?.payload["toolProtocol"]).toEqual(
        toolName === "workspace_file_apply"
          ? {
              ...startedProtocol,
              status: "completed",
              progress: {
                ...(startedProtocol?.["progress"] as Record<string, unknown>),
                stateSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
              },
            }
          : { ...startedProtocol, status: "completed" },
      );
    }
    expect(
      events.filter((event) => event.type === "workspace.file.mutated"),
    ).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          operation: "move",
          postcondition: "verified",
        }),
      }),
    ]);
    const serialized = JSON.stringify(
      events.filter(
        (event) =>
          event.type === "model.response" ||
          event.type.startsWith("tool.") ||
          event.type.startsWith("workspace.file."),
      ),
    );
    expect(serialized).not.toContain("draft.txt");
    expect(serialized).not.toContain("final.txt");
    expect(serialized).not.toContain("deliverable");
    store.close();
  });
});
