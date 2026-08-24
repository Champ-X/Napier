import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { ModelRegistry } from "../src/models.js";
import { projectRunHarnessEffectMetrics } from "../src/run-harness-effect-metrics.js";
import { hashEventStream } from "../src/run-replay.js";
import { LocalStore } from "../src/store.js";
import { processReadyAgentRuntime } from "./process-run-readiness-test-fixture.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent Run Harness evidence", () => {
  it("emits authoritative action and call hashes that project through the real loop", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-harness-e2e-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(path.join(workspaceRoot, "evidence.txt"), "evidence\n");
    const store = new LocalStore({
      dataRoot: path.join(root, "data"),
      workspaceRoot,
    });
    await store.initialize();
    const agent = await store.updateAgent(store.listAgents()[0]!.id, {
      toolPolicy: "workspace",
      enabledTools: ["read_file", "verify_workspace"],
    });
    const thread = await store.createThread({
      title: "Harness E2E",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "harness-e2e" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("read_file", { path: "evidence.txt" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("verify_workspace", {
          command: "test -f evidence.txt",
          cwd: ".",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Evidence verified."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const runtime = processReadyAgentRuntime(store, models);

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Read and verify the evidence.",
      model: { provider: "harness-e2e", id: "faux-1" },
    });
    const events = (await store.listEvents(thread.id)).filter(
      (event) => event.runId === run.id,
    );
    const starts = events.filter((event) => event.type === "tool.started");

    expect(starts.map((event) => event.payload)).toEqual([
      expect.objectContaining({
        toolName: "read_file",
        harnessAction: "read",
        callInputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
      expect.objectContaining({
        toolName: "verify_workspace",
        harnessAction: "verify",
        effect: "read",
        callInputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    ]);
    const metrics = projectRunHarnessEffectMetrics(
      run,
      events,
      hashEventStream(events),
    );
    expect(metrics.firstAction.read.status).toBe("available");
    expect(metrics.firstAction.verify.status).toBe("available");
    expect(metrics.firstAction.write.status).toBe("unavailable");
    expect(metrics.contextTokens.status).toBe("available");
    const calibrations = events.filter(
      (event) => event.type === "model.context.token_calibration",
    );
    expect(metrics.contextTokens.calibrationObservationCount).toBeGreaterThan(
      0,
    );
    expect(metrics.contextTokens.calibratedObservationCount).toBeGreaterThan(0);
    expect(metrics.contextTokens.p95InputUnderestimateRatio).toEqual(
      expect.any(Number),
    );
    expect(calibrations.length).toBeGreaterThan(0);
    expect(calibrations[0]?.payload).toEqual(
      expect.objectContaining({
        kind: "napier.model-context-token-calibration",
        status: "calibrated",
        pressureContentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        modelContextEnvelopeSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(
      events
        .filter((event) => event.type === "model.context.token_pressure")
        .some(
          (event) =>
            typeof event.payload === "object" &&
            event.payload !== null &&
            !Array.isArray(event.payload) &&
            Number(event.payload["calibrationSampleCount"]) > 0,
        ),
    ).toBe(true);
    expect(metrics.harnessResolution).toEqual(
      expect.objectContaining({
        status: "available",
        observationCount: expect.any(Number),
        validReceiptCount: expect.any(Number),
        distinctReceiptCount: expect.any(Number),
        resolutionSequenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(metrics.harnessResolution.observationCount).toBeGreaterThan(0);
    expect(metrics.harnessResolution.validReceiptCount).toBe(
      metrics.harnessResolution.observationCount,
    );
    store.close();
  });
});
