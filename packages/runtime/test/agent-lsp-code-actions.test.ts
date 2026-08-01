import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
import {
  controlledLspCodeActionsSandbox,
  diagnostic,
} from "./lsp-code-actions-test-fixture.js";
import { textEdit } from "./lsp-rename-test-fixture.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent LSP Code Actions integration", () => {
  it("selects a preferred missing-import fix, applies it, and verifies clean diagnostics", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-agent-code-action-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const targetPath = "src/private-usage.ts";
    const absoluteTarget = path.join(workspaceRoot, targetPath);
    const sourceBefore = 'export const title = formatTitle(" value ");\n';
    const insertion =
      'import { formatTitle } from "./private-definition.js";\n\n';
    const sourceAfter = `${insertion}${sourceBefore}`;
    await mkdir(path.dirname(absoluteTarget), { recursive: true });
    await Promise.all([
      writeFile(absoluteTarget, sourceBefore),
      writeFile(
        path.join(workspaceRoot, "src/private-definition.ts"),
        [
          "export function formatTitle(value: string): string {",
          "  return value.trim();",
          "}",
          "",
        ].join("\n"),
      ),
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
        "lsp_code_actions",
        "lsp_code_action_apply",
        "lsp_diagnostics",
      ],
    });
    const thread = await store.createThread({
      title: "Agent LSP Code Actions",
      agentId: agent.id,
    });
    const targetUri = pathToFileURL(await realpath(absoluteTarget)).href;
    const unresolved = {
      title: 'Add import from "./private-definition.js"',
      kind: "quickfix",
      isPreferred: true,
      command: {
        title: "",
        command: "_typescript.PRIVATE_COMMAND",
        arguments: [
          absoluteTarget,
          "PRIVATE_ARGUMENT",
          sourceBefore,
          "PRIVATE_DIAGNOSTIC",
        ],
      },
      data: { fixId: "PRIVATE_RESOLVE_DATA" },
    };
    const controlled = controlledLspCodeActionsSandbox({
      diagnostics: (_uri, source) =>
        source.includes(insertion)
          ? []
          : [diagnostic("PRIVATE_DIAGNOSTIC", 0, 21, 0, 32)],
      codeActions: () => [unresolved],
      codeActionResolve: () => ({
        ...unresolved,
        edit: {
          changes: {
            [targetUri]: [textEdit(insertion, 0, 0, 0, 0)],
          },
        },
      }),
    });
    const sandbox = controlled.sandbox;
    let applyPreviewId = "";
    const provider = fauxProvider({ provider: "faux-lsp-code-actions" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("lsp_code_actions", {
          path: targetPath,
          line: 1,
          character: 22,
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain("Preferred: true");
        expect(messages).toContain("Resolved: true");
        expect(messages).toContain("Resolve requests: 1");
        expect(messages).toContain("Command policy: deny_all");
        expect(messages).toContain("Command ignored: true");
        expect(messages).toContain(targetPath);
        expect(messages).toContain("formatTitle");
        expect(messages).toContain("private-definition.js");
        expect(messages).not.toContain("PRIVATE_COMMAND");
        expect(messages).not.toContain("PRIVATE_ARGUMENT");
        expect(messages).not.toContain("PRIVATE_DIAGNOSTIC");
        const previewId = messages.match(
          /Apply preview ID: (actionpreview_[a-z0-9]+)/u,
        )?.[1];
        expect(previewId).toMatch(/^actionpreview_/u);
        applyPreviewId = previewId ?? "";
        return fauxAssistantMessage(
          fauxToolCall("lsp_code_action_apply", { previewId }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain("LSP Code Action apply: applied");
        expect(messages).toContain("Postcondition: verified");
        expect(messages).toContain("Code Action diagnostics: improved");
        expect(messages).toContain("Diagnostics: 1 -> 0");
        expect(messages).toContain("command remained denied");
        return fauxAssistantMessage(
          fauxToolCall("lsp_diagnostics", { path: targetPath }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain("LSP diagnostics: clean");
        expect(messages).toContain("No diagnostics published.");
        return fauxAssistantMessage(
          "The preferred quick fix was applied and diagnostics are clean.",
        );
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const registry = new ModelRegistry();
    registry.registerProvider(provider.provider);
    const runtime = new AgentRuntime(store, registry, undefined, sandbox);

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Fix the missing import with a language-server quick fix.",
      model: { provider: "faux-lsp-code-actions", id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    expect(controlled.executeCommandCount()).toBe(0);
    expect(await readFile(absoluteTarget, "utf8")).toBe(sourceAfter);
    const events = await store.listEvents(thread.id);
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
      { toolName: "lsp_code_actions", effect: "read" },
      { toolName: "lsp_code_action_apply", effect: "write" },
      { toolName: "lsp_diagnostics", effect: "read" },
    ]);
    const codeActionsEvent = events.find(
      (event) =>
        event.type === "tool.completed" &&
        record(event.payload)?.["toolName"] === "lsp_code_actions",
    );
    expect(codeActionsEvent?.payload).toEqual(
      expect.objectContaining({
        outputRedacted: true,
        details: expect.objectContaining({
          kind: "napier.lsp-code-actions",
          status: "found",
          actionCount: 1,
          preferredActionCount: 1,
          commandIgnoredCount: 1,
          resolveSupported: true,
          resolveRequestCount: 1,
          resolvedActionCount: 1,
          resolveOmittedCount: 0,
          commandPolicy: "deny_all",
        }),
      }),
    );
    const applyEvent = events.find(
      (event) =>
        event.type === "tool.completed" &&
        record(event.payload)?.["toolName"] === "lsp_code_action_apply",
    );
    expect(record(applyEvent?.payload)?.["details"]).toEqual(
      expect.objectContaining({
        kind: "napier.lsp-code-action-apply",
        status: "applied",
        postcondition: "verified",
        fileCount: 1,
        editCount: 1,
        sourceResolved: true,
        sourceCommandIgnored: true,
        commandPolicy: "deny_all",
        diagnostics: expect.objectContaining({
          kind: "napier.lsp-code-action-apply-diagnostics",
          status: "improved",
          beforeDiagnosticCount: 1,
          afterDiagnosticCount: 0,
        }),
      }),
    );
    const durable = JSON.stringify(
      events.filter(
        (event) =>
          event.type === "model.response" || event.type.startsWith("tool."),
      ),
    );
    for (const secret of [
      targetPath,
      absoluteTarget,
      sourceBefore,
      sourceAfter,
      insertion,
      "PRIVATE_COMMAND",
      "PRIVATE_ARGUMENT",
      "PRIVATE_DIAGNOSTIC",
      "PRIVATE_RESOLVE_DATA",
      applyPreviewId,
    ]) {
      expect(durable).not.toContain(secret);
    }
    expect(
      verifyThreadReplayBundle(await exportThreadReplayBundle(store, thread.id))
        .status,
    ).toBe("valid");
    store.close();
  });
});

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
