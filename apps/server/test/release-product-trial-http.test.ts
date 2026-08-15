import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  ReleaseProductGateProjection,
  ReleaseProductTrial,
} from "@napier/contracts/release-product-trial";
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

describe("Release Product Trial HTTP", () => {
  it("binds a fixed Case to a real terminal Run and returns a durable version gate", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-release-product-trial-"),
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
      title: "Default Product Track",
      agentId: agent.id,
    });
    const run = await services.store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    await services.store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "message.assistant",
      category: "message",
      visibility: "user",
      payload: {
        role: "assistant",
        text: "Provider setup completed without exposing credentials.",
      },
    });
    await services.store.finishRun(run.id, "completed");
    const casebook = await services.store.createEvaluationCasebook({
      threadId: thread.id,
      name: "Release Product Casebook",
      templateId: "release-product-v1",
    });

    const response = await app.request(
      `/api/threads/${thread.id}/release-product-trials`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          casebookId: casebook.id,
          templateCaseId: "settings",
          runId: run.id,
          productVersion: NAPIER_PRODUCT_VERSION,
          status: "passed",
          configurationInterventions: 1,
          humanInterventions: 0,
          recoveryEvents: 0,
          uxScore: 4,
        }),
      },
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("x-napier-release-product-gate")).toBe(
      "blocked",
    );
    expect(
      response.headers.get("x-napier-release-product-consecutive-versions"),
    ).toBe("0");
    const recorded = (await response.json()) as {
      trial: ReleaseProductTrial;
      gate: ReleaseProductGateProjection;
    };
    expect(recorded.trial).toEqual(
      expect.objectContaining({
        casebookId: casebook.id,
        templateCaseId: "settings",
        runId: run.id,
        runStatus: "completed",
        productVersion: NAPIER_PRODUCT_VERSION,
        status: "passed",
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(recorded.gate).toEqual(
      expect.objectContaining({
        defaultTrackReady: false,
        versions: [
          expect.objectContaining({
            coveredCaseCount: 1,
            caseCount: 10,
            successRate: 1,
            status: "incomplete",
          }),
        ],
      }),
    );

    const duplicate = await app.request(
      `/api/threads/${thread.id}/release-product-trials`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...requestBody(recorded.trial), uxScore: 5 }),
      },
    );
    expect(duplicate.status).toBe(409);
    const forgedVersion = await app.request(
      `/api/threads/${thread.id}/release-product-trials`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...requestBody(recorded.trial),
          runId: run.id,
          productVersion: "0.0.9",
          uxScore: 5,
        }),
      },
    );
    expect(forgedVersion.status).toBe(409);
    expect(await forgedVersion.json()).toEqual(
      expect.objectContaining({
        error: expect.stringContaining(
          `running product version: ${NAPIER_PRODUCT_VERSION}`,
        ),
      }),
    );
    const researchThread = await services.store.createThread({
      title: "Network reference",
      agentId: agent.id,
    });
    const researchRun = await services.store.createRun({
      threadId: researchThread.id,
      agentId: agent.id,
    });
    await services.store.finishRun(researchRun.id, "completed");
    const researchResponse = await app.request(
      `/api/threads/${researchThread.id}/release-product-trials`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          casebookId: casebook.id,
          templateCaseId: "network-reference",
          runId: researchRun.id,
          productVersion: NAPIER_PRODUCT_VERSION,
          status: "passed",
          configurationInterventions: 0,
          humanInterventions: 0,
          recoveryEvents: 0,
          uxScore: 5,
        }),
      },
    );
    expect(researchResponse.status).toBe(201);
    const gateResponse = await app.request(
      `/api/threads/${thread.id}/release-product-gate?casebookId=${casebook.id}`,
    );
    expect(gateResponse.status).toBe(200);
    expect(
      (await gateResponse.json()) as ReleaseProductGateProjection,
    ).toMatchObject({
      versions: [
        expect.objectContaining({
          coveredCaseCount: 2,
          trialCount: 2,
          successRate: 1,
        }),
      ],
      trials: expect.arrayContaining([
        expect.objectContaining({ threadId: thread.id }),
        expect.objectContaining({ threadId: researchThread.id }),
      ]),
    });
    expect((await services.store.listEvents(thread.id)).at(-1)?.type).toBe(
      "evaluation.release-product.trial.recorded",
    );
  });
});

function requestBody(trial: ReleaseProductTrial) {
  return {
    casebookId: trial.casebookId,
    templateCaseId: trial.templateCaseId,
    runId: trial.runId,
    productVersion: trial.productVersion,
    status: trial.status,
    configurationInterventions: trial.configurationInterventions,
    humanInterventions: trial.humanInterventions,
    recoveryEvents: trial.recoveryEvents,
  };
}
