import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ControlledHarnessEvidenceContent } from "@napier/contracts/controlled-harness-evidence";
import { createControlledHarnessEvidence } from "@napier/runtime/controlled-harness-evidence";
import { NAPIER_PRODUCT_VERSION } from "@napier/runtime/release-product-gate";
import { afterEach, describe, expect, it } from "vitest";

import { createApp, createServices } from "../src/app.js";

const roots: string[] = [];
const openServices: Awaited<ReturnType<typeof createServices>>[] = [];

afterEach(async () => {
  for (const services of openServices.splice(0))
    await services.shutdownLocalRuntime();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Controlled Harness evidence HTTP", () => {
  it("validates, records, and projects honest comparison blockers", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-controlled-harness-"),
    );
    roots.push(root);
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    openServices.push(services);
    const app = createApp(services);
    const agent = services.store.listAgents()[0]!;
    const thread = await services.store.createThread({
      title: "Controlled Harness Track",
      agentId: agent.id,
    });
    const casebook = await services.store.createEvaluationCasebook({
      threadId: thread.id,
      name: "Release Product Casebook",
      templateId: "release-product-v1",
    });
    const evidence = createControlledHarnessEvidence(content());
    const response = await app.request(
      `/api/threads/${thread.id}/controlled-harness-evidence`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ casebookId: casebook.id, evidence }),
      },
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("x-napier-controlled-harness-gate")).toBe(
      "blocked",
    );
    const recorded = (await response.json()) as {
      evidence: typeof evidence;
      gate: { controlledTrackReady: boolean; blockers: string[] };
    };
    expect(recorded.evidence.contentSha256).toBe(evidence.contentSha256);
    expect(recorded.gate).toMatchObject({
      controlledTrackReady: false,
      blockers: [
        "sample_not_proven:browser_omp",
        "sample_not_proven:browser_autonomy",
        "quantified_advantage_not_proven",
      ],
    });

    const gateResponse = await app.request(
      `/api/threads/${thread.id}/controlled-harness-gate?casebookId=${casebook.id}`,
    );
    expect(gateResponse.status).toBe(200);
    expect(await gateResponse.json()).toEqual(recorded.gate);

    const duplicate = await app.request(
      `/api/threads/${thread.id}/controlled-harness-evidence`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ casebookId: casebook.id, evidence }),
      },
    );
    expect(duplicate.status).toBe(409);

    const tampered = await app.request(
      `/api/threads/${thread.id}/controlled-harness-evidence`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          casebookId: casebook.id,
          evidence: { ...evidence, controlledTrackReady: true },
        }),
      },
    );
    expect(tampered.status).toBe(400);
    expect((await services.store.listEvents(thread.id)).at(-1)?.type).toBe(
      "evaluation.controlled-harness.evidence.recorded",
    );
  });
});

function content(): ControlledHarnessEvidenceContent {
  const openWebSha = "1".repeat(64);
  const codingSha = "2".repeat(64);
  const browserSha = "3".repeat(64);
  return {
    kind: "napier.controlled-harness-evidence",
    schemaVersion: 1,
    generatedAt: "2026-08-13T00:00:00.000Z",
    productVersion: NAPIER_PRODUCT_VERSION,
    model: { provider: "deepseek", id: "deepseek-v4-flash" },
    sources: [
      { role: "open_web_campaign", contentSha256: openWebSha },
      { role: "coding_seed", contentSha256: codingSha },
      { role: "browser_autonomy", contentSha256: browserSha },
    ],
    comparisons: [
      comparison("search", "omp", 2, 2, 2, 0, 1, 1, 1, 1, openWebSha),
      comparison("browser_omp", "omp", 2, 2, 1, 1, 1, 1, 0, 0, openWebSha),
      comparison("coding", "omp", 10, 13, 13, 0, 13, 12, 1, 0, codingSha),
      comparison(
        "browser_autonomy",
        "browser_use",
        1,
        1,
        1,
        0,
        1,
        0,
        1,
        0,
        browserSha,
      ),
    ],
    advantage: {
      metric: "recovery",
      baseline: "omp",
      direction: "higher",
      unit: "successful_recovery_rate",
      napierValue: null,
      baselineValue: null,
      napierSampleCount: 0,
      baselineSampleCount: 0,
      sourceArtifactSha256s: [],
    },
  };
}

function comparison(
  domain: "search" | "browser_omp" | "coding" | "browser_autonomy",
  baseline: "omp" | "browser_use",
  caseCount: number,
  trialCount: number,
  decisiveTrialCount: number,
  excludedTrialCount: number,
  napierPassed: number,
  baselinePassed: number,
  napierOnlyPassed: number,
  baselineOnlyPassed: number,
  sourceSha: string,
) {
  return {
    domain,
    baseline,
    caseCount,
    trialCount,
    decisiveTrialCount,
    excludedTrialCount,
    napierPassed,
    baselinePassed,
    napierOnlyPassed,
    baselineOnlyPassed,
    napierSecretLeakDetected: false,
    napierUnconfirmedSideEffectDetected: false,
    fairness: {
      sameModel: true,
      samePrompt: true,
      isolatedWorkspace: true,
      samePermissions: true,
    },
    sourceArtifactSha256s: [sourceSha],
  };
}
