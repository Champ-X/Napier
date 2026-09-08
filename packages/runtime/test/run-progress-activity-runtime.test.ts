import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { sha256 } from "../src/ed25519.js";
import { DEFAULT_RUN_CONVERGENCE_POLICY } from "../src/run-convergence-policy.js";
import { ModelRegistry } from "../src/models.js";
import { projectValidatedRunProgressLedger } from "../src/run-progress-payload-codec.js";
import { processReadyAgentRuntime } from "./process-run-readiness-test-fixture.js";
import {
  cleanupProgressFixtures,
  createFixture,
} from "./run-progress-vector-test-support.js";

afterEach(cleanupProgressFixtures);

describe("AgentRuntime evidence-driven continuation", () => {
  it("finishes an existing artifact after more than six inspection turns without manual continuation", async () => {
    const fixture = await createFixture("inspect-and-deliver");
    await fixture.store.updateAgent(fixture.agentId, {
      enabledTools: ["read_file", "apply_patch", "list_files", "search_files"],
      enabledSkills: [],
      enabledSubagents: [],
    });
    const artifactPath = `outputs/${fixture.threadId}/article.html`;
    // Seed a persisted artifact as a resumed or follow-up task would encounter.
    await mkdir(
      path.dirname(path.join(fixture.store.workspaceRoot, artifactPath)),
      { recursive: true },
    );
    const draft = Array.from(
      { length: 12 },
      (_, index) => `<p>Section ${index + 1}</p>`,
    ).join("\n");
    await writeFile(
      path.join(fixture.store.workspaceRoot, artifactPath),
      draft,
    );
    const provider = fauxProvider({
      provider: "faux-progress-activity",
      tokenSize: { min: 10000, max: 10000 },
    });
    provider.setResponses([
      ...Array.from({ length: 8 }, (_, index) =>
        fauxAssistantMessage(
          fauxToolCall("read_file", {
            path: artifactPath,
            startLine: index + 1,
            endLine: index + 1,
          }),
          { stopReason: "toolUse" },
        ),
      ),
      fauxAssistantMessage(
        fauxToolCall("apply_patch", {
          operation: "replace",
          path: artifactPath,
          expectedSha256: sha256(draft),
          edits: [{ oldText: "Section 1</p>", newText: "Introduction</p>" }],
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("read_file", {
          path: artifactPath,
          startLine: 1,
          endLine: 2,
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        "The introduction is updated; the artifact is ready for review.",
      ),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const runtime = processReadyAgentRuntime(fixture.store, models);
    const run = await runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Inspect the existing article and improve its introduction.",
      model: { provider: "faux-progress-activity", id: "faux-1" },
    });
    expect(run.status, run.error).toBe("completed");
    expect(
      await readFile(
        path.join(fixture.store.workspaceRoot, artifactPath),
        "utf8",
      ),
    ).toContain("Introduction</p>");
    const events = await fixture.store.listRunEvents(run.id);
    expect(
      events.filter((item) => item.type === "tool.completed"),
    ).toHaveLength(10);
    expect(
      events.some(
        (item) =>
          item.type === "run.no_progress" ||
          item.type === "run.progress.rerouted",
      ),
    ).toBe(false);
    const vectors = projectValidatedRunProgressLedger(
      events,
      run.id,
      DEFAULT_RUN_CONVERGENCE_POLICY,
    ).vectors;
    expect(vectors[6]).toMatchObject({
      progressed: false,
      stagnantTurnCount: 7,
      activity: { progressed: true, stagnantTurnCount: 0 },
    });
    await fixture.store.close();
  });
});
