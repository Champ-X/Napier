import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { OsSandboxAdapter } from "@napier/runtime";
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

describe("write-linked tests HTTP Agent path", () => {
  it("streams one patch with selected test evidence through public SSE", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-server-linked-test-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const sourcePath = "src/private-price.ts";
    const testPath = "test/private-price.test.ts";
    const source = "export const privatePrice = 10;\n";
    await Promise.all([
      mkdir(path.join(workspaceRoot, "src"), { recursive: true }),
      mkdir(path.join(workspaceRoot, "test"), { recursive: true }),
      mkdir(path.join(workspaceRoot, "node_modules/vitest"), {
        recursive: true,
      }),
    ]);
    await Promise.all([
      writeFile(path.join(workspaceRoot, sourcePath), source),
      writeFile(
        path.join(workspaceRoot, testPath),
        'import { privatePrice } from "../src/private-price.js"; export const observed = privatePrice;\n',
      ),
      writeFile(
        path.join(workspaceRoot, "node_modules/vitest/vitest.mjs"),
        [
          'import { readFileSync } from "node:fs";',
          "const target = process.argv.at(-1);",
          'if (!target || !readFileSync(target, "utf8").includes("privatePrice")) process.exit(2);',
          'process.stdout.write("PRIVATE_SELECTED_TEST_OUTPUT");',
          "",
        ].join("\n"),
      ),
    ]);
    const services = await createServices({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
      sandbox: directSandbox(),
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
            enabledTools: ["apply_patch", "verify_workspace"],
          }),
        })
      ).status,
    ).toBe(200);
    const thread = await services.store.createThread({
      title: "Server write-linked tests",
      agentId,
    });
    const provider = fauxProvider({ provider: "faux-server-linked-tests" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("apply_patch", {
          operation: "replace",
          path: sourcePath,
          expectedSha256: sha256(source),
          edits: [{ oldText: "10", newText: "12" }],
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain("Write-linked tests: passed");
        expect(messages).toContain(testPath);
        return fauxAssistantMessage("The relevant test passed.");
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    services.models.registerProvider(provider.provider);

    const response = await app.request(`/api/threads/${thread.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Update the private price and verify the relevant test.",
        model: { provider: "faux-server-linked-tests", id: "faux-1" },
      }),
    });

    expect(response.status).toBe(200);
    const stream = await response.text();
    expect(stream).toContain("event: done");
    expect(stream).toContain('"status":"completed"');
    expect(stream).toContain("write-linked-test-verification");
    expect(stream).not.toContain(sourcePath);
    expect(stream).not.toContain(testPath);
    expect(stream).not.toContain("PRIVATE_SELECTED_TEST_OUTPUT");
    expect(await readFile(path.join(workspaceRoot, sourcePath), "utf8")).toBe(
      "export const privatePrice = 12;\n",
    );
    const events = await services.store.listEvents(thread.id);
    const patch = events.find(
      (event) =>
        event.type === "tool.completed" &&
        record(event.payload)?.["toolName"] === "apply_patch",
    );
    expect(record(record(patch?.payload)?.["details"])?.["tests"]).toEqual(
      expect.objectContaining({
        status: "passed",
        selectedTestCount: 1,
        changedSymbolCount: 1,
      }),
    );
    const durable = JSON.stringify(events);
    expect(durable).not.toContain(sourcePath);
    expect(durable).not.toContain(testPath);
    expect(durable).not.toContain("privatePrice");
    expect(durable).not.toContain("PRIVATE_SELECTED_TEST_OUTPUT");
  }, 20_000);
});

function directSandbox(): OsSandboxAdapter {
  return {
    id: "direct-server-linked-tests",
    async launch(request) {
      const child = spawn(request.command, request.args, {
        cwd: request.cwd,
        env: { ...request.env },
        detached: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const exit = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) =>
        child.once("exit", (code, signal) => resolve({ code, signal })),
      );
      return {
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        exit,
        async terminate() {
          if (
            child.exitCode === null &&
            child.signalCode === null &&
            child.pid !== undefined
          ) {
            try {
              process.kill(-child.pid, "SIGTERM");
            } catch {
              child.kill("SIGTERM");
            }
          }
          await exit;
        },
      };
    },
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
