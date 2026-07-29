import { mkdtemp, rm } from "node:fs/promises";
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
  createPlatformSandboxAdapter,
  LocalStore,
  ModelRegistry,
} from "../src/index.js";

const LIVE_COMMAND_ENABLED = process.env.NAPIER_LIVE_COMMAND_SMOKE === "1";
const describeLive = LIVE_COMMAND_ENABLED ? describe : describe.skip;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describeLive("live sandbox command smoke", () => {
  it("runs a Node task through the real Agent and OS sandbox", async () => {
    const workspaceRoot = path.resolve(import.meta.dirname, "../../..");
    const dataRoot = await mkdtemp(path.join(tmpdir(), "napier-live-command-"));
    temporaryRoots.push(dataRoot);
    const store = new LocalStore({
      workspaceRoot,
      dataRoot,
    });
    await store.initialize();
    const agent = await store.updateAgent(store.listAgents()[0]!.id, {
      toolPolicy: "workspace",
      enabledTools: ["run_command"],
    });
    const thread = await store.createThread({
      title: "Live command smoke",
      agentId: agent.id,
    });
    const commandSource = [
      "const fs = require('node:fs');",
      "const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));",
      "process.stdout.write(`${pkg.name}@${pkg.version}\\n`);",
    ].join(" ");
    const provider = fauxProvider({ provider: "live-command-smoke" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("run_command", {
          runtime: "node",
          args: ["-e", commandSource],
          timeoutMs: 10_000,
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        expect(JSON.stringify(context.messages)).toContain("napier@0.1.0");
        return fauxAssistantMessage("The sandboxed package check completed.");
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const registry = new ModelRegistry();
    registry.registerProvider(provider.provider);
    const runtime = new AgentRuntime(
      store,
      registry,
      undefined,
      createPlatformSandboxAdapter(),
    );

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Read the package identity with the sandboxed Node tool.",
      model: { provider: "live-command-smoke", id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    const events = await store.listEvents(thread.id);
    const completed = events.find(
      (event) =>
        event.type === "tool.completed" &&
        event.payload &&
        !Array.isArray(event.payload) &&
        typeof event.payload === "object" &&
        event.payload["toolName"] === "run_command",
    );
    expect(completed?.payload).toEqual(
      expect.objectContaining({
        outputRedacted: true,
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        details: expect.objectContaining({
          runtime: "node",
          status: "succeeded",
          workspaceAccess: "read_only",
          networkAccess: "denied",
          exitCode: 0,
        }),
      }),
    );
    expect(JSON.stringify(events)).not.toContain(commandSource);
    expect(JSON.stringify(events)).not.toContain("napier@0.1.0");
  }, 30_000);
});
