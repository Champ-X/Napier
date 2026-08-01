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

import { createApp, createServices } from "../src/app.js";

const temporaryRoots: string[] = [];
const openServices: Awaited<ReturnType<typeof createServices>>[] = [];

afterEach(async () => {
  for (const services of openServices.splice(0)) {
    await services.workspaceProcesses.shutdown();
    await services.extensions.shutdown();
    services.store.close();
  }
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("coder Subagent HTTP Agent path", () => {
  it("streams hash-only delegation and merge evidence through public SSE", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-coder-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    const sourcePath = "src/private-value.txt";
    const source = "value=1\n";
    await writeFile(path.join(workspaceRoot, sourcePath), source);
    const services = await createServices({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
    });
    openServices.push(services);
    const app = createApp(services);
    const agentId = services.store.listAgents()[0]!.id;
    const updated = await app.request(`/api/agents/${agentId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toolPolicy: "workspace",
        enabledTools: ["apply_patch", "lsp_diagnostics"],
        enabledSubagents: ["coder"],
      }),
    });
    expect(updated.status).toBe(200);
    const thread = await services.store.createThread({
      title: "Server coder Subagent",
      agentId,
    });
    const provider = fauxProvider({ provider: "faux-server-coder" });
    let previewId = "";
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("delegate_task", {
          role: "coder",
          description: "Update isolated private value",
          task: "Change the authorized value from 1 to 2.",
          writePaths: [sourcePath],
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("apply_patch", {
          operation: "replace",
          path: sourcePath,
          expectedSha256: sha256(source),
          edits: [{ oldText: "value=1", newText: "value=2" }],
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        JSON.stringify({
          summary: "Prepared the isolated candidate.",
          items: [],
          unknowns: [],
        }),
      ),
      (context) => {
        previewId =
          JSON.stringify(context.messages).match(
            /subworkpreview_[a-z0-9]{8,80}/u,
          )?.[0] ?? "";
        expect(previewId).toMatch(/^subworkpreview_/u);
        return fauxAssistantMessage(
          fauxToolCall("subagent_worktree_apply", { previewId }),
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage("The reviewed candidate was merged."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    services.models.registerProvider(provider.provider);

    const response = await app.request(`/api/threads/${thread.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Delegate and merge the bounded change.",
        model: { provider: provider.provider.id, id: "faux-1" },
      }),
    });

    expect(response.status).toBe(200);
    const stream = await response.text();
    expect(stream).toContain("event: done");
    expect(stream).toContain('"status":"completed"');
    expect(stream).toContain("napier.subagent-worktree-apply");
    expect(stream).not.toContain(previewId);
    expect(stream).not.toContain(sourcePath);
    expect(stream).not.toContain("value=2");
    expect(await readFile(path.join(workspaceRoot, sourcePath), "utf8")).toBe(
      "value=2\n",
    );
    const events = await services.store.listEvents(thread.id);
    const merge = events.find(
      (event) =>
        event.type === "tool.completed" &&
        record(event.payload)?.["toolName"] === "subagent_worktree_apply",
    );
    expect(record(merge?.payload)?.["details"]).toEqual(
      expect.objectContaining({
        kind: "napier.subagent-worktree-apply",
        status: "applied",
        fileCount: 1,
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    const durable = JSON.stringify(events);
    expect(durable).not.toContain(previewId);
    expect(durable).not.toContain("value=2");
  });
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
