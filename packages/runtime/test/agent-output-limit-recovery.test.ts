import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxThinking,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { AgentRuntime } from "../src/agent-runtime.js";
import { AgentToolDisplayStore } from "../src/agent-tool-display-store.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";

it("recovers a rejected truncated write with no side effects and visible diagnostics", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "napier-output-recovery-"));
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot);
  const store = new LocalStore({ workspaceRoot, dataRoot });
  try {
    await store.initialize();
    const agent = store.listAgents()[0]!;
    await store.updateAgent(agent.id, {
      enabledTools: ["apply_patch", "list_files"],
      toolPolicy: "workspace",
      thinkingLevel: "high",
    });
    const thread = await store.createThread({
      title: "Output recovery",
      agentId: agent.id,
    });
    const provider = fauxProvider({
      provider: "output-recovery",
      models: [{ id: "reasoning", reasoning: true }],
    });
    const content =
      "export const values = " +
      JSON.stringify(Array.from({ length: 3000 }, (_, i) => i)) +
      ";\n";
    let continued = false;
    provider.setResponses([
      fauxAssistantMessage(
        [fauxThinking("Inspect src/index.mjs, then create its data module.")],
        { stopReason: "length" },
      ),
      (context, options) => {
        expect(options?.reasoning).toBe("minimal");
        expect(options?.maxTokens).toBeGreaterThan(2048);
        return fauxAssistantMessage(
          [
            fauxToolCall(
              "apply_patch",
              {
                operation: "create",
                path: "data.mjs",
                expectedSha256: null,
                content: "INCOMPLETE",
              },
              { id: "truncated_write" },
            ),
          ],
          { stopReason: "length" },
        );
      },
      async (context, options) => {
        await expect(
          readFile(path.join(workspaceRoot, "data.mjs")),
        ).rejects.toMatchObject({ code: "ENOENT" });
        expect(JSON.stringify(context.messages)).toContain(
          "Internal output-limit recovery",
        );
        expect(options?.reasoning).toBe("minimal");
        expect(options?.maxTokens).toBeGreaterThan(2048);
        continued = true;
        return fauxAssistantMessage([
          fauxToolCall(
            "apply_patch",
            {
              operation: "create",
              path: "data.mjs",
              expectedSha256: null,
              content,
            },
            { id: "complete_write" },
          ),
        ]);
      },
      ...["inspect_one", "inspect_two"].map(
        (id) =>
          (_context: unknown, options: { reasoning?: string } | undefined) => {
            expect(options?.reasoning).toBe("minimal");
            return fauxAssistantMessage([
              fauxToolCall("list_files", { path: "." }, { id }),
            ]);
          },
      ),
      (_context, options) => {
        expect(options?.reasoning).toBe("high");
        return fauxAssistantMessage("Created the data module.");
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const run = await new AgentRuntime(store, models).runPrompt({
      threadId: thread.id,
      text: "Create data.mjs.",
      model: { provider: "output-recovery", id: "reasoning" },
    });
    expect(run.status, run.error).toBe("completed");
    expect(continued).toBe(true);
    expect(await readFile(path.join(workspaceRoot, "data.mjs"), "utf8")).toBe(
      content,
    );
    const events = await store.listEvents(thread.id);
    expect(
      events
        .filter((e) => e.type === "tool.started")
        .map((e) => e.payload["callId"]),
    ).toEqual(["complete_write", "inspect_one", "inspect_two"]);
    expect(
      events.find((e) => e.type === "tool.failed")?.payload["toolFailure"],
    ).toMatchObject({
      class: "invalid_input",
      disposition: "correct_input",
      fatalToSession: false,
    });
    const displays = await new AgentToolDisplayStore(dataRoot).listThread(
      thread.id,
    );
    expect(
      displays.find((d) => d.callId === "truncated_write")?.error,
    ).toContain("output token limit");
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
