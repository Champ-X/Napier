import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import type { OsSandboxAdapter } from "@napier/runtime";
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
    await Promise.all([
      mkdir(path.join(workspaceRoot, "src"), { recursive: true }),
      mkdir(path.join(workspaceRoot, "node_modules/vitest"), {
        recursive: true,
      }),
    ]);
    const sourcePath = "src/private-value.txt";
    const source = "value=1\n";
    await Promise.all([
      writeFile(path.join(workspaceRoot, sourcePath), source),
      writeFile(
        path.join(workspaceRoot, "node_modules/vitest/vitest.mjs"),
        "// fixed verifier fixture\n",
      ),
    ]);
    const services = await createServices({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
      sandbox: passingSandbox(),
    });
    openServices.push(services);
    const app = createApp(services);
    const agentId = services.store.listAgents()[0]!.id;
    const updated = await app.request(`/api/agents/${agentId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toolPolicy: "workspace",
        enabledTools: ["apply_patch", "lsp_diagnostics", "verify_workspace"],
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
        fauxToolCall("verify_workspace", {
          kind: "test",
          target: sourcePath,
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
        expect(JSON.stringify(context.messages)).toContain(
          "Candidate verification: 1 fresh / 1 passed / 0 failed / 0 stale",
        );
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
    expect(stream).not.toContain("TOP_SECRET_CANDIDATE_STDOUT");
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
        candidateVerificationAttemptCount: 1,
        candidateVerificationFreshCount: 1,
        candidateVerificationPassedCount: 1,
        candidateVerificationFailedCount: 0,
        candidateVerificationStaleCount: 0,
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    const durable = JSON.stringify(events);
    expect(durable).not.toContain(previewId);
    expect(durable).not.toContain("value=2");
    expect(durable).not.toContain("TOP_SECRET_CANDIDATE_STDOUT");
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

function passingSandbox(): OsSandboxAdapter {
  return {
    id: "candidate-server-sandbox",
    async launch() {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const exit = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) => {
        setTimeout(() => {
          stdout.end("TOP_SECRET_CANDIDATE_STDOUT");
          stderr.end();
          resolve({ code: 0, signal: null });
        }, 0);
      });
      return {
        stdin,
        stdout,
        stderr,
        exit,
        async terminate() {
          stdout.end();
          stderr.end();
          await exit;
        },
      };
    },
  };
}
