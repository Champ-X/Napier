import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../src/ed25519.js";
import { createPlanTools } from "../src/plan-tools.js";
import { LocalStore } from "../src/store.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("plan tools", () => {
  it("settles plan steps and verifies actual workspace artifact bytes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-plan-tools-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(path.join(workspaceRoot, "artifacts"), { recursive: true });
    const contents = "durable artifact evidence\n";
    await writeFile(
      path.join(workspaceRoot, "artifacts", "report.txt"),
      contents,
      "utf8",
    );
    const store = new LocalStore({
      dataRoot: path.join(root, "data"),
      workspaceRoot,
    });
    await store.initialize();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Plan tools",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    const tools = createPlanTools(store, run);
    const createPlan = tools.find((tool) => tool.name === "create_plan")!;
    const transition = tools.find((tool) => tool.name === "update_plan_step")!;
    const updateArtifact = tools.find(
      (tool) => tool.name === "update_plan_artifact",
    )!;

    const created = await createPlan.execute("create-plan", {
      objective: "Produce and verify the report.",
      steps: [
        {
          id: "write-report",
          title: "Write report",
          description: "Produce the report artifact.",
          verification: "The report file hash is recorded.",
        },
      ],
      artifacts: [
        {
          id: "report",
          path: "artifacts/report.txt",
          description: "Verified report.",
        },
      ],
    });
    const planId = created.details.planId;
    expect(JSON.parse(created.content[0]!.text)).toEqual(
      expect.objectContaining({
        criticalPathStepIds: ["write-report"],
        readyStepIds: ["write-report"],
        blockedStepIds: [],
        activePhaseIndex: 0,
        parallelReadyStepIds: ["write-report"],
        phaseWaveCount: 1,
        phaseProjectionSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );

    await transition.execute("start-step", {
      planId,
      stepId: "write-report",
      action: "start",
    });
    await transition.execute("complete-step", {
      planId,
      stepId: "write-report",
      action: "complete",
      evidence: "The report exists and is ready for byte verification.",
    });
    await updateArtifact.execute("produce-artifact", {
      planId,
      artifactId: "report",
      action: "produced",
      evidence: "The runtime observed the report file.",
    });
    await updateArtifact.execute("verify-artifact", {
      planId,
      artifactId: "report",
      action: "verify",
      evidence: "The runtime hashed the report bytes.",
    });

    const plan = store.getPlan(planId);
    expect(plan.status).toBe("completed");
    expect(plan.steps[0]).toEqual(
      expect.objectContaining({
        status: "completed",
        runId: run.id,
      }),
    );
    expect(plan.artifacts[0]).toEqual(
      expect.objectContaining({
        status: "verified",
        sha256: createHash("sha256").update(contents).digest("hex"),
        sizeBytes: Buffer.byteLength(contents),
        sourceRunId: run.id,
      }),
    );
    expect(
      (await store.listEvents(thread.id)).map((event) => event.type),
    ).toEqual([
      "plan.created",
      "plan.step.started",
      "plan.step.completed",
      "plan.artifact.produced",
      "plan.artifact.verified",
    ]);
    const events = await store.listEvents(thread.id);
    expect(events[0]?.payload).toEqual(
      expect.objectContaining({
        criticalPathStepIds: ["write-report"],
        readyStepIds: ["write-report"],
        blockedStepIds: [],
        activePhaseIndex: 0,
        parallelReadyStepIds: ["write-report"],
        phaseWaveCount: 1,
        phaseProjectionSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(events.at(-1)?.payload).toEqual(
      expect.objectContaining({
        criticalPathStepIds: [],
        readyStepIds: [],
        blockedStepIds: [],
        activePhaseIndex: null,
        parallelReadyStepIds: [],
        phaseWaveCount: 1,
        phaseProjectionSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it("replans stale plan steps through the Agent tool surface", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-plan-tools-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
    const store = new LocalStore({
      dataRoot: path.join(root, "data"),
      workspaceRoot,
    });
    await store.initialize();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Replan tools",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    const tools = createPlanTools(store, run);
    const createPlan = tools.find((tool) => tool.name === "create_plan")!;
    const transition = tools.find((tool) => tool.name === "update_plan_step")!;
    const replan = tools.find((tool) => tool.name === "replan_plan")!;

    const created = await createPlan.execute("create-plan", {
      objective: "Recover a blocked implementation plan.",
      steps: [
        {
          id: "inspect",
          title: "Inspect",
          description: "Inspect the current state.",
          verification: "Inspection evidence is recorded.",
        },
        {
          id: "implement",
          title: "Implement",
          description: "Implement the original path.",
          verification: "The original path builds.",
          dependsOn: ["inspect"],
        },
        {
          id: "verify",
          title: "Verify",
          description: "Verify the final path.",
          verification: "Verification evidence is recorded.",
          dependsOn: ["implement"],
        },
      ],
    });
    const planId = created.details.planId;
    await transition.execute("start-inspect", {
      planId,
      stepId: "inspect",
      action: "start",
    });
    await transition.execute("complete-inspect", {
      planId,
      stepId: "inspect",
      action: "complete",
      evidence: "Inspection completed.",
    });
    const blockedResult = await transition.execute("block-implement", {
      planId,
      stepId: "implement",
      action: "block",
      blocker: "The original route is blocked.",
      evidence: "The blocker is concrete.",
    });
    expect(JSON.parse(blockedResult.content[0]!.text)).toEqual(
      expect.objectContaining({
        replanRecommendation: expect.objectContaining({
          strategy: "recover_blocked",
          supersedeStepIds: ["implement"],
          draft: expect.objectContaining({
            policyId: "napier.plan-replan-draft.v1",
            draftSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            evaluation: expect.objectContaining({
              score: 100,
              risk: "low",
              evaluationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            }),
            request: expect.objectContaining({
              addSteps: [expect.objectContaining({ id: "recover-implement" })],
            }),
          }),
          policyTemplate: expect.objectContaining({
            id: "napier.replan.policy.conservative.v1",
            model: { provider: "napier", id: "demo" },
            posture: "conservative",
            templateSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
          recommendationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
    const blocked = store.getPlan(planId);
    const replanned = await replan.execute("replan", {
      planId,
      expectedRevision: blocked.revision,
      strategy: "recover_blocked",
      reason: "The original route is blocked.",
      evidence: "A replacement implementation step is required.",
      supersedeStepIds: ["implement"],
      dependencyUpdates: [{ stepId: "verify", dependsOn: ["implement-alt"] }],
      addSteps: [
        {
          id: "implement-alt",
          title: "Implement alternate",
          description: "Implement the alternate path.",
          verification: "The alternate path builds.",
          dependsOn: ["inspect"],
        },
      ],
    });

    expect(JSON.parse(replanned.content[0]!.text)).toEqual(
      expect.objectContaining({
        replanCount: 1,
        criticalPathStepIds: ["implement-alt", "verify"],
        readyStepIds: ["implement-alt"],
        activePhaseIndex: 1,
        parallelReadyStepIds: ["implement-alt"],
        phaseProjectionSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(replanned.details).toEqual(
      expect.objectContaining({
        planId,
        revision: blocked.revision + 1,
      }),
    );
    const plan = store.getPlan(planId);
    expect(plan.replans[0]).toEqual(
      expect.objectContaining({
        strategy: "recover_blocked",
        addedStepIds: ["implement-alt"],
        dependencyUpdatedStepIds: ["verify"],
        replanSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(
      (await store.listEvents(thread.id)).map((event) => event.type),
    ).toEqual([
      "plan.created",
      "plan.step.started",
      "plan.step.completed",
      "plan.step.blocked",
      "plan.replanned",
    ]);
    expect((await store.listEvents(thread.id)).at(-1)?.payload).toEqual(
      expect.objectContaining({
        addedStepIds: ["implement-alt"],
        dependencyUpdatedStepIds: ["verify"],
        criticalPathStepIds: ["implement-alt", "verify"],
        activePhaseIndex: 1,
        parallelReadyStepIds: ["implement-alt"],
        phaseProjectionSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it("verifies directory artifacts with a stable manifest digest", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-plan-tools-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(path.join(workspaceRoot, "bundle", "nested"), {
      recursive: true,
    });
    const alpha = "alpha evidence\n";
    const beta = "nested beta evidence\n";
    await writeFile(path.join(workspaceRoot, "bundle", "alpha.txt"), alpha);
    await writeFile(
      path.join(workspaceRoot, "bundle", "nested", "beta.txt"),
      beta,
    );
    const store = new LocalStore({
      dataRoot: path.join(root, "data"),
      workspaceRoot,
    });
    await store.initialize();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Directory artifact",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    const [createPlan, , updateArtifact] = createPlanTools(store, run);
    const created = await createPlan!.execute("create-plan", {
      objective: "Verify a generated bundle.",
      steps: [
        {
          id: "bundle",
          title: "Bundle",
          description: "Produce the bundle directory.",
          verification: "The directory manifest digest is recorded.",
        },
      ],
      artifacts: [
        {
          id: "bundle-dir",
          path: "bundle",
          kind: "directory",
          description: "Generated bundle directory.",
        },
      ],
    });
    const planId = created.details.planId;

    await updateArtifact!.execute("produce-directory", {
      planId,
      artifactId: "bundle-dir",
      action: "produced",
      evidence: "The runtime observed the bundle directory.",
    });
    await updateArtifact.execute("verify-directory", {
      planId,
      artifactId: "bundle-dir",
      action: "verify",
      evidence: "The runtime hashed the directory manifest.",
    });

    const expectedDigest = sha256(
      canonicalJson({
        kind: "napier.plan-directory-digest",
        schemaVersion: 1,
        entries: [
          { kind: "directory", path: "." },
          {
            kind: "file",
            path: "alpha.txt",
            sha256: sha256(Buffer.from(alpha)),
            sizeBytes: Buffer.byteLength(alpha),
          },
          { kind: "directory", path: "nested" },
          {
            kind: "file",
            path: "nested/beta.txt",
            sha256: sha256(Buffer.from(beta)),
            sizeBytes: Buffer.byteLength(beta),
          },
        ],
      }),
    );
    const plan = store.getPlan(planId);
    expect(plan.artifacts[0]).toEqual(
      expect.objectContaining({
        status: "verified",
        sha256: expectedDigest,
        sizeBytes: Buffer.byteLength(alpha) + Buffer.byteLength(beta),
        sourceRunId: run.id,
      }),
    );
    expect((await store.listEvents(thread.id)).at(-1)?.payload).toEqual(
      expect.objectContaining({
        artifactId: "bundle-dir",
        status: "verified",
        sha256: expectedDigest,
        sizeBytes: Buffer.byteLength(alpha) + Buffer.byteLength(beta),
      }),
    );
  });

  it("rejects symlink-backed artifacts before hashing workspace bytes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-plan-tools-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
    const outsidePath = path.join(root, "outside-secret.txt");
    await writeFile(outsidePath, "outside workspace", "utf8");
    await symlink(outsidePath, path.join(workspaceRoot, "linked.txt"));
    const store = new LocalStore({
      dataRoot: path.join(root, "data"),
      workspaceRoot,
    });
    await store.initialize();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Symlink artifact",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    const [createPlan, , updateArtifact] = createPlanTools(store, run);
    const created = await createPlan!.execute("create-plan", {
      objective: "Reject symlink artifact.",
      steps: [
        {
          id: "observe",
          title: "Observe",
          description: "Observe the artifact path.",
          verification: "The runtime refuses symlink evidence.",
        },
      ],
      artifacts: [
        {
          id: "linked",
          path: "linked.txt",
          description: "A symlink-backed artifact.",
        },
      ],
    });

    await expect(
      updateArtifact!.execute("produce-linked", {
        planId: created.details.planId,
        artifactId: "linked",
        action: "produced",
        evidence: "The symlink should not be observed.",
      }),
    ).rejects.toThrow("symbolic links");
    expect(store.getPlan(created.details.planId).artifacts[0]).toEqual(
      expect.objectContaining({ status: "expected" }),
    );
  });

  it("refuses to mark an existing artifact missing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-plan-tools-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(path.join(workspaceRoot, "exists.txt"), "exists", "utf8");
    const store = new LocalStore({
      dataRoot: path.join(root, "data"),
      workspaceRoot,
    });
    await store.initialize();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Missing artifact",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    const [createPlan, , updateArtifact] = createPlanTools(store, run);
    const created = await createPlan!.execute("create-plan", {
      objective: "Check artifact state.",
      steps: [
        {
          id: "check",
          title: "Check",
          description: "Check the artifact.",
          verification: "The artifact state is observed.",
        },
      ],
      artifacts: [
        {
          id: "existing",
          path: "exists.txt",
          description: "Existing file.",
        },
      ],
    });

    await expect(
      updateArtifact!.execute("missing-artifact", {
        planId: created.details.planId,
        artifactId: "existing",
        action: "missing",
        evidence: "Claimed missing.",
      }),
    ).rejects.toThrow("exists and cannot be marked missing");
  });
});
