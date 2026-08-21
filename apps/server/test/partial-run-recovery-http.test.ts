import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { StreamFrame } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { createApp, createServices } from "../src/app.js";
import { processReadySandbox } from "./process-run-readiness-test-fixture.js";

const roots: string[] = [];
const services: Awaited<ReturnType<typeof createServices>>[] = [];

afterEach(async () => {
  for (const service of services.splice(0)) {
    await service.recovery.stop();
    await service.automation.stop();
    await service.channels.stop();
    await service.workspaceProcesses.shutdown();
    await service.extensions.shutdown();
    service.store.close();
  }
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("partial Run recovery HTTP", () => {
  it("binds the parent request to one recovery child SSE stream", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-partial-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(
      path.join(workspaceRoot, "partial-report.md"),
      "# Partial\n",
    );
    const service = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot,
      sandbox: processReadySandbox("partial-recovery-http"),
    });
    services.push(service);
    const agent = await service.store.updateAgent(
      service.store.listAgents()[0]!.id,
      { enabledTools: ["list_files"] },
    );
    const thread = await service.store.createThread({
      title: "Partial recovery API test",
      agentId: agent.id,
    });

    const source = fauxProvider({ provider: "faux-server-partial" });
    source.setResponses([
      fauxAssistantMessage(
        fauxToolCall("create_plan", {
          objective: "Finish the partial report.",
          steps: [
            {
              id: "finish",
              title: "Finish report",
              description: "Complete the preserved report.",
              verification: "The report is verified.",
            },
          ],
          artifacts: [
            {
              id: "report",
              path: "partial-report.md",
              kind: "file",
              description: "Partial report.",
            },
          ],
        }),
        { stopReason: "toolUse" },
      ),
      ...Array.from({ length: 6 }, (_, index) =>
        fauxAssistantMessage(
          fauxToolCall("list_files", { path: `missing-${String(index + 1)}` }),
          { stopReason: "toolUse" },
        ),
      ),
      fauxAssistantMessage(fauxToolCall("list_files", { path: "missing-6" }), {
        stopReason: "toolUse",
      }),
    ]);
    service.models.registerProvider(source.provider);
    const partial = await service.runtime.runPrompt({
      threadId: thread.id,
      text: "Create a plan and finish the partial report.",
      model: { provider: "faux-server-partial", id: "faux-1" },
    });
    expect(partial).toEqual(
      expect.objectContaining({ status: "failed", outcome: "partial" }),
    );

    let recoveryPrompt = "";
    const recovery = fauxProvider({ provider: "faux-partial-recovery" });
    recovery.setResponses([
      (context) => {
        recoveryPrompt = JSON.stringify(context.messages);
        return fauxAssistantMessage("Continued from the partial checkpoint.");
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    service.models.registerProvider(recovery.provider);
    const response = await createApp(service).request(
      `/api/threads/${thread.id}/resume`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId: partial.id,
          model: { provider: "faux-partial-recovery", id: "faux-1" },
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-napier-run-id")).toBe(partial.id);
    expect(response.headers.get("x-napier-resume-requested")).toBe("true");
    const frames = parseSseFrames(await response.text());
    expect(recoveryPrompt).toContain("<run-recovery>");
    expect(recoveryPrompt).toContain("<recovery-plan-context>");
    expect(recoveryPrompt).not.toContain("partial-report.md");
    const done = frames.at(-1);
    expect(done?.type).toBe("done");
    if (!done || done.type !== "done") throw new Error("Missing done frame");
    expect(done.runId).not.toBe(partial.id);
    const snapshot = frames.findLast(
      (frame): frame is Extract<StreamFrame, { type: "snapshot" }> =>
        frame.type === "snapshot",
    );
    expect(snapshot?.detail.runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: partial.id,
          status: "failed",
          outcome: "partial",
        }),
        expect.objectContaining({
          id: done.runId,
          status: "completed",
          source: "recovery",
          parentRunId: partial.id,
        }),
      ]),
    );
    expect(
      frames.some(
        (frame) =>
          frame.type === "event" &&
          frame.event.runId === done.runId &&
          frame.event.type === "run.recovery.started",
      ),
    ).toBe(true);
  });
});

function parseSseFrames(source: string): StreamFrame[] {
  return source.split(/\r?\n\r?\n/u).flatMap((record): StreamFrame[] => {
    const data = record
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    return data ? [JSON.parse(data) as StreamFrame] : [];
  });
}
