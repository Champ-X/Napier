import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { agentCapabilityPresetUpdate } from "@napier/contracts/agent-capabilities";
import { afterEach, describe, expect, it } from "vitest";

import { createLocalAgentRuntime } from "../src/local-agent-runtime.js";
import {
  processReadySandbox,
  settledProcess,
} from "./process-run-readiness-test-fixture.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Capability Catalog Runtime", () => {
  it("activates a harness-omitted first-party tool on the next real step", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-catalog-runtime-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      sandbox: processReadySandbox("catalog-runtime-test", async () =>
        settledProcess(),
      ),
    });
    try {
      const agent = await services.store.updateAgent(
        services.store.listAgents()[0]!.id,
        agentCapabilityPresetUpdate("safe_automation"),
      );
      const thread = await services.store.createThread({
        title: "Capability Catalog activation",
        agentId: agent.id,
      });
      const provider = fauxProvider({ provider: "faux-catalog-runtime" });
      provider.setResponses([
        (context) => {
          const names = (context.tools ?? []).map((tool) => tool.name);
          expect(names).toContain("capability");
          expect(names).not.toContain("git_commit_apply");
          return fauxAssistantMessage(
            fauxToolCall("capability", {
              uri: "cap://tools/git_commit_apply",
            }),
            { stopReason: "toolUse" },
          );
        },
        (context) => {
          const names = (context.tools ?? []).map((tool) => tool.name);
          expect(names).toContain("capability");
          expect(names).toContain("git_commit_apply");
          expect(JSON.stringify(context.messages)).toContain(
            "cap://tools/git_commit_apply",
          );
          return fauxAssistantMessage("First-party capability activated.");
        },
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      services.models.registerProvider(provider.provider);

      const run = await services.kernel.runPrompt({
        threadId: thread.id,
        text: "Discover a commit capability and make it available without invoking it.",
        model: { provider: provider.provider.id, id: "faux-1" },
      });

      expect(run.status, run.error).toBe("completed");
      const harness = (await services.store.listEvents(thread.id)).filter(
        (event) => event.runId === run.id && event.type === "model.harness.resolved",
      );
      expect(harness).toHaveLength(2);
      expect(harness[0]?.payload["omittedToolNames"]).toContain(
        "git_commit_apply",
      );
      expect(harness[1]?.payload["activeToolNames"]).toContain(
        "git_commit_apply",
      );
    } finally {
      await services.shutdown();
    }
  }, 20_000);
});
