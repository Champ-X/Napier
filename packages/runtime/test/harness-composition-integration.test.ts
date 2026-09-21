import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type Context,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { AgentRuntime } from "../src/agent-runtime.js";
import { LocalStore } from "../src/store.js";
import { ModelRegistry } from "../src/models.js";
import { HostDirectSandboxAdapter } from "../src/sandbox-host-direct.js";
import { OciContainerSandboxAdapter } from "../src/sandbox-oci.js";
import { createHarnessPolicyProfile } from "../src/harness-policy-profile.js";
import {
  bindRunHarnessProfile,
  createModelHarnessExperimentProfile,
} from "../src/model-harness-experiment-profile.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { ModelInvocationCapsuleStore } from "../src/model-invocation-capsule-store.js";
import { assertRuntimeContextInvocation } from "../src/runtime-context-evidence.js";
import { assertModelRequestEvidenceBindings } from "../src/model-prompt-evidence-bindings.js";
import { exportRunInputReproduction } from "../src/run-input-reproduction.js";

function composition(
  validation: "contract-first-v1" | "contract-transitions-v2",
  planning?: "proportional-v1",
) {
  const base = bindRunHarnessProfile({
    harnessPolicyPreset: "coding-python.v1",
  }).harnessExperimentProfile!;
  const {
    schemaVersion: _version,
    contentSha256: _hash,
    ...policies
  } = base.policies!;
  return createModelHarnessExperimentProfile({
    ...base,
    id: "napier.current-integrated.v1",
    policies: createHarnessPolicyProfile({
      ...policies,
      id: "current-integrated.v1",
      context: {
        ...policies.context,
        memory: "task-aware-grouped-v3",
        delivery: "tail-v1",
        finalization: "request-aware-v1",
        validation,
        ...(planning ? { planning } : {}),
        verificationOrder: "before-first-patch-v1",
      },
      toolSurface: { ...policies.toolSurface, unifiedDiff: true },
    }),
  });
}

// Scripted local model plus real filesystem, SQLite and test processes. This
// checks composition wiring and evidence, not stochastic model task quality.
it.each([
  ["node", "contract-first-v1", undefined],
  ["python", "contract-first-v1", undefined],
  ["node", "contract-transitions-v2", undefined],
  ["python", "contract-transitions-v2", undefined],
  ["node", "contract-transitions-v2", "proportional-v1"],
] as const)(
  "integrates the complete candidate through %s repair with %s, fresh context and original-input export",
  async (language, validation, planning) => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-composition-"));
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const source = language === "node" ? "lib/value.mjs" : "value.py";
    const target = language === "node" ? "value.test.mjs" : "test_value.py";
    const before =
      language === "node" ? "export const value = 1;\n" : "value = 1\n";
    const after = before.replace("1", "2");
    await mkdir(path.dirname(path.join(workspaceRoot, source)), {
      recursive: true,
    });
    await writeFile(path.join(workspaceRoot, source), before);
    await writeFile(
      path.join(workspaceRoot, target),
      language === "node"
        ? "import {test} from 'node:test';import assert from 'node:assert/strict';import {value} from './lib/value.mjs';test('requested value',()=>assert.equal(value,2));\n"
        : "import unittest\nfrom value import value\nclass ValueTest(unittest.TestCase):\n def test_value(self): self.assertEqual(value,2)\n",
    );
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
    });
    try {
      await store.initialize();
      const linked = [];
      for (let i = 0; i < 2; i++) {
        const memory = await store.proposeMemory(
          {
            content: "Original module value equals one.",
            category: "context",
            ...(i === 1
              ? { scope: "agent" as const, agentId: store.listAgents()[0]!.id }
              : {}),
          },
          {
            type: "manual",
            fileDependencies: [{ path: source, sha256: sha256(before) }],
          },
        );
        await store.reviewMemory(memory.id, { action: "approve" });
        linked.push(memory.id);
      }
      const constraint = await store.proposeMemory(
        { content: "Preserve the integer interface.", category: "constraint" },
        { type: "manual" },
      );
      await store.reviewMemory(constraint.id, { action: "approve" });
      await store.proposeMemory(
        { content: "UNREVIEWED_MEMORY_MARKER", category: "context" },
        { type: "manual" },
      );
      const agent = await store.updateAgent(store.listAgents()[0]!.id, {
        toolPolicy: "workspace",
        enabledTools: ["read_file", "apply_patch", "verify_workspace"],
        enabledSkills: [],
        enabledSubagents: [],
      });
      const thread = await store.createThread({
        agentId: agent.id,
        title: "Complete composition",
      });
      const provider = fauxProvider({ provider: "composition-local" });
      let snapshotRef: string | undefined;
      let finalVerificationOutput = "";
      const call = (name: string, args: Record<string, unknown>) =>
        fauxAssistantMessage(fauxToolCall(name, args), {
          stopReason: "toolUse",
        });
      const patch = () =>
        call("apply_patch", {
          operation: "unified_diff",
          path: source,
          snapshotRef,
          diff: `--- a/${source}\n+++ b/${source}\n@@ -1 +1 @@\n-${before}+${after}`,
        });
      const verify = (selected = false) =>
        call("verify_workspace", {
          kind: "test",
          runtime: language,
          ...(language === "node" ? { testRunner: "node-test" } : {}),
          ...(selected ? { affectedBy: [source] } : { target }),
        });
      const tail = (context: Context) => {
        expect(context.systemPrompt).toContain(`version="${validation}"`);
        expect(
          context.systemPrompt?.includes(
            "before drafting the complete implementation",
          ),
        ).toBe(planning === "proportional-v1");
        expect(JSON.stringify(context)).not.toContain(
          "UNREVIEWED_MEMORY_MARKER",
        );
        expect(context.systemPrompt).not.toContain(
          "Original module value equals one.",
        );
        return JSON.stringify(context.messages.at(-1));
      };
      provider.setResponses([
        (context) => {
          expect(tail(context)).toContain("Original module value equals one.");
          return call("read_file", { path: source });
        },
        (context) => {
          snapshotRef = JSON.stringify(context.messages).match(
            /s[0-9a-f]{16}_[0-9]+/u,
          )?.[0];
          expect(snapshotRef).toBeDefined();
          return patch();
        },
        async (context) => {
          expect(await readFile(path.join(workspaceRoot, source), "utf8")).toBe(
            before,
          );
          expect(JSON.stringify(context.messages)).toContain(
            "before-first-patch",
          );
          return verify();
        },
        () => patch(),
        (context) => {
          const projected = tail(context);
          expect(projected).not.toContain("Original module value equals one.");
          expect(projected).toContain("Preserve the integer interface.");
          expect(projected).toContain("napier.task-working-state");
          expect(projected).toContain(source);
          return verify(true);
        },
        (context) => {
          tail(context);
          const message = context.messages.at(-1)!;
          expect(typeof message.content).toBe("string");
          const delivery = JSON.parse(String(message.content));
          const working = delivery.sources.find((item: { content: string }) =>
            item.content.includes('"kind":"napier.task-working-state"'),
          );
          const state = JSON.parse(working.content.split("\n").at(-1));
          expect(state.verifications).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                status: "passed",
                freshness: "current",
                selectionMode: "selected",
                selectedTestCount: 1,
              }),
            ]),
          );
          finalVerificationOutput = JSON.stringify(
            context.messages
              .filter((message) => message.role === "toolResult")
              .at(-1),
          );
          return fauxAssistantMessage(
            "Updated value to 2 and verified its behavior.",
          );
        },
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      const models = new ModelRegistry();
      models.registerProvider(provider.provider);
      const profile = composition(validation, planning);
      const run = await new AgentRuntime(
        store,
        models,
        undefined,
        process.env.NAPIER_LIVE_COMPOSITION_OCI === "1"
          ? new OciContainerSandboxAdapter(
              process.env.NAPIER_CONTAINER_SANDBOX_IMAGE,
            )
          : new HostDirectSandboxAdapter(),
      ).runPrompt({
        threadId: thread.id,
        text: `Fix ${source} so value equals 2. Preserve the integer interface and existing test file.`,
        model: { provider: provider.provider.id, id: "faux-1" },
        harnessExperimentProfile: profile,
        captureInitialState: true,
      });
      expect(run.status, run.error).toBe("completed");
      expect(await readFile(path.join(workspaceRoot, source), "utf8")).toBe(
        after,
      );
      const events = await store.listRunEvents(run.id);
      const bound = events.find((e) => e.type === "harness.policy.bound")!;
      expect(JSON.parse(String(bound.payload.profileJson))).toEqual(profile);
      const invocations = events.filter(
        (e) =>
          e.type === "context.model_invocation" &&
          e.payload.purpose === "agent_turn",
      );
      expect(bound.seq).toBeLessThan(invocations[0]!.seq);
      expect(invocations).toHaveLength(6);
      const blocks = events.filter(
        (e) =>
          e.type === "tool.blocked" &&
          e.payload.harnessInterventionReason === "pre_edit_verification",
      );
      expect(blocks).toHaveLength(1);
      const checks = events.filter(
        (e) =>
          e.type === "tool.completed" &&
          e.payload.toolName === "verify_workspace",
      );
      expect(checks).toHaveLength(2);
      expect(checks[0]!.payload.details).toMatchObject({ status: "failed" });
      expect(checks[1]!.payload.details, finalVerificationOutput).toMatchObject(
        {
          status: "passed",
          selectionMode: "selected",
          selectedTestCount: 1,
          snapshotStatus: "unchanged",
        },
      );
      const edits = events.filter(
        (e) =>
          e.type === "tool.completed" && e.payload.toolName === "apply_patch",
      );
      expect(edits).toHaveLength(1);
      expect(checks[0]!.seq).toBeLessThan(edits[0]!.seq);
      const memories = events.filter(
        (e) =>
          e.type === "context.memory" && e.payload.phase === "model_invocation",
      );
      expect(memories[0]!.payload).toMatchObject({
        retrievalVersion: "sqlite-fts5-grouped-v3",
        grouping: { duplicateCount: 1 },
        query: {
          kind: "task-requirement-events-v1",
          sourceEventIds: events
            .filter((event) => event.type === "message.user")
            .map((event) => event.id),
          sourceRunIds: [run.id],
        },
      });
      expect(memories.at(-1)!.payload.staleFactIds).toEqual(
        expect.arrayContaining(linked),
      );
      expect(memories.at(-1)!.payload.staleFactIds).toHaveLength(linked.length);
      expect(memories.at(-1)!.payload.factIds).toContain(constraint.id);
      const capsules = new ModelInvocationCapsuleStore(store.dataRoot);
      assertModelRequestEvidenceBindings(events);
      for (const event of invocations) {
        const capsule = await capsules.read(
          String(event.payload.capsuleSha256),
        );
        assertRuntimeContextInvocation(events, capsule);
      }
      expect(
        events.filter((e) => e.type === "context.runtime_context.delivered"),
      ).toHaveLength(invocations.length);
      expect(
        events.some(
          (e) =>
            e.type === "context.prompt_cache_projection" &&
            Number(e.payload.schemaCompatibleSystemPrefixBytes) > 0,
        ),
      ).toBe(true);
      const eventBytes = canonicalJson(events);
      store.close();
      await store.initialize();
      expect(canonicalJson(await store.listRunEvents(run.id))).toBe(eventBytes);
      const output = path.join(root, "reproduction");
      await exportRunInputReproduction({
        store,
        threadId: thread.id,
        runId: run.id,
        output,
      });
      expect(await readFile(path.join(output, "fixture", source), "utf8")).toBe(
        before,
      );
      expect((await stat(output)).mode & 0o777).toBe(0o700);
      const receipt = JSON.parse(
        await readFile(path.join(output, "reproduction.json"), "utf8"),
      );
      expect(receipt).toMatchObject({
        originalStatus: "completed",
        workspaceComplete: true,
        qualificationReady: false,
        initialInvocationEventId: invocations[0]!.id,
      });
      expect(canonicalJson(await store.listRunEvents(run.id))).toBe(eventBytes);
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
