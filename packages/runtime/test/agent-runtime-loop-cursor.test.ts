import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import type { RunEvent } from "@napier/contracts";
import { expect, it, vi } from "vitest";

import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";
import { validateToolLoopGuardTriggerEvidence } from "../src/tool-loop-guard.js";
import { processReadyAgentRuntime } from "./process-run-readiness-test-fixture.js";

it("shares one typed cursor between the active Run loop and tool preflight while blocking the fourth repeated read", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "napier-runtime-loop-cursor-"));
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot); await writeFile(path.join(workspaceRoot, "loop.txt"), "stable evidence\n");
  const store = new LocalStore({ workspaceRoot, dataRoot: path.join(root, "data") });
  await store.initialize();
  const policy = { enabled: true, threshold: 3, exemptTools: [] };
  const agent = await store.updateAgent(store.listAgents()[0]!.id, { toolLoopGuard: policy });
  const thread = await store.createThread({ title: "Shared loop cursor", agentId: agent.id });
  const faux = fauxProvider({ provider: "faux-shared-loop-cursor" });
  const repeated = () => fauxAssistantMessage(fauxToolCall("read_file", { path: "loop.txt" }));
  faux.setResponses([
    repeated(), repeated(), repeated(),
    (context) => { expect(context.systemPrompt).toContain("<tool-loop-guard>"); return repeated(); },
    fauxAssistantMessage("The read is repeating; I stopped and changed strategy."),
    fauxAssistantMessage('{"facts":[]}'),
  ]);
  const registry = new ModelRegistry(); registry.registerProvider(faux.provider);
  const runtime = processReadyAgentRuntime(store, registry);
  const types = new Set(["model.response", "tool.completed", "tool.failed", "tool.blocked", "model.tool_loop.detected"]);
  const observations: Array<{ runId: string; afterSeq: number; rows: RunEvent[] }> = [];
  const list = store.listRunEvents.bind(store);
  const query = vi.spyOn(store, "listRunEvents").mockImplementation(async (...args) => {
    const rows = await list(...args);
    if (args[2]?.length === types.size && args[2].every((type) => types.has(type))) {
      observations.push({ runId: args[0], afterSeq: args[1] ?? 0, rows });
    }
    return rows;
  });
  try {
    const run = await runtime.runPrompt({
      threadId: thread.id, text: "Inspect the stable file without looping.",
      model: { provider: "faux-shared-loop-cursor", id: "faux-1" },
    });
    expect(run.status, run.error).toBe("completed");
    const events = await store.listEvents(thread.id);
    const completed = events.filter((event) => event.type === "tool.completed" && field(event, "toolName") === "read_file");
    expect(completed).toHaveLength(3);
    const triggers = events.filter((event) => event.type === "model.tool_loop.detected");
    expect(triggers).toHaveLength(1);
    expect(validateToolLoopGuardTriggerEvidence(triggers[0]!, events, policy)).toBe(true);
    expect(events.filter((event) => event.type === "tool.blocked" && field(event, "policyReason") === "tool_loop_guard")).toHaveLength(1);
    expect(observations.length).toBeGreaterThan(4);
    let watermark = 0;
    const consumed: number[] = [];
    for (const observation of observations) {
      expect(observation.runId).toBe(run.id);
      expect(observation.afterSeq).toBe(watermark);
      for (const row of observation.rows) {
        expect(types.has(row.type)).toBe(true);
        expect(row.seq).toBeGreaterThan(watermark);
        watermark = row.seq; consumed.push(row.seq);
      }
    }
    expect(new Set(consumed).size).toBe(consumed.length);
    expect(consumed).toContain(triggers[0]!.seq);
    expect(consumed.length).toBeLessThan(events.length);
    expect(faux.state.callCount).toBe(6);
  } finally {
    query.mockRestore(); await store.shutdown(); await rm(root, { recursive: true, force: true });
  }
}, 30_000);

function field(event: RunEvent, key: string) {
  const payload = event.payload;
  return payload !== null && typeof payload === "object" && !Array.isArray(payload) ? payload[key] : undefined;
}
