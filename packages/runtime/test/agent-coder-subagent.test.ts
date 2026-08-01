import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { ModelRegistry } from "../src/models.js";
import { exportThreadReplayBundle } from "../src/replay.js";
import { LocalStore } from "../src/store.js";
import { verifyThreadReplayBundle } from "../src/thread-bundles.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent coder Subagent", () => {
  it("delegates, reviews, and applies an isolated candidate through one Run", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-agent-coder-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    const source = "value=1\n";
    await writeFile(path.join(workspaceRoot, "src/value.txt"), source);
    const store = new LocalStore({
      dataRoot: path.join(root, "data"),
      workspaceRoot,
    });
    await store.initialize();
    const agent = await store.updateAgent(store.listAgents()[0]!.id, {
      toolPolicy: "workspace",
      enabledTools: ["apply_patch", "lsp_diagnostics"],
      enabledSubagents: ["coder"],
    });
    const thread = await store.createThread({
      title: "Coder worktree",
      agentId: agent.id,
    });
    const faux = fauxProvider({ provider: "faux-coder-worktree" });
    let previewId = "";
    faux.setResponses([
      (context) => {
        expect(context.tools?.map((tool) => tool.name)).toEqual(
          expect.arrayContaining(["delegate_task", "subagent_worktree_apply"]),
        );
        return fauxAssistantMessage(
          fauxToolCall("delegate_task", {
            role: "coder",
            description: "Update the isolated value",
            task: "Change the authorized value from 1 to 2.",
            writePaths: ["src/value.txt"],
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        expect(context.systemPrompt).toContain("private workspace snapshot");
        expect(context.tools?.map((tool) => tool.name)).not.toContain(
          "delegate_task",
        );
        return fauxAssistantMessage(
          fauxToolCall("apply_patch", {
            operation: "replace",
            path: "src/value.txt",
            expectedSha256: sha256(source),
            edits: [{ oldText: "value=1", newText: "value=2" }],
          }),
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage(
        JSON.stringify({
          summary: "Prepared the requested candidate.",
          items: [
            {
              kind: "finding",
              severity: "info",
              title: "Value updated",
              detail: "The isolated candidate contains the requested value.",
              evidence: [{ path: "src/value.txt", lineStart: 1, lineEnd: 1 }],
            },
          ],
          unknowns: [],
        }),
      ),
      (context) => {
        const serialized = JSON.stringify(context.messages);
        previewId =
          serialized.match(/subworkpreview_[a-z0-9]{8,80}/u)?.[0] ?? "";
        expect(previewId).toMatch(/^subworkpreview_/u);
        expect(serialized).toContain("src/value.txt");
        return fauxAssistantMessage(
          fauxToolCall("subagent_worktree_apply", { previewId }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(
          "Subagent worktree apply: applied",
        );
        return fauxAssistantMessage(
          "The isolated coder candidate was reviewed and merged.",
        );
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(faux.provider);
    const runtime = new AgentRuntime(store, models);

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Delegate the bounded change and merge it only after review.",
      model: { provider: faux.provider.id, id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    expect(
      await readFile(path.join(workspaceRoot, "src/value.txt"), "utf8"),
    ).toBe("value=2\n");
    const events = await store.listEvents(thread.id);
    const merge = events.find(
      (event) =>
        event.type === "tool.completed" &&
        event.payload["toolName"] === "subagent_worktree_apply",
    );
    expect(merge?.payload["details"]).toEqual(
      expect.objectContaining({
        kind: "napier.subagent-worktree-apply",
        status: "applied",
        fileCount: 1,
        taskId: expect.stringMatching(/^task_/u),
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    const durable = JSON.stringify(events);
    expect(durable).not.toContain(previewId);
    expect(durable).not.toContain("value=2");
    expect(
      events.find(
        (event) =>
          event.type === "tool.started" &&
          event.payload["toolName"] === "delegate_task",
      )?.payload,
    ).toEqual(
      expect.objectContaining({
        inputRedacted: true,
        inputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    const replay = await exportThreadReplayBundle(store, thread.id);
    expect(verifyThreadReplayBundle(replay).status).toBe("valid");
  });
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
