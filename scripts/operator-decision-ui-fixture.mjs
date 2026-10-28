import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { createApp, createServices } from "../apps/server/dist/app.js";

/** Real local HTTP, SQLite and tools; only the model is a deterministic fixture. */
export async function startDecisionUiFixture(root) {
  const services = await createServices({
    workspaceRoot: path.join(root, "workspace"),
    dataRoot: path.join(root, "state"),
    env: { NAPIER_E2E_MODEL_KEY: "fixture-only-never-sent" },
    startAutomation: false,
  });
  const provider = fauxProvider({ provider: "faux-decision-ui" });
  services.models.registerProvider(provider.provider);
  const store = services.store;
  await store.createCredentialReference({
    providerId: "openai",
    label: "Fixture readiness reference",
    source: { type: "environment", variable: "NAPIER_E2E_MODEL_KEY" },
  });
  const agent = await store.updateAgent(store.listAgents()[0].id, {
    model: { provider: "faux-decision-ui", id: "faux-1" },
    toolPolicy: "workspace",
    enabledTools: ["apply_patch"],
    enabledSubagents: [],
  });
  const app = createApp(services);
  app.use("/*", serveStatic({ root: path.resolve("apps/web/dist") }));
  app.get("*", async (c) =>
    c.html(await readFile("apps/web/dist/index.html", "utf8")),
  );
  const ready = Promise.withResolvers();
  const server = serve(
    { fetch: app.fetch, hostname: "127.0.0.1", port: 0 },
    (address) => ready.resolve(`http://127.0.0.1:${address.port}`),
  );
  return {
    store,
    provider,
    origin: await ready.promise,
    async seed(name) {
      const thread = await store.createThread({
        agentId: agent.id,
        title: name,
      });
      const run = await store.createRun({
        threadId: thread.id,
        agentId: agent.id,
      });
      const { decision } = await store.requestOperatorDecision({
        threadId: thread.id,
        runId: run.id,
        header: "Output",
        question: `Which output should ${name} produce?`,
        options: [
          { label: "File", description: "Create the agreed output file." },
          { label: "Stop", description: "Keep the task paused." },
        ],
        multiSelect: false,
      });
      await store.finishRun(run.id, "completed", {
        waitForOperatorDecisionId: decision.id,
      });
      return {
        name,
        thread,
        decision,
        base: `/api/threads/${thread.id}/operator-decisions/${decision.id}`,
      };
    },
    prepare(item, answer) {
      provider.setResponses([
        (context) => {
          assert.ok(JSON.stringify(context.messages).includes(answer));
          return fauxAssistantMessage(
            fauxToolCall("apply_patch", {
              operation: "create",
              path: `${item.name}.txt`,
              expectedSha256: null,
              content: `${answer}\n`,
            }),
            { stopReason: "toolUse" },
          );
        },
        fauxAssistantMessage(`Saved answer applied for ${item.name}.`),
        fauxAssistantMessage('{"facts":[]}'),
      ]);
    },
    async inspect(item, expectedRuns, answer) {
      const events = await store.listEvents(item.thread.id);
      const count = (type) =>
        events.filter((event) => event.type === type).length;
      const runs = store.listRuns(item.thread.id);
      assert.equal(runs.length, expectedRuns);
      assert.equal(count("operator.decision.answered"), 1);
      assert.equal(count("operator.decision.continued"), expectedRuns - 1);
      if (expectedRuns === 2) {
        const decision = (await store.listOperatorDecisions(item.thread.id))[0];
        assert.equal(
          runs.find((run) => run.id === decision.continuationRunId)?.status,
          "completed",
        );
        assert.equal(
          await readFile(
            path.join(root, "workspace", `${item.name}.txt`),
            "utf8",
          ),
          `${answer}\n`,
        );
        assert.equal(count("tool.started"), 1);
      }
      return {
        scenario: item.name,
        runs: runs.length,
        answerEvents: count("operator.decision.answered"),
        continuationEvents: count("operator.decision.continued"),
        toolStarts: count("tool.started"),
      };
    },
    async close() {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await services.shutdownLocalRuntime();
    },
  };
}
