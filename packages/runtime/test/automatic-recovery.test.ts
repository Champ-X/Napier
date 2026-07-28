import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import {
  emptyUsage,
  type AgentProfile,
  type RunEvent,
  type RunRecord,
} from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  assessAutomaticRecovery,
  validateAutomaticRecoveryAssessment,
} from "../src/automatic-recovery.js";
import { AgentRuntime } from "../src/agent-runtime.js";
import { ModelRegistry } from "../src/models.js";
import { RecoveryService } from "../src/recovery-service.js";
import { exportThreadReplayBundle } from "../src/replay.js";
import { createRunConfigurationFingerprint } from "../src/run-config.js";
import { loadWorkspaceSkills } from "../src/skills.js";
import { LocalStore } from "../src/store.js";

const temporaryRoots: string[] = [];
const openStores: LocalStore[] = [];

const PROFILE: AgentProfile = {
  id: "agent_recovery",
  name: "Recovery Agent",
  description: "A snapshot-bound recovery fixture.",
  systemPrompt: "Recover only from durable evidence.",
  model: { provider: "faux-recovery-policy", id: "faux-1" },
  thinkingLevel: "medium",
  toolPolicy: "workspace",
  enabledTools: ["list_files", "read_file", "apply_patch"],
  enabledSkills: [],
  enabledSubagents: ["reviewer"],
  subagentLimits: {
    maxConcurrent: 1,
    maxTotal: 2,
    maxTurns: 4,
    timeoutMs: 30_000,
  },
  runLimits: {
    maxTurns: 8,
    maxTotalTokens: 50_000,
    maxCostUsd: 2,
    timeoutMs: 120_000,
  },
  automaticRecovery: {
    mode: "safe_read_only",
    maxAttempts: 2,
    backoffMs: 1_000,
  },
  revision: 2,
  createdAt: "2026-07-25T00:00:00.000Z",
  updatedAt: "2026-07-25T00:10:00.000Z",
};

afterEach(async () => {
  for (const store of openStores.splice(0)) store.close();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("safe automatic recovery", () => {
  it("produces hash-bound metadata-only eligibility and fails unsafe evidence closed", () => {
    const run = interruptedRun();
    const completedRead = [
      event(1, "tool.started", {
        callId: "read-1",
        toolName: "read_file",
        status: "started",
        input: { path: "secret.txt" },
      }),
      event(2, "tool.completed", {
        callId: "read-1",
        toolName: "read_file",
        status: "completed",
        output: "sensitive contents",
      }),
    ];
    const assessment = assessAutomaticRecovery({
      run,
      events: completedRead,
      assessedAt: new Date("2026-07-25T00:00:02.000Z"),
    });

    expect(assessment).toEqual(
      expect.objectContaining({
        eligible: true,
        blockReasons: [],
        toolCalls: {
          total: 1,
          readOnly: 1,
          unsafe: 0,
          unknownEffect: 0,
          unresolved: 0,
        },
      }),
    );
    expect(JSON.stringify(assessment)).not.toContain("secret.txt");
    expect(JSON.stringify(assessment)).not.toContain("sensitive contents");
    expect(validateAutomaticRecoveryAssessment(assessment)).toEqual(assessment);

    const unresolved = assessAutomaticRecovery({
      run,
      events: completedRead.slice(0, 1),
    });
    expect(unresolved.eligible).toBe(false);
    expect(unresolved.blockReasons).toContain("unresolved_tool_call");

    const write = assessAutomaticRecovery({
      run,
      events: [
        event(1, "tool.started", {
          callId: "write-1",
          toolName: "apply_patch",
          status: "started",
        }),
        event(2, "tool.completed", {
          callId: "write-1",
          toolName: "apply_patch",
          status: "completed",
        }),
      ],
    });
    expect(write.blockReasons).toContain("unsafe_tool_effect");

    const unknown = assessAutomaticRecovery({
      run,
      events: [
        event(1, "tool.started", {
          callId: "mcp-1",
          toolName: "mcp__unknown__lookup",
          status: "started",
        }),
        event(2, "tool.completed", {
          callId: "mcp-1",
          toolName: "mcp__unknown__lookup",
          status: "completed",
        }),
      ],
    });
    expect(unknown.blockReasons).toContain("unknown_tool_effect");

    const tampered = structuredClone(assessment);
    tampered.toolCalls.readOnly = 0;
    expect(() => validateAutomaticRecoveryAssessment(tampered)).toThrow(
      "tool counts are inconsistent",
    );
  });

  it("claims once across Store instances and reissues only the expired claim", async () => {
    const root = await createRoot();
    const setup = await createStore(root);
    const agent = await setup.updateAgent(setup.listAgents()[0]!.id, {
      model: { provider: "faux-claim", id: "faux-1" },
      automaticRecovery: {
        mode: "safe_read_only",
        maxAttempts: 2,
        backoffMs: 1_000,
      },
    });
    const thread = await setup.createThread({
      title: "Concurrent recovery claim",
      agentId: agent.id,
    });
    await setup.createRun({ threadId: thread.id, agentId: agent.id });
    setup.close();
    openStores.splice(openStores.indexOf(setup), 1);

    const left = await createStore(root);
    const right = await createStore(root);
    const claimAt = new Date(Date.now() + 5_000);
    const [leftResult, rightResult] = await Promise.all([
      left.claimAutomaticRecoveries("recoveryworker_left", {
        now: claimAt,
        leaseMs: 5_000,
      }),
      right.claimAutomaticRecoveries("recoveryworker_right", {
        now: claimAt,
        leaseMs: 5_000,
      }),
    ]);
    const firstClaims = [...leftResult.claims, ...rightResult.claims];
    expect(firstClaims).toHaveLength(1);
    expect(left.listAutomaticRecoveryAttempts(thread.id)).toHaveLength(1);

    const reclaimed = await right.claimAutomaticRecoveries(
      "recoveryworker_takeover",
      {
        now: new Date(claimAt.getTime() + 5_001),
        leaseMs: 5_000,
      },
    );
    expect(reclaimed.claims).toHaveLength(1);
    expect(reclaimed.claims[0]!.attempt.id).toBe(firstClaims[0]!.attempt.id);
    expect(reclaimed.claims[0]!.attempt.attempt).toBe(1);
    expect(right.listAutomaticRecoveryAttempts(thread.id)).toHaveLength(1);
  });

  it("remaps a multi-interruption recovery chain before recomputing fixture hashes", async () => {
    const root = await createRoot();
    const setup = await createStore(root);
    const agent = await setup.updateAgent(setup.listAgents()[0]!.id, {
      model: { provider: "faux-chain", id: "faux-1" },
      automaticRecovery: {
        mode: "safe_read_only",
        maxAttempts: 3,
        backoffMs: 1_000,
      },
    });
    const thread = await setup.createThread({
      title: "Portable recovery chain",
      agentId: agent.id,
    });
    await setup.createRun({ threadId: thread.id, agentId: agent.id });
    setup.close();
    openStores.splice(openStores.indexOf(setup), 1);

    const firstStore = await createStore(root);
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    const firstClaim = (
      await firstStore.claimAutomaticRecoveries("recoveryworker_chain_one")
    ).claims[0]!;
    const child = await firstStore.createRun({
      threadId: thread.id,
      agentId: agent.id,
      source: "recovery",
      parentRunId: firstClaim.attempt.interruptedRunId,
      triggerId: firstClaim.attempt.triggerId,
      agentRevision: agent.revision,
      executionMode: "safe_read_only_recovery",
      model: agent.model,
    });
    await firstStore.bindAutomaticRecoveryRun(
      firstClaim.attempt.id,
      firstClaim.token,
      child.id,
    );
    await firstStore.appendEvent({
      threadId: thread.id,
      runId: child.id,
      type: "run.started",
      category: "lifecycle",
      visibility: "debug",
      payload: {
        triggerId: firstClaim.attempt.triggerId,
        recoveryAssessmentSha256: firstClaim.assessment.contentSha256,
      },
    });
    firstStore.close();
    openStores.splice(openStores.indexOf(firstStore), 1);

    const secondStore = await createStore(root);
    await new Promise((resolve) => setTimeout(resolve, 2_050));
    const secondSweep = await secondStore.claimAutomaticRecoveries(
      "recoveryworker_chain_two",
    );
    expect(secondSweep.settled).toEqual([
      expect.objectContaining({ status: "interrupted", attempt: 1 }),
    ]);
    expect(secondSweep.claims).toEqual([
      expect.objectContaining({
        attempt: expect.objectContaining({ status: "claimed", attempt: 2 }),
      }),
    ]);

    const bundle = await exportThreadReplayBundle(secondStore, thread.id);
    const imported = await secondStore.importThreadReplayBundle(
      bundle,
      "Imported recovery chain",
    );
    expect(imported.automaticRecoveryAssessments).toHaveLength(2);
    expect(
      imported.automaticRecoveryAttempts.map((attempt) => attempt.status),
    ).toEqual(["interrupted", "abandoned"]);
    const firstImportedAttempt = imported.automaticRecoveryAttempts[0]!;
    const importedStart = imported.events.find(
      (event) =>
        event.runId === firstImportedAttempt.recoveryRunId &&
        event.type === "run.started",
    );
    expect(importedStart?.payload).toEqual(
      expect.objectContaining({
        triggerId: firstImportedAttempt.triggerId,
        recoveryAssessmentSha256:
          imported.automaticRecoveryAssessments[0]!.contentSha256,
      }),
    );
  });

  it("executes with the interrupted revision and a reduced read-only tool surface", async () => {
    const root = await createRoot();
    const setup = await createStore(root);
    const base = setup.listAgents()[0]!;
    const sourceAgent = await setup.updateAgent(base.id, {
      model: { provider: "faux-auto-recovery", id: "faux-1" },
      toolPolicy: "workspace",
      enabledTools: [
        "list_files",
        "read_file",
        "search_files",
        "inspect_data",
        "apply_patch",
        "verify_workspace",
      ],
      enabledSubagents: ["researcher", "reviewer"],
      automaticRecovery: {
        mode: "safe_read_only",
        maxAttempts: 2,
        backoffMs: 1_000,
      },
    });
    const thread = await setup.createThread({
      title: "Snapshot-bound automatic recovery",
      agentId: sourceAgent.id,
    });
    const interrupted = await setup.createRun({
      threadId: thread.id,
      agentId: sourceAgent.id,
    });
    await setup.appendEvent({
      threadId: thread.id,
      runId: interrupted.id,
      type: "message.user",
      category: "message",
      visibility: "user",
      payload: { role: "user", text: "Continue the read-only inspection." },
    });
    setup.close();
    openStores.splice(openStores.indexOf(setup), 1);

    const store = await createStore(root);
    await store.updateAgent(sourceAgent.id, {
      toolPolicy: "unrestricted",
      enabledTools: ["apply_patch", "verify_workspace"],
      enabledSubagents: ["general"],
      automaticRecovery: {
        mode: "manual",
        maxAttempts: 1,
        backoffMs: 10_000,
      },
    });
    const faux = fauxProvider({ provider: "faux-auto-recovery" });
    faux.setResponses([
      (context) => {
        expect(context.tools?.map((tool) => tool.name)).toEqual([
          "list_files",
          "read_file",
          "search_files",
          "inspect_data",
        ]);
        expect(JSON.stringify(context.messages)).toContain(
          "safe read-only recovery attempt",
        );
        return fauxAssistantMessage(
          "Durable evidence was reopened without replaying side effects.",
        );
      },
    ]);
    const registry = new ModelRegistry();
    registry.registerProvider(faux.provider);
    const runtime = new AgentRuntime(store, registry);
    const recovery = new RecoveryService(store, runtime, {
      workerId: "recoveryworker_test",
    });

    await new Promise((resolve) => setTimeout(resolve, 1_050));
    const result = await recovery.sweep();
    const attempts = store.listAutomaticRecoveryAttempts(thread.id);

    expect(attempts[0]).toEqual(
      expect.objectContaining({ status: "completed" }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        claimed: 1,
        completed: 1,
        failed: 0,
      }),
    );
    expect(faux.state.callCount).toBe(1);
    expect(attempts).toEqual([
      expect.objectContaining({
        status: "completed",
        interruptedRunId: interrupted.id,
        attempt: 1,
      }),
    ]);
    const detail = await store.getDetail(thread.id);
    const recovered = detail.runs.find(
      (run) => run.id === attempts[0]!.recoveryRunId,
    )!;
    expect(recovered).toEqual(
      expect.objectContaining({
        source: "recovery",
        parentRunId: interrupted.id,
        agentRevision: sourceAgent.revision,
      }),
    );
    expect(recovered.configuration).toEqual(
      expect.objectContaining({
        schemaVersion: 8,
        executionMode: "safe_read_only_recovery",
        toolPolicy: "observe",
        enabledTools: [
          "inspect_data",
          "list_files",
          "read_file",
          "search_files",
        ],
        enabledSubagents: [],
        skillCatalogSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        promptVariableCatalogSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        promptVariableSnapshotSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        resolvedSystemPromptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        modelAdvisor: {
          mode: "observe",
          enabledRules: [
            "destructive_command_reference",
            "unverified_verification_claim",
          ],
          maxCorrectionAttempts: 0,
        },
      }),
    );
    expect(detail.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "run.recovery.auto.claimed",
        "run.recovery.auto.started",
        "run.recovery.auto.completed",
      ]),
    );
    expect(
      JSON.stringify(
        detail.events.filter((event) =>
          event.type.startsWith("run.recovery.auto."),
        ),
      ),
    ).not.toContain("Continue the read-only inspection.");

    const bundle = await exportThreadReplayBundle(store, thread.id);
    expect(bundle.automaticRecoveryAssessments).toHaveLength(1);
    expect(bundle.automaticRecoveryAttempts).toEqual([
      expect.objectContaining({ status: "completed" }),
    ]);
    const imported = await store.importThreadReplayBundle(
      bundle,
      "Imported recovery evidence",
    );
    expect(imported.automaticRecoveryAssessments).toEqual([
      expect.objectContaining({
        eligible: true,
        threadId: imported.thread.id,
        agentId: imported.agent.id,
      }),
    ]);
    expect(imported.automaticRecoveryAttempts).toEqual([
      expect.objectContaining({
        status: "completed",
        threadId: imported.thread.id,
        agentId: imported.agent.id,
      }),
    ]);
    expect(imported.automaticRecoveryAttempts[0]!.assessmentSha256).toBe(
      imported.automaticRecoveryAssessments[0]!.contentSha256,
    );
  });

  it("fails closed when the interrupted Run Skill catalog drifts before automatic recovery", async () => {
    const root = await createRoot();
    const workspaceRoot = path.join(root, "workspace");
    const skillPath = path.join(
      workspaceRoot,
      "skills/recovery-skill/SKILL.md",
    );
    await mkdir(path.dirname(skillPath), { recursive: true });
    await writeFile(
      skillPath,
      [
        "---",
        "name: recovery-skill",
        "description: Recovery skill fixture.",
        "---",
        "",
        "# Recovery Skill",
        "",
        "Original read-only recovery guidance.",
        "",
      ].join("\n"),
      "utf8",
    );
    const setup = await createStore(root);
    const agent = await setup.updateAgent(setup.listAgents()[0]!.id, {
      model: { provider: "faux-skill-drift", id: "faux-1" },
      enabledSkills: ["recovery-skill"],
      automaticRecovery: {
        mode: "safe_read_only",
        maxAttempts: 2,
        backoffMs: 1_000,
      },
    });
    const originalCatalog = await loadWorkspaceSkills(workspaceRoot, [
      "recovery-skill",
    ]);
    const thread = await setup.createThread({
      title: "Skill drift automatic recovery",
      agentId: agent.id,
    });
    const interrupted = await setup.createRun({
      threadId: thread.id,
      agentId: agent.id,
      skillCatalogSha256: originalCatalog.fingerprint.contentSha256,
    });
    await setup.appendEvent({
      threadId: thread.id,
      runId: interrupted.id,
      type: "message.user",
      category: "message",
      visibility: "user",
      payload: { role: "user", text: "Recover after Skill drift." },
    });
    await setup.finishRun(interrupted.id, "interrupted");
    await writeFile(
      skillPath,
      [
        "---",
        "name: recovery-skill",
        "description: Recovery skill fixture.",
        "---",
        "",
        "# Recovery Skill",
        "",
        "Changed recovery guidance should block automatic recovery.",
        "",
      ].join("\n"),
      "utf8",
    );

    const faux = fauxProvider({ provider: "faux-skill-drift" });
    const registry = new ModelRegistry();
    registry.registerProvider(faux.provider);
    const runtime = new AgentRuntime(setup, registry);
    const recovery = new RecoveryService(setup, runtime, {
      workerId: "recoveryworker_skill_drift",
    });

    await new Promise((resolve) => setTimeout(resolve, 1_050));
    const result = await recovery.sweep();
    const attempts = setup.listAutomaticRecoveryAttempts(thread.id);

    expect(result).toEqual(
      expect.objectContaining({
        claimed: 1,
        completed: 0,
        failed: 1,
      }),
    );
    expect(faux.state.callCount).toBe(0);
    expect(attempts).toEqual([
      expect.objectContaining({
        status: "abandoned",
        error: expect.stringContaining("Skill catalog changed"),
      }),
    ]);
    expect(attempts[0]).not.toHaveProperty("recoveryRunId");
    expect(
      setup.listRuns(thread.id).filter((run) => run.source === "recovery"),
    ).toHaveLength(0);
  });
});

function interruptedRun(): RunRecord {
  return {
    id: "run_interrupted",
    threadId: "thread_recovery",
    agentId: PROFILE.id,
    status: "interrupted",
    source: "user",
    startedAt: "2026-07-25T00:00:00.000Z",
    finishedAt: "2026-07-25T00:00:01.000Z",
    interruptedAt: "2026-07-25T00:00:01.000Z",
    usage: emptyUsage(),
    agentRevision: PROFILE.revision,
    limits: structuredClone(PROFILE.runLimits),
    configuration: createRunConfigurationFingerprint(PROFILE),
  };
}

function event(
  seq: number,
  type: string,
  payload: RunEvent["payload"],
): RunEvent {
  return {
    id: `event_recovery_${seq}`,
    threadId: "thread_recovery",
    runId: "run_interrupted",
    seq,
    type,
    category: "tool",
    visibility: "user",
    createdAt: new Date(
      Date.parse("2026-07-25T00:00:00.000Z") + seq,
    ).toISOString(),
    payload,
  };
}

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-recovery-"));
  temporaryRoots.push(root);
  return root;
}

async function createStore(root: string): Promise<LocalStore> {
  const store = new LocalStore({
    dataRoot: path.join(root, "data"),
    workspaceRoot: path.join(root, "workspace"),
  });
  openStores.push(store);
  await store.initialize();
  return store;
}
