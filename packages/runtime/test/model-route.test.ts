import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { fauxProvider } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../src/ed25519.js";
import { CredentialReferenceStore } from "../src/credentials.js";
import {
  classifyRouteFailure,
  ModelRouter,
  routeCanFallback,
  routeCanRetrySameCandidate,
} from "../src/model-route.js";
import { ModelRegistry } from "../src/models.js";
import { LEDGER_DATABASE_FILENAME } from "../src/sqlite-ledger.js";
import { LocalStore } from "../src/store.js";
import {
  cleanupModelRouteFixtures,
  collectModelRouteStream as collect,
  createModelRouteFixture as createFixture,
  emptyTextFailureStream,
  openVisibleStream,
  resolveWithin,
  terminalStream,
  thinkingFailureStream,
  visibleFailureStream,
} from "./model-route-test-support.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all([
    cleanupModelRouteFixtures(),
    ...roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  ]);
});

describe("Model route failure policy", () => {
  it.each([
    [{ status: 429, message: "Too many requests" }, "rate_limited"],
    [{ statusCode: 503, message: "Service unavailable" }, "provider_server"],
    [{ code: "ECONNRESET", message: "socket closed" }, "network"],
    [{ message: "terminated" }, "network"],
    [{ code: "UND_ERR_SOCKET", message: "other side closed" }, "network"],
    [{ status: 408, message: "Request Timeout" }, "network"],
    [{ message: "upstream request timed out" }, "network"],
    [
      { message: "Model turn watchdog triggered: first_event_timeout" },
      "unknown",
    ],
    [{ message: "context_length_exceeded" }, "context"],
    [{ status: 401, message: "invalid API key" }, "authentication"],
    [{ status: 402, message: "payment required" }, "billing"],
    [{ message: "tool schema is unsupported" }, "tool_dialect"],
    [{ message: "request aborted" }, "cancelled"],
    [{ message: "opaque provider failure" }, "unknown"],
  ] as const)("normalizes %o as %s", (failure, expected) => {
    expect(classifyRouteFailure(failure)).toBe(expected);
  });

  it("permits only retryable failures before output and side effects", () => {
    expect(
      routeCanFallback({
        failureClass: "rate_limited",
        visibleOutputProduced: false,
        sideEffectState: "none",
        hasNextCandidate: true,
        aborted: false,
      }),
    ).toBe(true);
    for (const override of [
      { failureClass: "authentication" as const },
      { visibleOutputProduced: true },
      { sideEffectState: "known" as const },
      { sideEffectState: "unknown" as const },
      { hasNextCandidate: false },
      { aborted: true },
    ]) {
      expect(
        routeCanFallback({
          failureClass: "network",
          visibleOutputProduced: false,
          sideEffectState: "none",
          hasNextCandidate: true,
          aborted: false,
          ...override,
        }),
      ).toBe(false);
    }
  });

  it.each(["network", "provider_server"] as const)(
    "permits a same-candidate retry for %s failures",
    (failureClass) => {
      expect(
        routeCanRetrySameCandidate({
          failureClass,
          visibleOutputProduced: false,
          sideEffectState: "none",
          hasRetryAttempt: true,
          aborted: false,
        }),
      ).toBe(true);
    },
  );

  it.each([
    ["HTTP 429", { failureClass: "rate_limited" as const }],
    ["cancellation", { failureClass: "cancelled" as const }],
    ["visible text", { visibleOutputProduced: true }],
    ["a completed write", { sideEffectState: "known" as const }],
    ["an unresolved write", { sideEffectState: "unknown" as const }],
  ])("rejects a same-candidate retry after %s", (_reason, override) => {
    expect(
      routeCanRetrySameCandidate({
        failureClass: "network",
        visibleOutputProduced: false,
        sideEffectState: "none",
        hasRetryAttempt: true,
        aborted: false,
        ...override,
      }),
    ).toBe(false);
  });
});

describe("ModelRouteSession", () => {
  it.each(["health", "cursor"] as const)(
    "fails closed on corrupted persisted Model route %s state",
    async (kind) => {
      const root = await mkdtemp(
        path.join(tmpdir(), "napier-model-route-corrupt-"),
      );
      roots.push(root);
      const options = {
        workspaceRoot: path.join(root, "workspace"),
        dataRoot: path.join(root, "data"),
      };
      await mkdir(options.workspaceRoot);
      const store = new LocalStore(options);
      await store.initialize();
      store.close();

      const database = new DatabaseSync(
        path.join(options.dataRoot, LEDGER_DATABASE_FILENAME),
      );
      const row = database
        .prepare("SELECT state_json FROM workspace_state WHERE singleton = 1")
        .get() as { state_json: string };
      const state = JSON.parse(row.state_json) as {
        modelRouteHealth: unknown;
        modelRouteCursors: unknown;
      };
      if (kind === "health") {
        state.modelRouteHealth = [
          {
            key: "tampered",
            providerId: "route-fixture",
            modelId: "served",
            health: "healthy",
            consecutiveFailures: 0,
            updatedAt: new Date().toISOString(),
          },
        ];
      } else {
        state.modelRouteCursors = [
          {
            poolId: "route_pool",
            nextIndex: -1,
            updatedAt: new Date().toISOString(),
          },
        ];
      }
      database
        .prepare(
          "UPDATE workspace_state SET state_json = ? WHERE singleton = 1",
        )
        .run(JSON.stringify(state));
      database.close();

      const reopened = new LocalStore(options);
      await expect(reopened.initialize()).rejects.toThrow(
        kind === "health"
          ? "Invalid persisted Model route health"
          : "Invalid persisted Model route cursor",
      );
    },
  );

  it("uses role, endpoint, and credential-pool configuration across restarts", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-model-route-state-"),
    );
    roots.push(root);
    const options = {
      workspaceRoot: path.join(root, "workspace"),
      dataRoot: path.join(root, "data"),
    };
    await mkdir(options.workspaceRoot);
    const store = new LocalStore(options);
    await store.initialize();
    let agent = await store.updateAgent(store.listAgents()[0]!.id, {
      modelRoute: {
        schemaVersion: 2,
        roles: {},
        credentialPools: [
          {
            id: "route_pool",
            providerId: "route-fixture",
            strategy: "round_robin",
          },
        ],
      },
    });
    const first = await store.createCredentialReference({
      providerId: "route-fixture",
      label: "First",
      source: { type: "environment", variable: "ROUTE_FIRST_KEY" },
    });
    const second = await store.createCredentialReference({
      providerId: "route-fixture",
      label: "Second",
      source: { type: "environment", variable: "ROUTE_SECOND_KEY" },
    });
    agent = await store.updateAgent(agent.id, {
      modelRoute: {
        schemaVersion: 2,
        roles: {
          reasoning: {
            model: { provider: "route-fixture", id: "reasoning" },
            endpointProfileId: "corp_gateway",
            credentialPoolId: "route_pool",
          },
        },
        endpointProfiles: [
          {
            id: "corp_gateway",
            providerId: "route-fixture",
            kind: "gateway",
            baseUrl: "https://gateway.example.test/v1/",
            modelId: "served-reasoning",
            dialect: "openai_responses",
            headers: { "x-napier-tenant": "delivery" },
          },
        ],
        credentialPools: [
          {
            id: "route_pool",
            providerId: "route-fixture",
            strategy: "round_robin",
            credentialReferenceIds: [first.id, second.id],
          },
        ],
        retryPolicy: { jitterRatio: 0, maxBackoffMs: 120_000 },
      },
    });
    const thread = await store.createThread({
      title: "Persistent model route",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
      model: agent.model,
    });
    const credentials = new CredentialReferenceStore({
      store,
      env: {
        ROUTE_FIRST_KEY: "secret-first",
        ROUTE_SECOND_KEY: "secret-second",
      },
    });
    const registry = new ModelRegistry(credentials);
    registry.registerProvider(
      fauxProvider({
        provider: "route-fixture",
        models: [{ id: agent.model.id }, { id: "reasoning", reasoning: true }],
      }).provider,
    );
    const defaultModel = await registry.resolveConfigured({
      provider: "route-fixture",
      id: "reasoning",
    });
    if (!defaultModel) throw new Error("Route model was not resolved");
    const now = Date.now();
    const router = new ModelRouter(
      store,
      registry,
      () => now,
      () => 0,
    );
    const session = await router.createSession({
      run,
      primary: defaultModel,
      profile: agent,
      request: { role: "reasoning" },
    });
    let usedSecret = "";
    const stream = session.stream({
      signal: new AbortController().signal,
      invoke: async (model, context) => {
        usedSecret = context?.streamOptions.apiKey ?? "";
        await context?.streamOptions.onResponse?.(
          {
            status: 429,
            headers: { "Retry-After": "2", "X-Provider-Hint": "regional" },
          },
          model,
        );
        expect(model).toEqual(
          expect.objectContaining({
            id: "served-reasoning",
            api: "openai-responses",
            baseUrl: "https://gateway.example.test/v1",
          }),
        );
        expect(context?.streamOptions.headers).toEqual({
          "x-napier-tenant": "delivery",
        });
        return terminalStream(model, "error", "HTTP 429 rate limit");
      },
    });
    await collect(stream);
    expect(usedSecret).toBe("secret-first");
    expect(session.plan).toEqual(
      expect.objectContaining({
        role: "reasoning",
        resolutionSource: "role",
        candidates: [
          expect.objectContaining({
            modelId: "served-reasoning",
            sourceModelId: "reasoning",
            endpointProfileId: "corp_gateway",
            credentialPoolId: "route_pool",
          }),
        ],
      }),
    );
    const ended = (await store.listEvents(thread.id)).find(
      (event) => event.type === "route_attempt_ended",
    );
    expect(ended?.payload).toEqual(
      expect.objectContaining({
        providerHint: "regional",
        retryAfterMs: 2_000,
        backoffMs: 60_000,
      }),
    );
    const descriptor = session.plan.candidates[0]!;
    store.close();

    const reopened = new LocalStore(options);
    await reopened.initialize();
    expect(reopened.modelRouteStateRepository.health(descriptor)).toEqual(
      expect.objectContaining({
        health: "cooling_down",
        providerHint: "regional",
        retryAfterMs: 2_000,
      }),
    );
    expect(
      (
        await reopened.modelRouteStateRepository.reserveCredential(
          agent.modelRoute!.credentialPools![0]!,
          { modelId: "served-reasoning", endpointProfileId: "corp_gateway" },
        )
      ).id,
    ).toBe(second.id);
    expect(
      (
        await reopened.modelRouteStateRepository.reserveCredential(
          agent.modelRoute!.credentialPools![0]!,
          { modelId: "served-reasoning", endpointProfileId: "corp_gateway" },
        )
      ).id,
    ).toBe(second.id);
    const persisted = await readFile(
      path.join(options.dataRoot, "workspace.json"),
      "utf8",
    );
    expect(persisted).not.toContain("secret-first");
    expect(persisted).not.toContain("secret-second");
    reopened.close();
  });

  it("records an immutable plan and falls back before presenting output", async () => {
    const fixture = await createFixture();
    const session = await fixture.router.createSession({
      run: fixture.run,
      primary: fixture.primary,
      request: {
        role: "reasoning",
        fallbackModels: [{ provider: "route-fixture", id: "fallback" }],
      },
    });
    const invoked: string[] = [];
    const stream = session.stream({
      signal: new AbortController().signal,
      invoke: async (model) => {
        invoked.push(model.id);
        return model.id === "primary"
          ? terminalStream(model, "error", "HTTP 503 service unavailable")
          : terminalStream(model, "stop", "served by fallback");
      },
    });

    const streamed = await collect(stream);
    const result = await stream.result();
    const routeEvents = (
      await fixture.store.listEvents(fixture.thread.id)
    ).filter((event) => event.runId === fixture.run.id);

    expect(invoked).toEqual(["primary", "fallback"]);
    expect(result).toEqual(
      expect.objectContaining({
        provider: "route-fixture",
        model: "fallback",
        stopReason: "stop",
      }),
    );
    expect(streamed.map((event) => event.type)).toEqual(["start", "done"]);
    expect(JSON.stringify(streamed)).not.toContain("service unavailable");
    expect(routeEvents.map((event) => event.type)).toEqual([
      "route_plan_created",
      "route_attempt_started",
      "route_attempt_ended",
      "route_attempt_started",
      "route_attempt_ended",
    ]);
    expect(routeEvents[0]!.payload).toEqual(
      expect.objectContaining({
        role: "reasoning",
        candidates: [
          expect.objectContaining({ modelId: "primary" }),
          expect.objectContaining({ modelId: "fallback" }),
        ],
      }),
    );
    expect(routeEvents[2]!.payload).toEqual(
      expect.objectContaining({
        modelId: "primary",
        outcome: "retryable",
        failureClass: "provider_server",
        visibleOutputProduced: false,
        sideEffectState: "none",
      }),
    );
    expect(routeEvents[3]!.payload).toEqual(
      expect.objectContaining({
        modelId: "fallback",
        fallbackFromAttempt: 1,
        fallbackReason: "provider_server",
      }),
    );
    expect(routeEvents[4]!.payload).toEqual(
      expect.objectContaining({ modelId: "fallback", outcome: "success" }),
    );
    for (const event of routeEvents) assertPayloadHash(event.payload);
    expect(routeEvents[1]!.payload["contentSha256"]).not.toBe(
      routeEvents[2]!.payload["contentSha256"],
    );
    fixture.store.close();
  });

  it("retries a terminated single candidate without publishing failed thinking", async () => {
    const fixture = await createFixture({ noRetryDelay: true });
    const session = await fixture.router.createSession({
      run: fixture.run,
      primary: fixture.primary,
    });
    const failedThinking = "r".repeat(12_750);
    let invocationCount = 0;
    const stream = session.stream({
      signal: new AbortController().signal,
      invoke: async (model) => {
        invocationCount += 1;
        return invocationCount === 1
          ? thinkingFailureStream(model, failedThinking, "terminated")
          : terminalStream(model, "stop", "retry succeeded");
      },
    });

    const streamed = await collect(stream);
    const attempts = (await fixture.store.listEvents(fixture.thread.id)).filter(
      (event) =>
        event.runId === fixture.run.id &&
        (event.type === "route_attempt_started" ||
          event.type === "route_attempt_ended"),
    );

    expect(invocationCount).toBe(2);
    expect(streamed.map((event) => event.type)).toEqual(["start", "done"]);
    expect(streamed.some((event) => event.type === "thinking_delta")).toBe(
      false,
    );
    expect(JSON.stringify(streamed)).not.toContain(failedThinking);
    expect(JSON.stringify(streamed)).not.toContain("terminated");
    expect(attempts[1]?.payload).toEqual(
      expect.objectContaining({
        attempt: 1,
        outcome: "retryable",
        failureClass: "network",
        visibleOutputProduced: false,
        bufferedThinkingBytes: 12_750,
      }),
    );
    expect(attempts[2]?.payload).toEqual(
      expect.objectContaining({
        attempt: 2,
        stepAttempt: 2,
        retryFromAttempt: 1,
        retryReason: "network",
      }),
    );
    expect(attempts[3]?.payload).toEqual(
      expect.objectContaining({
        attempt: 2,
        outcome: "success",
      }),
    );
    fixture.store.close();
  });

  it("does not retry after buffering 32 KiB of thinking", async () => {
    const fixture = await createFixture({ noRetryDelay: true });
    const session = await fixture.router.createSession({
      run: fixture.run,
      primary: fixture.primary,
    });
    const thinking = "r".repeat(32 * 1024);
    let invocationCount = 0;
    const stream = session.stream({
      signal: new AbortController().signal,
      invoke: async (model) => {
        invocationCount += 1;
        return thinkingFailureStream(model, thinking, "terminated");
      },
    });

    const streamed = await collect(stream);
    const attempts = (await fixture.store.listEvents(fixture.thread.id)).filter(
      (event) =>
        event.runId === fixture.run.id && event.type === "route_attempt_ended",
    );

    expect(invocationCount).toBe(1);
    expect(streamed.map((event) => event.type)).toEqual([
      "start",
      "thinking_delta",
      "error",
    ]);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.payload).toEqual(
      expect.objectContaining({
        outcome: "terminal",
        failureClass: "network",
        visibleOutputProduced: true,
        bufferedThinkingBytes: 32 * 1024,
      }),
    );
    fixture.store.close();
  });

  it("settles an interrupted published attempt as cancelled", async () => {
    const fixture = await createFixture();
    const session = await fixture.router.createSession({
      run: fixture.run,
      primary: fixture.primary,
    });
    const stream = session.stream({
      signal: new AbortController().signal,
      invoke: async (model) => openVisibleStream(model),
    });
    const iterator = stream[Symbol.asyncIterator]();

    const first = await iterator.next();
    expect(first).toEqual(
      expect.objectContaining({
        done: false,
        value: expect.objectContaining({ type: "start" }),
      }),
    );
    await iterator.return?.();

    const result = await resolveWithin(stream.result(), 500);
    expect(result).toEqual(
      expect.objectContaining({
        provider: "route-fixture",
        model: "primary",
        stopReason: "aborted",
      }),
    );
    const ended = (await fixture.store.listEvents(fixture.thread.id)).filter(
      (event) =>
        event.runId === fixture.run.id && event.type === "route_attempt_ended",
    );
    expect(ended).toHaveLength(1);
    expect(ended[0]?.payload).toEqual(
      expect.objectContaining({
        outcome: "terminal",
        failureClass: "cancelled",
        visibleOutputProduced: true,
      }),
    );
    fixture.store.close();
  });

  it("attributes an aborted fallback retry wait to the fallback model", async () => {
    const abortController = new AbortController();
    const fixture = await createFixture({ abortRetryWait: abortController });
    const session = await fixture.router.createSession({
      run: fixture.run,
      primary: fixture.primary,
      request: {
        fallbackModels: [{ provider: "route-fixture", id: "fallback" }],
      },
    });
    const invoked: string[] = [];
    const stream = session.stream({
      signal: abortController.signal,
      invoke: async (model) => {
        invoked.push(model.id);
        return model.id === "primary"
          ? terminalStream(model, "error", "HTTP 503 service unavailable")
          : terminalStream(model, "error", "network error");
      },
    });

    const streamed = await collect(stream);
    const result = await stream.result();

    expect(invoked).toEqual(["primary", "fallback"]);
    expect(abortController.signal.aborted).toBe(true);
    expect(streamed.at(-1)).toEqual(
      expect.objectContaining({
        type: "error",
        error: expect.objectContaining({
          provider: "route-fixture",
          model: "fallback",
          stopReason: "aborted",
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        provider: "route-fixture",
        model: "fallback",
        stopReason: "aborted",
      }),
    );
    fixture.store.close();
  });

  it("ignores a completed write from before the current attempt", async () => {
    const fixture = await createFixture();
    await fixture.store.appendEvent({
      threadId: fixture.thread.id,
      runId: fixture.run.id,
      type: "tool.started",
      category: "tool",
      visibility: "user",
      payload: {
        callId: "call_historical",
        toolName: "apply_patch",
        effect: "write",
      },
    });
    await fixture.store.appendEvent({
      threadId: fixture.thread.id,
      runId: fixture.run.id,
      type: "tool.completed",
      category: "tool",
      visibility: "user",
      payload: {
        callId: "call_historical",
        toolName: "apply_patch",
      },
    });
    const session = await fixture.router.createSession({
      run: fixture.run,
      primary: fixture.primary,
      request: {
        fallbackModels: [{ provider: "route-fixture", id: "fallback" }],
      },
    });
    const invoked: string[] = [];
    const stream = session.stream({
      signal: new AbortController().signal,
      invoke: async (model) => {
        invoked.push(model.id);
        return model.id === "primary"
          ? terminalStream(model, "error", "HTTP 503 service unavailable")
          : terminalStream(model, "stop", "served by fallback");
      },
    });

    await collect(stream);
    expect(invoked).toEqual(["primary", "fallback"]);
    const ended = (await fixture.store.listEvents(fixture.thread.id)).find(
      (event) =>
        event.runId === fixture.run.id && event.type === "route_attempt_ended",
    );
    expect(ended?.payload).toEqual(
      expect.objectContaining({
        outcome: "retryable",
        sideEffectState: "none",
      }),
    );
    fixture.store.close();
  });

  it("does not treat an empty provider text block as visible output", async () => {
    const fixture = await createFixture();
    const session = await fixture.router.createSession({
      run: fixture.run,
      primary: fixture.primary,
      request: {
        fallbackModels: [{ provider: "route-fixture", id: "fallback" }],
      },
    });
    const invoked: string[] = [];
    const stream = session.stream({
      signal: new AbortController().signal,
      invoke: async (model) => {
        invoked.push(model.id);
        return model.id === "primary"
          ? emptyTextFailureStream(model, "HTTP 503 service unavailable")
          : terminalStream(model, "stop", "served by fallback");
      },
    });

    const streamed = await collect(stream);
    expect(invoked).toEqual(["primary", "fallback"]);
    expect(streamed.map((event) => event.type)).toEqual(["start", "done"]);
    const attempts = (await fixture.store.listEvents(fixture.thread.id)).filter(
      (event) =>
        event.runId === fixture.run.id && event.type === "route_attempt_ended",
    );
    expect(attempts[0]?.payload).toEqual(
      expect.objectContaining({
        outcome: "retryable",
        visibleOutputProduced: false,
      }),
    );
    fixture.store.close();
  });

  it("never falls back after visible output", async () => {
    const fixture = await createFixture();
    const session = await fixture.router.createSession({
      run: fixture.run,
      primary: fixture.primary,
      request: {
        fallbackModels: [{ provider: "route-fixture", id: "fallback" }],
      },
    });
    const invoked: string[] = [];
    const stream = session.stream({
      signal: new AbortController().signal,
      invoke: async (model) => {
        invoked.push(model.id);
        return visibleFailureStream(model, "HTTP 429 rate limit");
      },
    });

    const streamed = await collect(stream);
    expect(invoked).toEqual(["primary"]);
    expect(streamed.map((event) => event.type)).toEqual([
      "start",
      "text_start",
      "text_delta",
      "error",
    ]);
    expect((await stream.result()).stopReason).toBe("error");
    const ended = (await fixture.store.listEvents(fixture.thread.id)).find(
      (event) =>
        event.runId === fixture.run.id && event.type === "route_attempt_ended",
    );
    expect(ended?.payload).toEqual(
      expect.objectContaining({
        outcome: "terminal",
        visibleOutputProduced: true,
        failureClass: "rate_limited",
      }),
    );
    fixture.store.close();
  });

  it("never falls back while a current-attempt write is unresolved", async () => {
    const fixture = await createFixture();
    const session = await fixture.router.createSession({
      run: fixture.run,
      primary: fixture.primary,
      request: {
        fallbackModels: [{ provider: "route-fixture", id: "fallback" }],
      },
    });
    const invoked: string[] = [];
    const stream = session.stream({
      signal: new AbortController().signal,
      invoke: async (model) => {
        invoked.push(model.id);
        if (model.id === "primary") {
          await fixture.store.appendEvent({
            threadId: fixture.thread.id,
            runId: fixture.run.id,
            type: "tool.started",
            category: "tool",
            visibility: "user",
            payload: {
              callId: "call_pending",
              toolName: "apply_patch",
              effect: "write",
            },
          });
        }
        return terminalStream(model, "error", "network error");
      },
    });

    await collect(stream);
    expect(invoked).toEqual(["primary"]);
    const ended = (await fixture.store.listEvents(fixture.thread.id)).find(
      (event) =>
        event.runId === fixture.run.id && event.type === "route_attempt_ended",
    );
    expect(ended?.payload).toEqual(
      expect.objectContaining({
        outcome: "terminal",
        sideEffectState: "unknown",
      }),
    );
    fixture.store.close();
  });
});

function assertPayloadHash(payload: Record<string, unknown>): void {
  const { contentSha256, ...content } = payload;
  expect(contentSha256).toBe(sha256(canonicalJson(content)));
}
