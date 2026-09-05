import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";
import { processReadyAgentRuntime } from "./process-run-readiness-test-fixture.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent plan mutation ordering", () => {
  it("serializes dependency-linked updates emitted in one model turn", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-plan-sequential-"));
    roots.push(root);
    const store = new LocalStore({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    await store.initialize();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Sequential dependent plan updates",
      agentId: agent.id,
    });
    let planId = "";
    const provider = fauxProvider({ provider: "faux-plan-sequential" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("create_plan", {
          objective: "Research, design, and build a verified artifact.",
          steps: [
            {
              id: "research",
              title: "Research",
              description: "Collect the required evidence.",
              verification: "The evidence is recorded.",
            },
            {
              id: "design",
              title: "Design",
              description: "Design from the research evidence.",
              verification: "The design is recorded.",
              dependsOn: ["research"],
            },
            {
              id: "build",
              title: "Build",
              description: "Build from the completed design.",
              verification: "The build step is running.",
              dependsOn: ["design"],
            },
          ],
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const match = /"planId":"([^"]+)"/u.exec(
          JSON.stringify(context.messages),
        );
        planId = match?.[1] ?? "";
        expect(planId).toMatch(/^plan_/u);
        return fauxAssistantMessage(
          [
            fauxToolCall("update_plan_step", {
              planId,
              stepId: "research",
              action: "complete",
              evidence: "Research evidence was collected.",
            }),
            fauxToolCall("update_plan_step", {
              planId,
              stepId: "design",
              action: "complete",
              evidence: "The design was derived from the research.",
            }),
            fauxToolCall("update_plan_step", {
              planId,
              stepId: "build",
              action: "start",
            }),
          ],
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain('"stepId":"research","status":"completed"');
        expect(messages).toContain('"stepId":"design","status":"completed"');
        expect(messages).toContain('"stepId":"build","status":"running"');
        return fauxAssistantMessage(
          "Dependent plan updates completed in source order.",
        );
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const runtime: AgentRuntime = processReadyAgentRuntime(store, models);

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Exercise a dependency-ordered execution plan.",
      model: { provider: "faux-plan-sequential", id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    expect(provider.state.callCount).toBe(4);
    expect(store.getPlan(planId)).toEqual(
      expect.objectContaining({
        status: "active",
        steps: [
          expect.objectContaining({ id: "research", status: "completed" }),
          expect.objectContaining({ id: "design", status: "completed" }),
          expect.objectContaining({ id: "build", status: "running" }),
        ],
      }),
    );
    const events = await store.listEvents(thread.id);
    expect(events.filter((event) => event.type === "tool.failed")).toEqual([]);
    expect(
      events
        .filter((event) => event.type.startsWith("plan.step."))
        .map((event) => `${event.type}:${String(event.payload["stepId"])}`),
    ).toEqual([
      "plan.step.started:research",
      "plan.step.completed:research",
      "plan.step.started:design",
      "plan.step.completed:design",
      "plan.step.started:build",
    ]);
    store.close();
  });
});
