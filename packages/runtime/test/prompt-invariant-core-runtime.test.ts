import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { createLocalAgentRuntime } from "../src/local-agent-runtime.js";
import { sha256 } from "../src/ed25519.js";
import { PROMPT_COMPILER_VERSION } from "../src/prompt-compiler.js";
import {
  PROMPT_INVARIANT_CORE,
  PROMPT_INVARIANT_CORE_CONTENT_SHA256,
  PROMPT_INVARIANT_CORE_VERSION,
} from "../src/prompt-invariant-core.js";
import { UnsupportedSandboxAdapter } from "../src/sandbox.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Prompt Invariant Core Runtime binding", () => {
  it("sends the versioned Core to the Provider and records hash-only layer evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-prompt-core-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      env: {},
      sandbox: new UnsupportedSandboxAdapter("prompt-core-test"),
    });
    try {
      const systemPrompts: string[] = [];
      const provider = fauxProvider({
        provider: "faux-prompt-core",
        api: "openai-responses",
      });
      provider.setResponses([
        (context) => {
          systemPrompts.push(context.systemPrompt ?? "");
          return fauxAssistantMessage("PROMPT_CORE_DONE");
        },
        (context) => {
          systemPrompts.push(context.systemPrompt ?? "");
          return fauxAssistantMessage('{"facts":[]}');
        },
      ]);
      services.models.registerProvider(provider.provider);
      const agent = services.store.listAgents()[0]!;
      const thread = await services.store.createThread({
        title: "Prompt Core Runtime binding",
        agentId: agent.id,
      });

      const run = await services.runtime.runPrompt({
        threadId: thread.id,
        text: "Exercise the versioned behavior contract.",
        model: { provider: provider.provider.id, id: "faux-1" },
      });

      expect(run.status, run.error).toBe("completed");
      const systemPrompt = systemPrompts[0] ?? "";
      expect(systemPrompt).toContain(
        `<napier_invariant_core version="${PROMPT_INVARIANT_CORE_VERSION}">`,
      );
      expect(systemPrompt.match(/<napier_invariant_core/gu)).toHaveLength(1);
      expect(systemPrompt).toContain(PROMPT_INVARIANT_CORE);
      expect(systemPrompt).toContain(agent.systemPrompt);
      expect(systemPrompt).not.toContain("<agent_profile_instructions>");
      expect(systemPrompt.indexOf(PROMPT_INVARIANT_CORE)).toBeLessThan(
        systemPrompt.indexOf(agent.systemPrompt),
      );
      expect(systemPrompt).toContain("<workspace_tool_protocol>");

      const events = (await services.store.listEvents(thread.id)).filter(
        (event) => event.runId === run.id,
      );
      const envelope = events.find(
        (event) =>
          event.type === "context.model_envelope" &&
          event.payload["turnIndex"] === 0,
      );
      const promptPackage = events.find(
        (event) =>
          event.type === "context.prompt_package" &&
          event.payload["turnIndex"] === 0,
      );
      expect(envelope?.payload).toEqual(
        expect.objectContaining({
          systemPromptBytes: Buffer.byteLength(systemPrompt, "utf8"),
          systemPromptSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      );
      expect(promptPackage?.payload).toEqual(
        expect.objectContaining({
          schemaVersion: 3,
          packageVersion: "napier.prompt-context.v3",
          compilerVersion: PROMPT_COMPILER_VERSION,
          classification: "independent_layers_v1",
          purpose: "agent_turn",
          invariantCore: {
            status: "bound",
            version: PROMPT_INVARIANT_CORE_VERSION,
            contentSha256: PROMPT_INVARIANT_CORE_CONTENT_SHA256,
            bytes: Buffer.byteLength(PROMPT_INVARIANT_CORE, "utf8"),
          },
          systemPromptBytes: Buffer.byteLength(systemPrompt, "utf8"),
          systemPromptSha256: envelope?.payload["systemPromptSha256"],
          lossless: true,
          layers: expect.arrayContaining([
            expect.objectContaining({
              id: "invariant_core",
              bytes: expect.any(Number),
              estimatedTokens: expect.any(Number),
              contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
            }),
            expect.objectContaining({
              id: "task_skill_overlay",
              sources: expect.arrayContaining([
                expect.objectContaining({
                  sourceId: "task.agent_profile",
                  inputContentSha256: sha256(agent.systemPrompt),
                  included: true,
                }),
              ]),
            }),
          ]),
        }),
      );
      const invariantLayer = (
        promptPackage?.payload["layers"] as Array<Record<string, unknown>>
      ).find((layer) => layer["id"] === "invariant_core");
      expect(Number(invariantLayer?.["bytes"])).toBeGreaterThanOrEqual(
        Buffer.byteLength(PROMPT_INVARIANT_CORE, "utf8"),
      );
      const serializedEvidence = JSON.stringify([
        envelope?.payload,
        promptPackage?.payload,
      ]);
      expect(serializedEvidence).not.toContain(PROMPT_INVARIANT_CORE);
      expect(serializedEvidence).not.toContain(agent.systemPrompt);
      expect(PROMPT_INVARIANT_CORE_CONTENT_SHA256).toMatch(/^[a-f0-9]{64}$/u);
    } finally {
      await services.shutdown();
    }
  });
});
