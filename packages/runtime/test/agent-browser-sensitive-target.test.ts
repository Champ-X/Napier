import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime, LocalStore, ModelRegistry } from "../src/index.js";
import { BrowserInteractionConfirmationManager } from "../src/browser-interaction-confirmations.js";
import {
  cleanupBrowserSessionHarnesses,
  createBrowserSessionHarness,
} from "./browser-session-harness.js";

const roots: string[] = [];

afterEach(async () => {
  await cleanupBrowserSessionHarnesses();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent Browser sensitive-target handoff", () => {
  it("blocks credential typing before confirmation or Browser execution", async () => {
    const fixture = await createFixture();
    const harness = await createBrowserSessionHarness({
      pageHtml: `
        <html><body>
          <form>
            <input id="target" autocomplete="username">
            <input type="password" value="PRIVATE_PASSWORD">
            <button>Sign in</button>
          </form>
        </body></html>
      `,
    });
    const provider = fauxProvider({ provider: "faux-browser-credential" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("browser", {
          action: "start",
          url: "https://example.com/login",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("browser", {
          action: "type",
          target: { ref: "e2" },
          text: "SYNTHETIC_USER",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Credential entry requires human takeover."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    fixture.registry.registerProvider(provider.provider);
    const confirmations = new BrowserInteractionConfirmationManager(
      fixture.store,
      { available: true, timeoutMs: 5_000 },
    );
    const runtime = new AgentRuntime(
      fixture.store,
      fixture.registry,
      undefined,
      undefined,
      undefined,
      undefined,
      harness.manager,
      undefined,
      undefined,
      undefined,
      undefined,
      {},
      confirmations,
    );

    const run = await runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Type the synthetic username only if Agent automation is allowed.",
      model: { provider: "faux-browser-credential", id: "faux-1" },
    });

    expect(run.status, run.error).toBe("completed");
    expect(harness.pages[0]?.filled).toEqual([]);
    expect(
      (await fixture.store.listEvents(fixture.threadId)).some((event) =>
        event.type.startsWith("browser.interaction_confirmation."),
      ),
    ).toBe(false);
    const events = await fixture.store.listEvents(fixture.threadId);
    expect(
      events.find(
        (event) =>
          event.type === "tool.blocked" &&
          event.payload &&
          !Array.isArray(event.payload) &&
          typeof event.payload === "object" &&
          event.payload["toolName"] === "browser",
      )?.payload,
    ).toEqual(
      expect.objectContaining({
        action: "type",
        policyReason: expect.stringContaining(
          "requires pause-bound human takeover",
        ),
        toolProtocol: expect.objectContaining({
          kind: "napier.tool-ui-projection",
          schemaVersion: 2,
          toolId: "browser",
          semanticVersion: "2.0.0",
          definitionSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          implementationSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          status: "blocked",
          sideEffect: "unknown",
          concurrency: "serialized",
          compatibilityMode: "native",
        }),
      }),
    );
    const durable = JSON.stringify(events);
    expect(durable).not.toContain("PRIVATE_PASSWORD");
    expect(durable).not.toContain("SYNTHETIC_USER");
  });

  it("blocks human-verification controls before confirmation or click", async () => {
    const fixture = await createFixture();
    const harness = await createBrowserSessionHarness({
      pageHtml: `
        <html><body>
          <div class="cf-turnstile">
            <button id="target">Verify you are human</button>
          </div>
        </body></html>
      `,
    });
    const provider = fauxProvider({ provider: "faux-browser-challenge" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("browser", {
          action: "start",
          url: "https://example.com/challenge",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("browser", {
          action: "click",
          target: { ref: "e3" },
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Human verification requires takeover."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    fixture.registry.registerProvider(provider.provider);
    const confirmations = new BrowserInteractionConfirmationManager(
      fixture.store,
      { available: true, timeoutMs: 5_000 },
    );
    const runtime = new AgentRuntime(
      fixture.store,
      fixture.registry,
      undefined,
      undefined,
      undefined,
      undefined,
      harness.manager,
      undefined,
      undefined,
      undefined,
      undefined,
      {},
      confirmations,
    );

    const run = await runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Click the challenge only if Agent automation is allowed.",
      model: { provider: "faux-browser-challenge", id: "faux-1" },
    });

    expect(run.status, run.error).toBe("completed");
    expect(harness.pages[0]?.clicked).toEqual([]);
    const events = await fixture.store.listEvents(fixture.threadId);
    expect(
      events.some((event) =>
        event.type.startsWith("browser.interaction_confirmation."),
      ),
    ).toBe(false);
    expect(JSON.stringify(events)).not.toContain("Verify you are human");
    expect(
      events.find((event) => event.type === "tool.blocked")?.payload,
    ).toEqual(
      expect.objectContaining({
        action: "click",
        policyReason: expect.stringContaining(
          "human-verification controls require pause-bound human takeover",
        ),
      }),
    );
  });
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-sensitive-target-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const agent = await store.updateAgent(store.listAgents()[0]!.id, {
    toolPolicy: "workspace",
    enabledTools: ["browser"],
  });
  const thread = await store.createThread({
    title: "Browser sensitive target",
    agentId: agent.id,
  });
  return {
    store,
    threadId: thread.id,
    registry: new ModelRegistry(),
  };
}
