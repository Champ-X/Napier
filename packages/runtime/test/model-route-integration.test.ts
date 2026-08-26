import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { RunEvent } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { ModelRegistry } from "../src/models.js";
import { CredentialReferenceStore } from "../src/credentials.js";
import { LocalStore } from "../src/store.js";
import { processReadyAgentRuntime } from "./process-run-readiness-test-fixture.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("AgentRuntime model routing", () => {
  it("uses a frozen role binding, endpoint profile, and selected credential in the provider call", async () => {
    const fixture = await createFixture({
      ROUTE_FIRST_KEY: "secret-first",
      ROUTE_SECOND_KEY: "secret-second",
    });
    let agent = await fixture.store.updateAgent(
      fixture.store.getThread(fixture.threadId).agentId,
      {
        modelRoute: {
          schemaVersion: 2,
          roles: {},
          credentialPools: [
            {
              id: "route_pool",
              providerId: "route-live",
              strategy: "round_robin",
            },
          ],
        },
      },
    );
    const first = await fixture.store.createCredentialReference({
      providerId: "route-live",
      label: "First",
      source: { type: "environment", variable: "ROUTE_FIRST_KEY" },
    });
    const second = await fixture.store.createCredentialReference({
      providerId: "route-live",
      label: "Second",
      source: { type: "environment", variable: "ROUTE_SECOND_KEY" },
    });
    agent = await fixture.store.updateAgent(agent.id, {
      modelRoute: {
        schemaVersion: 2,
        roles: {
          reasoning: {
            model: { provider: "route-live", id: "reasoning" },
            endpointProfileId: "corp_gateway",
            credentialPoolId: "route_pool",
          },
        },
        endpointProfiles: [
          {
            id: "corp_gateway",
            providerId: "route-live",
            kind: "gateway",
            baseUrl: "https://gateway.example.test/v1",
            modelId: "served-reasoning",
            dialect: "openai_responses",
            headers: { "x-napier-tenant": "delivery" },
          },
        ],
        credentialPools: [
          {
            id: "route_pool",
            providerId: "route-live",
            strategy: "round_robin",
            credentialReferenceIds: [first.id, second.id],
          },
        ],
      },
    });
    const calls: Array<Record<string, unknown>> = [];
    const provider = fauxProvider({
      api: "openai-responses",
      provider: "route-live",
      models: [
        { id: "reasoning", reasoning: true },
        { id: "replacement", reasoning: true },
      ],
    });
    provider.setResponses([
      (_context, options, _state, model) => {
        calls.push({
          api: model.api,
          id: model.id,
          baseUrl: model.baseUrl,
          apiKey: options?.apiKey,
          headers: options?.headers,
        });
        return fauxAssistantMessage("Served by the frozen role route.");
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    fixture.models.registerProvider(provider.provider);

    const run = await fixture.runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Use the reasoning role.",
      modelRoute: { role: "reasoning" },
      onRunCreated: async () => {
        await fixture.store.updateAgent(agent.id, {
          modelRoute: {
            ...agent.modelRoute!,
            roles: {
              reasoning: { model: { provider: "route-live", id: "replacement" } },
            },
          },
        });
      },
    });

    expect(run.status, run.error).toBe("completed");
    expect(run.configuration).toEqual(
      expect.objectContaining({
        schemaVersion: 9,
        model: { provider: "route-live", id: "reasoning" },
        modelRoute: expect.objectContaining({
          roles: expect.objectContaining({
            reasoning: expect.objectContaining({
              model: { provider: "route-live", id: "reasoning" },
            }),
          }),
        }),
      }),
    );
    expect(calls[0]).toEqual({
      api: "openai-responses",
      id: "served-reasoning",
      baseUrl: "https://gateway.example.test/v1",
      apiKey: "secret-first",
      headers: { "x-napier-tenant": "delivery" },
    });
    const routePlan = (await fixture.store.listEvents(fixture.threadId)).find(
      (event) => event.runId === run.id && event.type === "route_plan_created",
    );
    expect(routePlan?.payload).toEqual(
      expect.objectContaining({
        resolutionSource: "role",
        candidates: [
          expect.objectContaining({
            modelId: "served-reasoning",
            sourceModelId: "reasoning",
            credentialPoolId: "route_pool",
            endpointProfileId: "corp_gateway",
          }),
        ],
      }),
    );
    expect(JSON.stringify(await fixture.store.getDetail(fixture.threadId))).not.toContain(
      "secret-first",
    );
    fixture.store.close();
  });

  it("rebuilds candidate evidence and attributes a safe cross-provider fallback", async () => {
    const fixture = await createFixture();
    const primary = fauxProvider({
      api: "anthropic-messages",
      provider: "route-primary",
      models: [{ id: "primary", reasoning: true }],
    });
    const fallback = fauxProvider({
      api: "openai-responses",
      provider: "route-fallback",
      models: [{ id: "fallback", reasoning: false }],
    });
    primary.setResponses([
      fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: "HTTP 503 service unavailable",
      }),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    fallback.setResponses([fauxAssistantMessage("Served by the fallback.")]);
    fixture.models.registerProvider(primary.provider);
    fixture.models.registerProvider(fallback.provider);

    const streamed: RunEvent[] = [];
    const run = await fixture.runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Exercise safe model routing.",
      model: { provider: "route-primary", id: "primary" },
      modelRoute: {
        role: "reasoning",
        fallbackModels: [{ provider: "route-fallback", id: "fallback" }],
      },
      onEvent: (event) => {
        streamed.push(event);
      },
    });

    expect(run.status, run.error).toBe("completed");
    expect(primary.state.callCount).toBe(2);
    expect(fallback.state.callCount).toBe(1);

    const events = (await fixture.store.listEvents(fixture.threadId)).filter(
      (event) => event.runId === run.id,
    );
    const routeEvents = events.filter((event) =>
      event.type.startsWith("route_"),
    );
    expect(routeEvents.map((event) => event.type)).toEqual([
      "route_plan_created",
      "route_attempt_started",
      "route_attempt_ended",
      "route_attempt_started",
      "route_attempt_ended",
    ]);
    expect(events.indexOf(routeEvents[0]!)).toBeLessThan(
      events.indexOf(routeEvents[1]!),
    );
    expect(routeEvents[2]?.payload).toEqual(
      expect.objectContaining({
        providerId: "route-primary",
        modelId: "primary",
        outcome: "retryable",
        failureClass: "provider_server",
        visibleOutputProduced: false,
        sideEffectState: "none",
      }),
    );
    expect(routeEvents[3]?.payload).toEqual(
      expect.objectContaining({
        providerId: "route-fallback",
        modelId: "fallback",
        attempt: 2,
        fallbackFromAttempt: 1,
        fallbackReason: "provider_server",
      }),
    );
    expect(routeEvents[4]?.payload).toEqual(
      expect.objectContaining({
        providerId: "route-fallback",
        modelId: "fallback",
        outcome: "success",
      }),
    );

    const harness = events.filter(
      (event) => event.type === "model.harness.resolved",
    );
    expect(harness.map((event) => event.payload["provider"])).toEqual([
      "route-primary",
      "route-fallback",
    ]);
    expect(harness.map((event) => event.payload["modelApi"])).toEqual([
      "anthropic-messages",
      "openai-responses",
    ]);

    const adapters = events.filter(
      (event) => event.type === "context.model_adapter",
    );
    expect(
      adapters.slice(0, 2).map((event) => event.payload["adapterId"]),
    ).toEqual(["napier.anthropic-messages.v2", "napier.openai-family.v2"]);
    const promptPackages = events.filter(
      (event) =>
        event.type === "context.prompt_package" &&
        event.payload["purpose"] === "agent_turn",
    );
    expect(promptPackages).toHaveLength(2);
    expect(
      promptPackages.map(
        (event) =>
          (event.payload["modelAdapter"] as Record<string, unknown>)[
            "adapterId"
          ],
      ),
    ).toEqual(["napier.anthropic-messages.v2", "napier.openai-family.v2"]);

    const envelopes = events.filter(
      (event) => event.type === "context.model_envelope",
    );
    expect(
      envelopes.slice(0, 2).map((event) => event.payload["turnIndex"]),
    ).toEqual([0, 1]);
    expect(envelopes[0]?.payload["contentSha256"]).not.toBe(
      envelopes[1]?.payload["contentSha256"],
    );

    const response = events.find(
      (event) =>
        event.type === "model.response" &&
        event.payload["model"] === "route-fallback/fallback",
    );
    const assistant = events.find(
      (event) => event.type === "message.assistant",
    );
    expect(response?.payload).toEqual(
      expect.objectContaining({
        model: "route-fallback/fallback",
        stopReason: "stop",
        modelContextEnvelopeSha256: envelopes[1]?.payload["contentSha256"],
      }),
    );
    expect(assistant?.payload).toEqual(
      expect.objectContaining({
        model: "route-fallback/fallback",
        text: "Served by the fallback.",
      }),
    );
    expect(JSON.stringify(streamed)).not.toContain(
      "HTTP 503 service unavailable",
    );
    fixture.store.close();
  });

  it("keeps the default successful path to one route attempt", async () => {
    const fixture = await createFixture();
    const provider = fauxProvider({ provider: "route-default" });
    provider.setResponses([
      fauxAssistantMessage("Primary model succeeded."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    fixture.models.registerProvider(provider.provider);

    const run = await fixture.runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Use the default route.",
      model: { provider: "route-default", id: "faux-1" },
    });

    expect(run.status, run.error).toBe("completed");
    const events = (await fixture.store.listEvents(fixture.threadId)).filter(
      (event) => event.runId === run.id,
    );
    expect(
      events.filter((event) => event.type === "route_plan_created"),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.type === "route_attempt_started"),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.type === "route_attempt_ended"),
    ).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          providerId: "route-default",
          modelId: "faux-1",
          attempt: 1,
          outcome: "success",
        }),
      }),
    ]);
    fixture.store.close();
  });
});

async function createFixture(
  credentialEnv: Readonly<Record<string, string | undefined>> = {},
) {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-model-route-runtime-"),
  );
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const thread = await store.createThread({
    title: "Model route integration",
    agentId: store.listAgents()[0]!.id,
  });
  const models = new ModelRegistry(
    new CredentialReferenceStore({ store, env: credentialEnv }),
  );
  return {
    store,
    models,
    threadId: thread.id,
    runtime: processReadyAgentRuntime(store, models),
  };
}
