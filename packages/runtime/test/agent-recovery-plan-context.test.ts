import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { sha256 } from "../src/ed25519.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent recovery Plan context", () => {
  it("reopens and verifies a retained Plan without recreating its artifact", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-recovery-plan-"));
    roots.push(root);
    const options = {
      dataRoot: path.join(root, "state"),
      workspaceRoot: path.join(root, "workspace"),
    };
    await mkdir(path.join(options.workspaceRoot, "artifacts"), {
      recursive: true,
    });
    const first = new LocalStore(options);
    await first.initialize();
    const agent = first.listAgents()[0]!;
    const thread = await first.createThread({
      title: "Recover retained Plan",
      agentId: agent.id,
    });
    const interrupted = await first.createRun({
      threadId: thread.id,
      agentId: agent.id,
      model: { provider: "recovery-plan", id: "faux-1" },
    });
    const plan = await first.createPlan(thread.id, {
      objective: "Deliver one verified recovery artifact.",
      steps: [
        {
          id: "deliver",
          title: "Deliver retained artifact",
          description: "Verify and deliver the retained file.",
          verification: "The retained bytes are verified.",
        },
      ],
      artifacts: [
        {
          id: "report",
          path: "artifacts/report.md",
          kind: "file",
          description: "Recovery report.",
        },
      ],
    });
    await first.transitionPlanStep(plan.id, "deliver", {
      action: "start",
      runId: interrupted.id,
    });
    const contents = "# Recovery report\n";
    await writeFile(
      path.join(options.workspaceRoot, "artifacts/report.md"),
      contents,
      "utf8",
    );
    await first.appendEvent({
      threadId: thread.id,
      runId: interrupted.id,
      type: "message.user",
      category: "message",
      visibility: "user",
      payload: { role: "user", text: "Deliver the retained report." },
    });
    first.close();

    const recovered = new LocalStore(options);
    await recovered.initialize();
    expect(recovered.getPlan(plan.id).steps[0]?.status).toBe("blocked");
    const provider = fauxProvider({ provider: "recovery-plan" });
    provider.setResponses([
      (context) => {
        const prompt = JSON.stringify(context.messages);
        expect(prompt).toContain(`<recovery-plan-context>`);
        expect(prompt).toContain(plan.id);
        expect(prompt).toContain("deliver");
        expect(prompt).toContain("blocked");
        expect(prompt).toContain("report");
        expect(prompt).toContain("expected");
        expect(prompt).not.toContain("artifacts/report.md");
        expect(prompt).not.toContain("Recovery report.");
        return fauxAssistantMessage(
          fauxToolCall("update_plan_step", {
            planId: plan.id,
            stepId: "deliver",
            action: "reopen",
            evidence: "Current file state will be reverified.",
          }),
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage(
        fauxToolCall("update_plan_artifact", {
          planId: plan.id,
          artifactId: "report",
          action: "produced",
          evidence:
            "Recovery found the retained file at its declared location.",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("update_plan_artifact", {
          planId: plan.id,
          artifactId: "report",
          action: "verify",
          evidence: "Recovery verified the retained file bytes.",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("update_plan_step", {
          planId: plan.id,
          stepId: "deliver",
          action: "complete",
          evidence: "The retained artifact bytes were verified.",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Recovered and delivered the verified artifact."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const runtime = new AgentRuntime(recovered, models);

    const run = await runtime.resumeInterruptedRun({
      threadId: thread.id,
      runId: interrupted.id,
      model: { provider: "recovery-plan", id: "faux-1" },
    });

    expect(run.status, run.error).toBe("completed");
    expect(recovered.listPlans(thread.id)).toHaveLength(1);
    expect(recovered.getPlan(plan.id)).toMatchObject({
      status: "completed",
      steps: [{ id: "deliver", status: "completed", runId: run.id }],
      artifacts: [
        {
          id: "report",
          status: "verified",
          sourceRunId: run.id,
          sha256: sha256(contents),
        },
      ],
    });
    await expect(
      readFile(path.join(options.workspaceRoot, "artifacts/report.md"), "utf8"),
    ).resolves.toBe(contents);
    expect(
      (await recovered.listEvents(thread.id))
        .filter((event) => event.runId === run.id)
        .map((event) => event.type),
    ).toEqual(
      expect.arrayContaining([
        "plan.step.reopened",
        "plan.artifact.produced",
        "plan.artifact.verified",
        "plan.step.started",
        "plan.step.completed",
      ]),
    );
    recovered.close();
  });
});
