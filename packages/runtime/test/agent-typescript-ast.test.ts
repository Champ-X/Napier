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
  exportThreadReplayBundle,
  LocalStore,
  ModelRegistry,
  verifyThreadReplayBundle,
} from "../src/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent TypeScript AST integration", () => {
  it("queries, previews, and applies one AST-bound edit through the normal Agent loop", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-agent-ast-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const source = [
      "export class PrivateWorker {",
      "  runPrivate(value: number): number {",
      "    return value * 2;",
      "  }",
      "}",
    ].join("\n");
    const replacement = [
      "runPrivate(value: number): number {",
      "    return value * 3;",
      "  }",
    ].join("\n");
    await writeFile(path.join(workspaceRoot, "worker.ts"), source);
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
    });
    await store.initialize();
    const agent = await store.updateAgent(store.listAgents()[0]!.id, {
      toolPolicy: "workspace",
      enabledTools: ["ast_query", "ast_edit_preview", "apply_patch"],
    });
    const thread = await store.createThread({
      title: "Agent AST edit",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "faux-typescript-ast" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("ast_query", {
          path: "worker.ts",
          selector: {
            kind: "method",
            name: "runPrivate",
            ancestorKind: "class",
            ancestorName: "PrivateWorker",
          },
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const messages = JSON.stringify(context.messages);
        const fileSha256 = messages.match(/File SHA-256: ([a-f0-9]{64})/u)?.[1];
        const nodeSha256 = messages.match(/nodeSha256=([a-f0-9]{64})/u)?.[1];
        expect(fileSha256).toBeDefined();
        expect(nodeSha256).toBeDefined();
        return fauxAssistantMessage(
          fauxToolCall("ast_edit_preview", {
            path: "worker.ts",
            expectedSha256: fileSha256,
            selector: {
              kind: "method",
              name: "runPrivate",
              ancestorKind: "class",
              ancestorName: "PrivateWorker",
            },
            nodeSha256,
            operation: "replace",
            replacement,
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const messages = JSON.stringify(context.messages);
        const expectedSha256 = messages.match(
          /expectedSha256=([a-f0-9]{64})/u,
        )?.[1];
        expect(messages).toContain("OLD TEXT");
        expect(messages).toContain("return value * 2;");
        expect(messages).toContain("NEW TEXT");
        expect(messages).toContain("return value * 3;");
        expect(expectedSha256).toBeDefined();
        return fauxAssistantMessage(
          fauxToolCall("apply_patch", {
            operation: "replace",
            path: "worker.ts",
            expectedSha256,
            edits: [
              {
                oldText: [
                  "runPrivate(value: number): number {",
                  "    return value * 2;",
                  "  }",
                ].join("\n"),
                newText: replacement,
              },
            ],
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(
          "Updated worker.ts atomically",
        );
        return fauxAssistantMessage(
          "The AST-selected method now multiplies by three.",
        );
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const runtime = new AgentRuntime(store, models);

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Structurally update the private worker method.",
      model: { provider: "faux-typescript-ast", id: "faux-1" },
    });

    expect(run.status, run.error).toBe("completed");
    expect(await readFile(path.join(workspaceRoot, "worker.ts"), "utf8")).toBe(
      source.replace("return value * 2;", "return value * 3;"),
    );
    const events = await store.listEvents(thread.id);
    expect(
      events
        .filter((event) => event.type === "tool.started")
        .map((event) => record(event.payload)?.["effect"]),
    ).toEqual(["read", "read", "write"]);
    const durableAst = JSON.stringify(
      events.filter(
        (event) =>
          record(event.payload)?.["toolName"] === "ast_query" ||
          record(event.payload)?.["toolName"] === "ast_edit_preview",
      ),
    );
    expect(durableAst).not.toContain("worker.ts");
    expect(durableAst).not.toContain("PrivateWorker");
    expect(durableAst).not.toContain("runPrivate");
    expect(durableAst).not.toContain("return value");
    expect(
      verifyThreadReplayBundle(await exportThreadReplayBundle(store, thread.id))
        .status,
    ).toBe("valid");
    store.close();
  }, 20_000);

  it("keeps absolute workspace paths out of live and durable tool failures", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-agent-ast-error-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "PRIVATE_ABSOLUTE_WORKSPACE");
    await mkdir(workspaceRoot);
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
    });
    await store.initialize();
    const agent = await store.updateAgent(store.listAgents()[0]!.id, {
      toolPolicy: "observe",
      enabledTools: ["ast_query"],
    });
    const thread = await store.createThread({
      title: "Agent AST error privacy",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "faux-typescript-ast-error" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("ast_query", {
          path: "private-missing.ts",
          selector: { kind: "function", name: "privateMissing" },
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain("ast_query target is unavailable");
        expect(messages).not.toContain(workspaceRoot);
        return fauxAssistantMessage(
          "The unavailable AST target was reported without a host path.",
        );
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const runtime = new AgentRuntime(store, models);

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Inspect the unavailable structural target.",
      model: { provider: "faux-typescript-ast-error", id: "faux-1" },
    });

    expect(run.status, run.error).toBe("completed");
    const events = await store.listEvents(thread.id);
    expect(
      events.find(
        (event) =>
          event.type === "tool.failed" &&
          record(event.payload)?.["toolName"] === "ast_query",
      )?.payload,
    ).toEqual(
      expect.objectContaining({
        status: "failed",
        outputRedacted: true,
        outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(JSON.stringify(events)).not.toContain(workspaceRoot);
    expect(JSON.stringify(events)).not.toContain("private-missing.ts");
    store.close();
  });
});

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
