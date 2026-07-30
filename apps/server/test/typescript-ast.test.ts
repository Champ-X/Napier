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

describe("TypeScript AST HTTP Agent path", () => {
  it("streams query, edit preview, and CAS application with hash-only evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-ast-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
    const targetPath = "private-server-worker.ts";
    const source = [
      "export class PrivateServerWorker {",
      "  executePrivate(value: number): number {",
      "    return value * 2;",
      "  }",
      "}",
    ].join("\n");
    const replacement = [
      "executePrivate(value: number): number {",
      "    return value * 3;",
      "  }",
    ].join("\n");
    await writeFile(path.join(workspaceRoot, targetPath), source);
    const services = await createServices({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
    });
    openServices.push(services);
    const app = createApp(services);
    const agentId = services.store.listAgents()[0]!.id;
    expect(
      (
        await app.request(`/api/agents/${agentId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            toolPolicy: "workspace",
            enabledTools: ["ast_query", "ast_edit_preview", "apply_patch"],
          }),
        })
      ).status,
    ).toBe(200);
    const thread = await services.store.createThread({
      title: "Server TypeScript AST",
      agentId,
    });
    const selector = {
      kind: "method",
      name: "executePrivate",
      ancestorKind: "class",
      ancestorName: "PrivateServerWorker",
    };
    const provider = fauxProvider({ provider: "faux-server-ast" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("ast_query", {
          path: targetPath,
          selector,
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
            path: targetPath,
            expectedSha256: fileSha256,
            selector,
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
            path: targetPath,
            expectedSha256,
            edits: [
              {
                oldText: [
                  "executePrivate(value: number): number {",
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
          `Updated ${targetPath} atomically`,
        );
        return fauxAssistantMessage("The selected method was updated.");
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    services.models.registerProvider(provider.provider);

    const response = await app.request(`/api/threads/${thread.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Update the selected method structurally.",
        model: { provider: "faux-server-ast", id: "faux-1" },
      }),
    });

    expect(response.status).toBe(200);
    const stream = await response.text();
    expect(stream).toContain("event: done");
    expect(stream).toContain('"status":"completed"');
    expect(stream).toContain("tool.completed");
    expect(stream).not.toContain("PrivateServerWorker");
    expect(stream).not.toContain("executePrivate");
    expect(stream).not.toContain("return value");
    expect(await readFile(path.join(workspaceRoot, targetPath), "utf8")).toBe(
      source.replace("return value * 2;", "return value * 3;"),
    );
    const events = await services.store.listEvents(thread.id);
    const completed = events.filter(
      (event) =>
        event.type === "tool.completed" &&
        ["ast_query", "ast_edit_preview", "apply_patch"].includes(
          String(record(event.payload)?.["toolName"]),
        ),
    );
    expect(completed).toHaveLength(3);
    expect(completed[0]?.payload["details"]).toEqual(
      expect.objectContaining({
        kind: "napier.typescript-ast",
        action: "query",
        status: "found",
        matchedNodeCount: 1,
      }),
    );
    expect(completed[1]?.payload["details"]).toEqual(
      expect.objectContaining({
        kind: "napier.typescript-ast",
        action: "edit_preview",
        operation: "replace",
        targetKind: "method",
      }),
    );
    const durable = JSON.stringify(completed);
    expect(durable).not.toContain(targetPath);
    expect(durable).not.toContain("PrivateServerWorker");
    expect(durable).not.toContain("executePrivate");
    expect(durable).not.toContain("return value");
  }, 20_000);
});

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
