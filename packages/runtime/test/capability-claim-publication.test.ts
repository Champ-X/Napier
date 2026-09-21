import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { agentCapabilityPresetUpdate } from "@napier/contracts/agent-capabilities";
import { expect, it } from "vitest";
import { createLocalAgentRuntime } from "../src/local-agent-runtime.js";
import {
  processReadySandbox,
  settledProcess,
} from "./process-run-readiness-test-fixture.js";

it("publishes non-denial statements without a spurious recovery turn or failed Run", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "napier-claim-publication-"));
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const services = await createLocalAgentRuntime({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
    sandbox: processReadySandbox("claim-publication", async () =>
      settledProcess(),
    ),
  });
  try {
    const agent = await services.store.updateAgent(
      services.store.listAgents()[0]!.id,
      agentCapabilityPresetUpdate("full_access"),
    );
    const thread = await services.store.createThread({
      title: "Capability grammar",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "claim-publication" });
    const answer =
      "Bytecode disabled: workspace_process remains usable. I made no network calls and no file changes.";
    provider.setResponses([
      (context) => {
        expect((context.tools ?? []).map((tool) => tool.name)).toContain(
          "workspace_process",
        );
        return fauxAssistantMessage(answer);
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    services.models.registerProvider(provider.provider);
    const run = await services.kernel.runPrompt({
      threadId: thread.id,
      text: "Explain whether disabling bytecode disables workspace_process; do not execute tools.",
      model: { provider: provider.provider.id, id: "faux-1" },
    });
    expect(run.status, run.error).toBe("completed");
    const events = await services.store.listRunEvents(run.id);
    expect(
      events
        .filter((e) => e.type === "message.assistant")
        .map((e) => e.payload["text"]),
    ).toContain(answer);
    expect(
      events.some(
        (e) =>
          e.type === "model.response" &&
          e.payload["responseDisposition"] === "capability_recovery_required",
      ),
    ).toBe(false);
    expect(events.filter((e) => e.type === "tool.started")).toHaveLength(0);
    expect(
      events.filter(
        (e) =>
          e.type === "context.model_invocation" &&
          e.payload["purpose"] === "agent_turn",
      ),
    ).toHaveLength(1);
  } finally {
    await services.shutdown();
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
