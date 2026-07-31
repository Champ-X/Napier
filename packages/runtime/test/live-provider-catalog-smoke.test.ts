import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { CredentialReferenceStore } from "../src/credentials.js";
import { ModelRegistry } from "../src/models.js";
import {
  exportThreadReplayBundle,
  verifyThreadReplayBundle,
} from "../src/replay.js";
import { LocalStore } from "../src/store.js";

const describeLive =
  process.env["NAPIER_LIVE_PROVIDER_CATALOG_SMOKE"] === "1"
    ? describe
    : describe.skip;
const PREVIOUS_PROVIDERS = new Set([
  "anthropic",
  "deepseek",
  "google",
  "openai",
  "openrouter",
]);
const MODEL_REF = /^([a-z][a-z0-9_-]{0,63})\/(.{1,160})$/u;
const ENVIRONMENT_NAME = /^[A-Z_][A-Z0-9_]{1,127}$/u;
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describeLive("live Pi provider catalog smoke", () => {
  it("runs a newly exposed Provider through the shared Agent and Ledger", async () => {
    const modelRef = process.env["NAPIER_LIVE_PROVIDER_MODEL"]?.trim() ?? "";
    const match = MODEL_REF.exec(modelRef);
    if (!match || PREVIOUS_PROVIDERS.has(match[1]!)) {
      throw new Error(
        "Set NAPIER_LIVE_PROVIDER_MODEL to a newly exposed provider/model",
      );
    }
    const provider = match[1]!;
    const modelId = match[2]!;
    const credentialEnv =
      process.env["NAPIER_LIVE_PROVIDER_CREDENTIAL_ENV"]?.trim() ?? "";
    if (!ENVIRONMENT_NAME.test(credentialEnv)) {
      throw new Error(
        "Set NAPIER_LIVE_PROVIDER_CREDENTIAL_ENV to the API key variable name",
      );
    }
    const apiKey = process.env[credentialEnv]?.trim();
    if (!apiKey) {
      throw new Error(`${credentialEnv} is unavailable`);
    }
    const root = await mkdtemp(path.join(tmpdir(), "napier-live-provider-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const store = new LocalStore({
      dataRoot: path.join(root, "data"),
      workspaceRoot,
    });
    await store.initialize();
    try {
      await store.createCredentialReference({
        providerId: provider,
        label: "Pi provider catalog live smoke",
        source: { type: "environment", variable: credentialEnv },
      });
      const credentials = new CredentialReferenceStore({
        store,
        env: { [credentialEnv]: apiKey },
      });
      const registry = new ModelRegistry(credentials);
      await expect(
        registry.resolveConfigured({ provider, id: modelId }),
      ).resolves.toBeDefined();
      const agent = store.listAgents()[0]!;
      const thread = await store.createThread({
        title: "Live Pi provider catalog smoke",
        agentId: agent.id,
      });
      const runtime = new AgentRuntime(store, registry);

      const run = await runtime.runPrompt({
        threadId: thread.id,
        text: "Reply with exactly NAPIER_PROVIDER_CATALOG_LIVE_OK.",
        model: { provider, id: modelId },
      });

      expect(run.status, run.error).toBe("completed");
      expect(run.configuration?.model).toEqual({ provider, id: modelId });
      const events = await store.listEvents(thread.id);
      expect(JSON.stringify(events)).toContain(
        "NAPIER_PROVIDER_CATALOG_LIVE_OK",
      );
      for (const type of [
        "context.model_envelope",
        "model.response",
        "message.assistant",
        "run.completed",
      ]) {
        expect(events.some((event) => event.type === type)).toBe(true);
      }
      expect(JSON.stringify(events)).not.toContain(apiKey);
      expect(
        verifyThreadReplayBundle(
          await exportThreadReplayBundle(store, thread.id),
        ).status,
      ).toBe("valid");
    } finally {
      store.close();
    }
  }, 60_000);
});
