import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../src/ed25519.js";
import {
  createPlanTools,
  exportWorkspaceFileArtifact,
  inspectWorkspaceArtifactDrift,
  previewWorkspaceDataArtifactProfile,
  previewWorkspaceDirectoryArtifactManifest,
  previewWorkspaceTextArtifact,
} from "../src/plan-tools.js";
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
    await updateArtifact.execute("reverify-artifact", {
      planId,
      artifactId: "report",
      action: "verify",
      evidence: "The runtime rechecked the report bytes.",
    });
    await writeFile(
      path.join(workspaceRoot, "artifacts", "report.txt"),
      "drifted durable artifact evidence\n",
      "utf8",
    );
    await expect(
      updateArtifact.execute("drifted-artifact", {
        planId,
        artifactId: "report",
        action: "verify",
        evidence: "The runtime rechecked the report bytes after drift.",
      }),
    ).rejects.toThrow("Verified artifact digest drifted");
    await updateArtifact.execute("confirm-drifted-artifact", {
      planId,
      artifactId: "report",
      action: "missing",
      evidence: "The runtime confirmed the verified artifact bytes drifted.",
    });

    const plan = store.getPlan(planId);
    expect(plan.status).toBe("blocked");
    expect(plan.replanRecommendation).toEqual(
      expect.objectContaining({
        strategy: "artifact_drift",
        supersedeArtifactIds: ["report"],
        affectedArtifactIds: ["report"],
      }),
    );
    expect(plan.steps[0]).toEqual(
      expect.objectContaining({
        status: "completed",
        runId: run.id,
      }),
    );
    expect(plan.artifacts[0]).toEqual(
      expect.objectContaining({
        status: "missing",
        sha256: createHash("sha256").update(contents).digest("hex"),
        sizeBytes: Buffer.byteLength(contents),
        sourceRunId: run.id,
        evidence: "The runtime confirmed the verified artifact bytes drifted.",
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
      "plan.artifact.verified",
      "plan.artifact.missing",
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

  it("exports only bounded workspace file artifacts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-plan-tools-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(path.join(workspaceRoot, "artifacts"), { recursive: true });
    const contents = "downloadable artifact\n";
    await writeFile(
      path.join(workspaceRoot, "artifacts", "report.txt"),
      contents,
      "utf8",
    );
    const produced = await exportWorkspaceFileArtifact(workspaceRoot, {
      id: "report",
      path: "artifacts/report.txt",
      kind: "file",
      description: "Report file.",
      status: "produced",
      evidence: "The file was produced.",
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: "2026-07-27T00:00:00.000Z",
    });
    expect(produced).toEqual({
      contents: Buffer.from(contents),
      sha256: createHash("sha256").update(contents).digest("hex"),
      sizeBytes: Buffer.byteLength(contents),
    });

    await expect(
      exportWorkspaceFileArtifact(workspaceRoot, {
        id: "bundle",
        path: "artifacts",
        kind: "directory",
        description: "Directory bundle.",
        status: "produced",
        evidence: "The directory was produced.",
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z",
      }),
    ).rejects.toThrow("Only file artifacts can be exported");

    await expect(
      exportWorkspaceFileArtifact(workspaceRoot, {
        id: "draft",
        path: "artifacts/report.txt",
        kind: "file",
        description: "Draft file.",
        status: "expected",
        evidence: "",
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z",
      }),
    ).rejects.toThrow("Only produced or verified artifacts can be exported");

    await writeFile(
      path.join(workspaceRoot, "artifacts", "report.txt"),
      "drifted artifact\n",
      "utf8",
    );
    await expect(
      exportWorkspaceFileArtifact(workspaceRoot, {
        id: "report",
        path: "artifacts/report.txt",
        kind: "file",
        description: "Verified report file.",
        status: "verified",
        evidence: "The file was verified.",
        sha256: createHash("sha256").update(contents).digest("hex"),
        sizeBytes: Buffer.byteLength(contents),
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z",
      }),
    ).rejects.toThrow("Verified artifact digest drifted");
  });

  it("previews only small valid UTF-8 workspace file artifacts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-plan-tools-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(path.join(workspaceRoot, "artifacts"), { recursive: true });
    const contents = "line one\nline two\n";
    await writeFile(
      path.join(workspaceRoot, "artifacts", "preview.txt"),
      contents,
      "utf8",
    );
    const preview = await previewWorkspaceTextArtifact(workspaceRoot, {
      id: "preview",
      path: "artifacts/preview.txt",
      kind: "file",
      description: "Preview file.",
      status: "produced",
      evidence: "The file was produced.",
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: "2026-07-27T00:00:00.000Z",
    });
    expect(preview).toEqual({
      text: contents,
      sha256: createHash("sha256").update(contents).digest("hex"),
      sizeBytes: Buffer.byteLength(contents),
      lineCount: 3,
    });

    await writeFile(
      path.join(workspaceRoot, "artifacts", "binary.bin"),
      Buffer.from([0xff, 0xfe, 0xfd]),
    );
    await expect(
      previewWorkspaceTextArtifact(workspaceRoot, {
        id: "binary",
        path: "artifacts/binary.bin",
        kind: "file",
        description: "Binary file.",
        status: "produced",
        evidence: "The binary file was produced.",
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z",
      }),
    ).rejects.toThrow("valid UTF-8 text");

    const largeContents = "x".repeat(64 * 1024 + 1);
    await writeFile(
      path.join(workspaceRoot, "artifacts", "large.txt"),
      largeContents,
      "utf8",
    );
    await expect(
      previewWorkspaceTextArtifact(workspaceRoot, {
        id: "large",
        path: "artifacts/large.txt",
        kind: "file",
        description: "Large file.",
        status: "produced",
        evidence: "The large file was produced.",
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z",
      }),
    ).rejects.toThrow("Artifact preview exceeds");

    await writeFile(
      path.join(workspaceRoot, "artifacts", "preview.txt"),
      "drifted\n",
      "utf8",
    );
    await expect(
      previewWorkspaceTextArtifact(workspaceRoot, {
        id: "preview",
        path: "artifacts/preview.txt",
        kind: "file",
        description: "Verified preview file.",
        status: "verified",
        evidence: "The file was verified.",
        sha256: createHash("sha256").update(contents).digest("hex"),
        sizeBytes: Buffer.byteLength(contents),
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z",
      }),
    ).rejects.toThrow("Verified artifact digest drifted");
  });

  it("profiles structured workspace file artifacts without trusting drifted bytes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-plan-tools-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(path.join(workspaceRoot, "artifacts"), { recursive: true });
    const contents = "name,score\nalpha,1\nbeta,2\n";
    await writeFile(
      path.join(workspaceRoot, "artifacts", "scores.csv"),
      contents,
      "utf8",
    );
    const artifact = {
      id: "scores",
      path: "artifacts/scores.csv",
      kind: "file" as const,
      description: "Score data.",
      status: "produced" as const,
      evidence: "The score data was produced.",
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: "2026-07-27T00:00:00.000Z",
    };

    await expect(
      previewWorkspaceDataArtifactProfile(workspaceRoot, artifact),
    ).resolves.toEqual({
      format: "csv",
      sha256: createHash("sha256").update(contents).digest("hex"),
      sizeBytes: Buffer.byteLength(contents),
      rowCount: 2,
      columnCount: 2,
      columns: ["name", "score"],
      sampleRows: [
        { name: "alpha", score: "1" },
        { name: "beta", score: "2" },
      ],
      truncated: false,
      columnSetSha256: sha256(canonicalJson(["name", "score"])),
      sampleSha256: sha256(
        canonicalJson([
          { name: "alpha", score: "1" },
          { name: "beta", score: "2" },
        ]),
      ),
    });

    const tsvContents = "name\tscore\nalpha\t1\nbeta\t2\n";
    await writeFile(
      path.join(workspaceRoot, "artifacts", "scores.tsv"),
      tsvContents,
      "utf8",
    );
    await expect(
      previewWorkspaceDataArtifactProfile(workspaceRoot, {
        ...artifact,
        id: "scores-tsv",
        path: "artifacts/scores.tsv",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        format: "tsv",
        sha256: createHash("sha256").update(tsvContents).digest("hex"),
        sizeBytes: Buffer.byteLength(tsvContents),
        rowCount: 2,
        columnCount: 2,
        columns: ["name", "score"],
        sampleRows: [
          { name: "alpha", score: "1" },
          { name: "beta", score: "2" },
        ],
      }),
    );

    const matrixContents = JSON.stringify([
      ["alpha", 1],
      ["beta", 2, false],
    ]);
    await writeFile(
      path.join(workspaceRoot, "artifacts", "matrix.json"),
      matrixContents,
      "utf8",
    );
    await expect(
      previewWorkspaceDataArtifactProfile(workspaceRoot, {
        ...artifact,
        id: "matrix",
        path: "artifacts/matrix.json",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        format: "json",
        sha256: createHash("sha256").update(matrixContents).digest("hex"),
        sizeBytes: Buffer.byteLength(matrixContents),
        rowCount: 2,
        columnCount: 3,
        columns: ["column_1", "column_2", "column_3"],
        sampleRows: [
          { column_1: "alpha", column_2: 1, column_3: "" },
          { column_1: "beta", column_2: 2, column_3: false },
        ],
      }),
    );

    const markdownContents = [
      "# Scores",
      "",
      "| name | score |",
      "| --- | ---: |",
      "| alpha | 1 |",
      "| beta | 2 |",
    ].join("\n");
    await writeFile(
      path.join(workspaceRoot, "artifacts", "scores.md"),
      markdownContents,
      "utf8",
    );
    await expect(
      previewWorkspaceDataArtifactProfile(workspaceRoot, {
        ...artifact,
        id: "scores-md",
        path: "artifacts/scores.md",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        format: "markdown_table",
        sha256: createHash("sha256").update(markdownContents).digest("hex"),
        sizeBytes: Buffer.byteLength(markdownContents),
        rowCount: 2,
        columnCount: 2,
        columns: ["name", "score"],
        sampleRows: [
          { name: "alpha", score: "1" },
          { name: "beta", score: "2" },
        ],
      }),
    );

    const duplicateMarkdownContents = [
      "| name | name | |",
      "| --- | --- | --- |",
      "| alpha | beta | 3 |",
    ].join("\n");
    await writeFile(
      path.join(workspaceRoot, "artifacts", "duplicate.md"),
      duplicateMarkdownContents,
      "utf8",
    );
    await expect(
      previewWorkspaceDataArtifactProfile(workspaceRoot, {
        ...artifact,
        id: "duplicate-md",
        path: "artifacts/duplicate.md",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        format: "markdown_table",
        sha256: createHash("sha256")
          .update(duplicateMarkdownContents)
          .digest("hex"),
        sizeBytes: Buffer.byteLength(duplicateMarkdownContents),
        rowCount: 1,
        columnCount: 3,
        columns: ["name", "name_2", "column_3"],
        sampleRows: [{ name: "alpha", name_2: "beta", column_3: "3" }],
        columnSetSha256: sha256(canonicalJson(["name", "name_2", "column_3"])),
        sampleSha256: sha256(
          canonicalJson([{ name: "alpha", name_2: "beta", column_3: "3" }]),
        ),
      }),
    );

    const envelopeContents = JSON.stringify({
      columns: ["name", "score", "active"],
      data: [
        ["alpha", 1, true],
        ["beta", 2],
      ],
    });
    await writeFile(
      path.join(workspaceRoot, "artifacts", "envelope.json"),
      envelopeContents,
      "utf8",
    );
    await expect(
      previewWorkspaceDataArtifactProfile(workspaceRoot, {
        ...artifact,
        id: "envelope",
        path: "artifacts/envelope.json",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        format: "json",
        sha256: createHash("sha256").update(envelopeContents).digest("hex"),
        sizeBytes: Buffer.byteLength(envelopeContents),
        rowCount: 2,
        columnCount: 3,
        columns: ["name", "score", "active"],
        sampleRows: [
          { name: "alpha", score: 1, active: true },
          { name: "beta", score: 2, active: "" },
        ],
      }),
    );

    await writeFile(
      path.join(workspaceRoot, "artifacts", "scores.csv"),
      "name,score\ndrifted,9\n",
      "utf8",
    );
    await expect(
      previewWorkspaceDataArtifactProfile(workspaceRoot, {
        ...artifact,
        status: "verified" as const,
        sha256: createHash("sha256").update(contents).digest("hex"),
        sizeBytes: Buffer.byteLength(contents),
      }),
    ).rejects.toThrow("Verified artifact digest drifted");
  });

  it("checks verified workspace artifact drift without mutating state", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-plan-tools-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(path.join(workspaceRoot, "artifacts"), { recursive: true });
    const contents = "stable artifact\n";
    const artifactPath = path.join(workspaceRoot, "artifacts", "report.txt");
    await writeFile(artifactPath, contents, "utf8");
    const sha256 = createHash("sha256").update(contents).digest("hex");
    const artifact = {
      id: "report",
      path: "artifacts/report.txt",
      kind: "file" as const,
      description: "Verified report file.",
      status: "verified" as const,
      evidence: "The file was verified.",
      sha256,
      sizeBytes: Buffer.byteLength(contents),
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: "2026-07-27T00:00:00.000Z",
    };

    await expect(
      inspectWorkspaceArtifactDrift(workspaceRoot, artifact),
    ).resolves.toEqual({
      result: "current",
      expectedSha256: sha256,
      observedSha256: sha256,
      sizeBytes: Buffer.byteLength(contents),
    });

    const driftedContents = "drifted artifact\n";
    await writeFile(artifactPath, driftedContents, "utf8");
    await expect(
      inspectWorkspaceArtifactDrift(workspaceRoot, artifact),
    ).resolves.toEqual({
      result: "drifted",
      expectedSha256: sha256,
      observedSha256: createHash("sha256")
        .update(driftedContents)
        .digest("hex"),
      sizeBytes: Buffer.byteLength(driftedContents),
    });

    await rm(artifactPath);
    await expect(
      inspectWorkspaceArtifactDrift(workspaceRoot, artifact),
    ).resolves.toEqual({
      result: "missing",
      expectedSha256: sha256,
    });

    await expect(
      inspectWorkspaceArtifactDrift(workspaceRoot, {
        ...artifact,
        status: "produced",
      }),
    ).rejects.toThrow("Only verified artifacts can be drift-checked");
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
    await expect(
      previewWorkspaceDirectoryArtifactManifest(
        workspaceRoot,
        plan.artifacts[0]!,
      ),
    ).resolves.toEqual({
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
      sha256: expectedDigest,
      sizeBytes: Buffer.byteLength(alpha) + Buffer.byteLength(beta),
      entryCount: 4,
      fileCount: 2,
      directoryCount: 2,
    });
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
