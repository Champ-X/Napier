import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { createLocalAgentRuntime } from "../src/local-agent-runtime.js";
import { validateModelContextEnvelopeReceipt } from "../src/model-context-envelope.js";
import { assertModelRequestEvidenceBindings } from "../src/model-prompt-evidence-bindings.js";
import { exportThreadReplayBundle } from "../src/replay.js";
import { UnsupportedSandboxAdapter } from "../src/sandbox.js";
import { verifyThreadReplayBundle } from "../src/thread-bundles.js";

describe("main model capture cancellation", () => {
  it.each(["context.model_envelope", "context.model_invocation"])(
    "retains terminal binding when cancelled at %s before dispatch",
    async (boundary) => {
      const root = await mkdtemp(path.join(tmpdir(), "napier-capture-cancel-"));
      const workspaceRoot = path.join(root, "workspace");
      await mkdir(workspaceRoot);
      const services = await createLocalAgentRuntime({
        workspaceRoot, dataRoot: path.join(root, "state"), env: {},
        sandbox: new UnsupportedSandboxAdapter("capture-cancellation-test"),
      });
      try {
        const provider = fauxProvider({ provider: "capture-cancel" });
        provider.setResponses([fauxAssistantMessage("must not dispatch")]);
        services.models.registerProvider(provider.provider);
        const thread = await services.store.createThread({
          title: "Capture cancellation", agentId: services.store.listAgents()[0]!.id,
        });
        const abort = new AbortController();
        const run = await services.runtime.runPrompt({
          threadId: thread.id, text: "Only the captured request.",
          model: { provider: "capture-cancel", id: "faux-1" }, signal: abort.signal,
          onEvent: (event) => { if (event.type === boundary) abort.abort(); },
        });
        expect(abort.signal.aborted).toBe(true);
        expect(provider.state.callCount).toBe(0);
        expect(run.status).toBe("cancelled");
        const events = await services.store.listRunEvents(run.id);
        const envelopes = events.filter((event) => event.type === "context.model_envelope");
        const responses = events.filter((event) => event.type === "model.response");
        expect(envelopes).toHaveLength(1);
        expect(responses).toHaveLength(1);
        expect(responses[0]!.payload).toMatchObject({
          modelContextEnvelopeSha256: validateModelContextEnvelopeReceipt(envelopes[0]!.payload).contentSha256,
          modelContextEnvelopeTurnIndex: 0,
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        });
        expect(() => assertModelRequestEvidenceBindings(events)).not.toThrow();
        expect(verifyThreadReplayBundle(await exportThreadReplayBundle(services.store, thread.id)))
          .toMatchObject({ status: "valid", diagnostics: [] });
      } finally {
        await services.shutdown();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
