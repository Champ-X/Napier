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
  sha256,
  verifyThreadReplayBundle,
} from "../src/index.js";
import { directLspSandbox } from "./lsp-rename-test-fixture.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent LSP symbols integration", () => {
  it("uses a semantic method range to read, patch, and verify real TypeScript", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-agent-symbols-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const targetPath = "src/private-formatter.ts";
    const absoluteTarget = path.join(workspaceRoot, targetPath);
    const sourceBefore = [
      "export class PrivateFormatter {",
      "  format(value: string): string {",
      "    return value.trim();",
      "  }",
      "}",
      "",
    ].join("\n");
    const oldMethod = [
      "  format(value: string): string {",
      "    return value.trim();",
      "  }",
    ].join("\n");
    const newMethod = [
      "  format(value: string): string {",
      "    return value.trim().toUpperCase();",
      "  }",
    ].join("\n");
    const sourceAfter = sourceBefore.replace(oldMethod, newMethod);
    await mkdir(path.dirname(absoluteTarget), { recursive: true });
    await Promise.all([
      writeFile(absoluteTarget, sourceBefore),
      writeFile(
        path.join(workspaceRoot, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            noEmit: true,
            module: "NodeNext",
            moduleResolution: "NodeNext",
          },
          include: ["src/**/*.ts"],
        }),
      ),
    ]);
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
    });
    await store.initialize();
    const agent = await store.updateAgent(store.listAgents()[0]!.id, {
      toolPolicy: "workspace",
      enabledTools: [
        "lsp_symbols",
        "read_file",
        "apply_patch",
        "lsp_diagnostics",
      ],
    });
    const thread = await store.createThread({
      title: "Agent LSP symbols",
      agentId: agent.id,
    });
    let symbolContext = "";
    let readContext = "";
    const provider = fauxProvider({ provider: "faux-lsp-symbols" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("lsp_symbols", {
          path: targetPath,
          maxSymbols: 20,
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        symbolContext = JSON.stringify(context.messages);
        return fauxAssistantMessage(
          fauxToolCall("read_file", {
            path: targetPath,
            startLine: 2,
            endLine: 4,
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        readContext = JSON.stringify(context.messages);
        return fauxAssistantMessage(
          fauxToolCall("apply_patch", {
            operation: "replace",
            path: targetPath,
            expectedSha256: sha256(sourceBefore),
            edits: [{ oldText: oldMethod, newText: newMethod }],
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain("Patch diagnostics: clean");
        expect(messages).toContain("Diagnostics: 0 -> 0");
        expect(messages).toContain(sha256(sourceAfter));
        return fauxAssistantMessage(
          fauxToolCall("lsp_diagnostics", { path: targetPath }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain("LSP diagnostics: clean");
        return fauxAssistantMessage(
          "The semantic method range was updated and diagnostics are clean.",
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
      directLspSandbox(),
    );

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Uppercase the formatter output using semantic symbols.",
      model: { provider: "faux-lsp-symbols", id: "faux-1" },
    });

    expect(run.status, run.error).toBe("completed");
    const events = await store.listEvents(thread.id);
    expect(await readFile(absoluteTarget, "utf8")).toBe(sourceAfter);
    expect(symbolContext).toContain('class \\"PrivateFormatter\\"');
    expect(symbolContext).toContain('method \\"format\\"');
    expect(symbolContext).toContain("Range: 2:3-4:4");
    expect(symbolContext).toContain(sha256(sourceBefore));
    expect(readContext).toContain("format(value: string): string");
    expect(readContext).toContain("return value.trim();");
    expect(readContext).toContain(sha256(sourceBefore));
    expect(
      events
        .filter(
          (event) => event.type === "tool.started" && record(event.payload),
        )
        .map((event) => ({
          toolName: record(event.payload)?.["toolName"],
          effect: record(event.payload)?.["effect"],
        })),
    ).toEqual([
      { toolName: "lsp_symbols", effect: "read" },
      { toolName: "read_file", effect: "read" },
      { toolName: "apply_patch", effect: "write" },
      { toolName: "lsp_diagnostics", effect: "read" },
    ]);
    const symbolsEvent = events.find(
      (event) =>
        event.type === "tool.completed" &&
        record(event.payload)?.["toolName"] === "lsp_symbols",
    );
    expect(symbolsEvent?.payload).toEqual(
      expect.objectContaining({
        outputRedacted: true,
        details: expect.objectContaining({
          kind: "napier.lsp-symbols",
          status: "found",
          responseShape: "hierarchical",
          symbolCount: 2,
          omittedSymbolCount: 0,
        }),
      }),
    );
    const durableSymbols = JSON.stringify(
      events.filter(
        (event) =>
          record(event.payload)?.["toolName"] === "lsp_symbols" ||
          (event.type === "model.response" &&
            modelResponseCallsTool(event.payload, "lsp_symbols")),
      ),
    );
    for (const privateValue of [
      targetPath,
      absoluteTarget,
      "PrivateFormatter",
      oldMethod,
      sourceBefore,
    ]) {
      expect(durableSymbols).not.toContain(privateValue);
    }
    expect(
      verifyThreadReplayBundle(await exportThreadReplayBundle(store, thread.id))
        .status,
    ).toBe("valid");
    store.close();
  }, 30_000);
});

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function modelResponseCallsTool(value: unknown, toolName: string): boolean {
  const calls = record(value)?.["toolCalls"];
  return (
    Array.isArray(calls) &&
    calls.some((call) => record(call)?.["name"] === toolName)
  );
}
