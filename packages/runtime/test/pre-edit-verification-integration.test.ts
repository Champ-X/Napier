import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type Context,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { LocalStore } from "../src/store.js";
import { AgentRuntime } from "../src/agent-runtime.js";
import { ModelRegistry } from "../src/models.js";
import { HostDirectSandboxAdapter } from "../src/sandbox-host-direct.js";
import {
  createHarnessPolicyProfile,
  presetHarnessPolicy,
} from "../src/harness-policy-profile.js";
import { createModelHarnessExperimentProfile } from "../src/model-harness-experiment-profile.js";
import { sha256 } from "../src/ed25519.js";
import {
  assessPreEditVerification,
  PRE_EDIT_VERIFICATION_GUIDANCE,
} from "../src/pre-edit-verification.js";
import { CONTRACT_STAGED_VERIFICATION_PROTOCOL } from "../src/contract-verification-protocol.js";
import {
  AgentTurnPipeline,
  DEFAULT_AGENT_TURN_PROMPT_ADAPTER,
  DEFAULT_AGENT_TURN_TOOL_ADAPTER,
} from "../src/agent-turn-pipeline.js";

// Scripted model, actual filesystem and verifier processes; no provider/API call
// and no claim of model task quality or OS isolation from these checks.
it.each([
  "test",
  "failed_attempt",
  "denied",
  "unavailable",
  "disabled",
  "staged",
] as const)(
  "integrates optional patch ordering in the governed Agent loop: %s",
  async (mode) => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-durable-pre-edit-"));
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const before = "export const value = 1;\n",
      after = "export const value = 2;\n";
    await writeFile(path.join(workspaceRoot, "value.mjs"), before);
    await writeFile(
      path.join(workspaceRoot, "value.test.mjs"),
      "import {test} from 'node:test';import assert from 'node:assert/strict';import {value} from './value.mjs';test('requested value',()=>assert.equal(value,2));\n",
    );
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
    });
    try {
      await store.initialize();
      const hasVerifier = mode !== "unavailable",
        ordered = mode !== "disabled";
      const agent = await store.updateAgent(store.listAgents()[0]!.id, {
        toolPolicy: "workspace",
        enabledTools: [
          "read_file",
          "apply_patch",
          ...(hasVerifier ? ["verify_workspace"] : []),
        ],
      });
      const thread = await store.createThread({
        agentId: agent.id,
        title: "Patch ordering integration",
      });
      const provider = fauxProvider({ provider: "pre-edit-local" });
      const patch = () =>
        fauxAssistantMessage(
          fauxToolCall("apply_patch", {
            operation: "replace",
            path: "value.mjs",
            expectedSha256: sha256(before),
            edits: [{ oldText: before, newText: after }],
          }),
          { stopReason: "toolUse" },
        );
      const verify = (target: string) =>
        fauxAssistantMessage(
          fauxToolCall("verify_workspace", { kind: "test", target }),
          { stopReason: "toolUse" },
        );
      provider.setResponses([
        (context: Context) => {
          expect(
            context.systemPrompt?.includes(CONTRACT_STAGED_VERIFICATION_PROTOCOL),
          ).toBe(mode === "staged");
          expect(
            context.systemPrompt?.includes(PRE_EDIT_VERIFICATION_GUIDANCE),
          ).toBe(hasVerifier && ordered);
          return fauxAssistantMessage(
            fauxToolCall("read_file", { path: "value.mjs" }),
            {
              stopReason: "toolUse",
            },
          );
        },
        patch(),
        ...(hasVerifier && ordered
          ? [
              async (context: Context) => {
                expect(
                  await readFile(path.join(workspaceRoot, "value.mjs"), "utf8"),
                ).toBe(before);
                expect(JSON.stringify(context.messages)).toContain(
                  "before-first-patch",
                );
                return verify(
                  mode === "failed_attempt"
                    ? "missing.test.mjs"
                    : "value.test.mjs",
                );
              },
              patch(),
            ]
          : []),
        ...(hasVerifier && mode !== "denied" ? [verify("value.test.mjs")] : []),
        fauxAssistantMessage("Updated value to 2."),
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      const models = new ModelRegistry();
      models.registerProvider(provider.provider);
      const runtime = new AgentRuntime(
        store,
        models,
        undefined,
        new HostDirectSandboxAdapter(),
      );
      if (mode === "denied")
        runtime.attachKernelTurnPipeline(
          new AgentTurnPipeline({
            prompt: DEFAULT_AGENT_TURN_PROMPT_ADAPTER,
            tool: DEFAULT_AGENT_TURN_TOOL_ADAPTER,
            policy: {
              id: "test.deny-verifier",
              preflight: (input) =>
                input.toolCall.name === "verify_workspace"
                  ? {
                      block: true,
                      reason: "Verification denied by the test caller policy",
                    }
                  : undefined,
            },
          }),
        );
      const {
        schemaVersion: _v,
        contentSha256: _h,
        ...base
      } = presetHarnessPolicy("coding-node.v1");
      const policies = createHarnessPolicyProfile({
        ...base,
        context: {
          ...base.context,
          validation: mode === "staged" ? "contract-staged-v3" : "contract-first-v1",
          ...(ordered
            ? { verificationOrder: "before-first-patch-v1" as const }
            : {}),
        },
      });
      const streamedBlocks: string[] = [];
      const run = await runtime.runPrompt({
        threadId: thread.id,
        text: "Change value to 2, preserving the interface.",
        model: { provider: "pre-edit-local", id: "faux-1" },
        onEvent: (event) => {
          if (
            event.type === "tool.blocked" &&
            event.payload.harnessInterventionReason === "pre_edit_verification"
          )
            streamedBlocks.push(event.id);
        },
        harnessExperimentProfile: createModelHarnessExperimentProfile({
          id: "pre-edit.local.v1",
          maxActiveTools: 20,
          policies,
        }),
      });
      expect(run.status, run.error).toBe("completed");
      expect(
        await readFile(path.join(workspaceRoot, "value.mjs"), "utf8"),
      ).toBe(after);
      const events = await store.listRunEvents(run.id);
      const blocks = events.filter(
        (e) =>
          e.type === "tool.blocked" &&
          e.payload.harnessInterventionReason === "pre_edit_verification",
      );
      expect(blocks).toHaveLength(hasVerifier && ordered ? 1 : 0);
      expect(streamedBlocks).toEqual(blocks.map((event) => event.id));
      const checks = events.filter(
        (e) =>
          ["tool.completed", "tool.failed", "tool.blocked"].includes(e.type) &&
          e.payload.toolName === "verify_workspace",
      );
      const firstPatch = events.find(
        (e) =>
          e.type === "tool.started" && e.payload.toolName === "apply_patch",
      )!;
      if (hasVerifier && ordered)
        expect(checks[0]!.seq).toBeLessThan(firstPatch.seq);
      if (hasVerifier && mode !== "denied")
        expect(checks.at(-1)!.payload.details).toMatchObject({
          status: "passed",
        });
      else if (mode === "denied") {
        // Policy denial and the normalized failed tool result share one call.
        expect(new Set(checks.map((e) => e.payload.callId)).size).toBe(1);
        expect(checks.map((e) => e.type)).toEqual([
          "tool.blocked",
          "tool.failed",
        ]);
        expect(
          events.some(
            (e) =>
              e.type === "tool.started" &&
              e.payload.toolName === "verify_workspace",
          ),
        ).toBe(false);
      } else expect(checks).toHaveLength(0);
      for (const e of events.filter(
        (e) =>
          e.type === "tool.started" &&
          e.payload.toolName === "verify_workspace",
      ))
        expect(e.payload.verificationKind).toBe("test");
      store.close();
      await store.initialize();
      const restored = await store.listRunEvents(run.id);
      expect(restored.filter((e) => e.type === "tool.started")).toEqual(
        events.filter((e) => e.type === "tool.started"),
      );
      if (hasVerifier && ordered) {
        expect(
          assessPreEditVerification({
            runId: run.id,
            toolName: "apply_patch",
            verificationAvailable: true,
            events: restored.filter((e) => e.seq < firstPatch.seq),
          }).status,
        ).toBe("settled_test_attempt");
      }
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
