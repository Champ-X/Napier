import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createPlanArtifactEventPayload,
  LocalStore,
  sha256,
} from "../packages/runtime/dist/index.js";
import { BrowserTaskJournal } from "../apps/server/dist/browser-task-journal.js";

export async function seedWebUiNarrativeFixture(root) {
  const dataRoot = path.join(root, "state");
  const workspaceRoot = path.join(root, "workspace");
  const store = new LocalStore({ dataRoot, workspaceRoot });
  await store.initialize();
  try {
    const browserTask = await seedBrowserTaskHistory(dataRoot);
    await store.createCredentialReference({
      providerId: "openai",
      label: "E2E OpenAI reference",
      source: {
        type: "environment",
        variable: "NAPIER_E2E_MODEL_KEY",
      },
    });
    const agent = store.listAgents()[0];
    if (!agent) throw new Error("Web UI E2E Agent fixture is unavailable");
    const thread = await store.createThread({
      title: "Ship verified research brief",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
      model: { provider: "faux-narrative", id: "faux-1" },
    });
    const plan = await store.createPlan(thread.id, {
      objective: "Deliver a verified research brief with operator approval.",
      steps: [
        {
          id: "inspect",
          title: "Inspect source evidence",
          description: "Read and compare the source evidence.",
          verification: "The source evidence is recorded.",
        },
        {
          id: "approve",
          title: "Approve final delivery",
          description: "Wait for the operator to approve final delivery.",
          verification: "The operator decision is recorded.",
          dependsOn: ["inspect"],
        },
        {
          id: "publish",
          title: "Publish final brief",
          description: "Deliver the verified research brief.",
          verification: "The final brief remains available as an Artifact.",
          dependsOn: ["approve"],
        },
      ],
      artifacts: [
        {
          id: "brief",
          path: "artifacts/research-brief.md",
          description: "The verified research brief.",
        },
      ],
    });
    await store.transitionPlanStep(plan.id, "inspect", {
      action: "start",
      runId: run.id,
    });
    await store.transitionPlanStep(plan.id, "inspect", {
      action: "complete",
      evidence: "The source evidence was compared and recorded.",
    });
    await mkdir(path.join(workspaceRoot, "artifacts"), { recursive: true });
    const artifactBytes = Buffer.from("# Verified research brief\n", "utf8");
    await writeFile(
      path.join(workspaceRoot, "artifacts", "research-brief.md"),
      artifactBytes,
    );
    await store.updatePlanArtifact(plan.id, "brief", {
      status: "produced",
      sourceRunId: run.id,
      evidence: "The runtime observed the final brief file.",
    });
    await store.updatePlanArtifact(plan.id, "brief", {
      status: "verified",
      sha256: sha256(artifactBytes),
      sizeBytes: artifactBytes.byteLength,
      sourceRunId: run.id,
      evidence: "The runtime verified the final brief bytes.",
    });
    const decision = await store.requestOperatorDecision({
      threadId: thread.id,
      runId: run.id,
      header: "Approval",
      question: "Should the verified research brief be published?",
      options: [
        {
          label: "Publish",
          description: "Continue to final delivery.",
        },
        {
          label: "Revise",
          description: "Return the brief for another review.",
        },
      ],
      multiSelect: false,
    });
    await store.finishRun(run.id, "completed", {
      waitForOperatorDecisionId: decision.decision.id,
      usage: {
        inputTokens: 1_200,
        outputTokens: 480,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.042,
      },
    });
    const recoveryThread = await store.createThread({
      title: "Recover interrupted verification",
      agentId: agent.id,
    });
    const recoveryRun = await store.createRun({
      threadId: recoveryThread.id,
      agentId: agent.id,
      model: { provider: "faux-recovery", id: "faux-1" },
    });
    const recoveryPlan = await store.createPlan(recoveryThread.id, {
      objective: "Recover an interrupted verification safely.",
      steps: [
        {
          id: "inspect",
          title: "Inspect recovery evidence",
          description: "Inspect the durable evidence before recovery.",
          verification: "The durable evidence is recorded.",
        },
        {
          id: "verify",
          title: "Verify recovered result",
          description: "Verify the interrupted result before delivery.",
          verification: "The recovered result passes verification.",
          dependsOn: ["inspect"],
        },
      ],
    });
    await store.transitionPlanStep(recoveryPlan.id, "inspect", {
      action: "start",
      runId: recoveryRun.id,
    });
    await store.transitionPlanStep(recoveryPlan.id, "inspect", {
      action: "complete",
      evidence: "Durable evidence was inspected.",
    });
    await store.transitionPlanStep(recoveryPlan.id, "verify", {
      action: "start",
      runId: recoveryRun.id,
    });
    await store.appendEvent({
      threadId: recoveryThread.id,
      runId: recoveryRun.id,
      type: "tool.started",
      category: "tool",
      visibility: "user",
      payload: {
        callId: "call_recovery_write",
        toolName: "apply_patch",
        status: "started",
        effect: "write",
      },
    });
    await store.appendEvent({
      threadId: recoveryThread.id,
      runId: recoveryRun.id,
      type: "tool.completed",
      category: "tool",
      visibility: "user",
      payload: {
        callId: "call_recovery_write",
        toolName: "apply_patch",
        status: "completed",
        effect: "write",
      },
    });
    const longRunThread = await store.createThread({
      title: "Synthesize long-running evidence",
      agentId: agent.id,
    });
    const longRun = await store.createRun({
      threadId: longRunThread.id,
      agentId: agent.id,
      model: { provider: "faux-long-run", id: "faux-1" },
    });
    await appendCompletedToolCalls(store, longRunThread.id, longRun.id, [
      ["read_file", 12],
      ["web_search", 5],
      ["browser", 3],
    ]);
    await store.finishRun(longRun.id, "completed", {
      usage: {
        inputTokens: 18_000,
        outputTokens: 3_200,
        cacheReadTokens: 4_000,
        cacheWriteTokens: 0,
        costUsd: 0.31,
      },
    });
    const artifactThread = await store.createThread({
      title: "Review multiple task outputs",
      agentId: agent.id,
    });
    const artifactRun = await store.createRun({
      threadId: artifactThread.id,
      agentId: agent.id,
      model: { provider: "faux-artifacts", id: "faux-1" },
    });
    const artifactPlan = await store.createPlan(artifactThread.id, {
      objective: "Deliver two independently reviewable outputs.",
      steps: [
        {
          id: "deliver",
          title: "Deliver task outputs",
          description: "Produce and verify the report and source notes.",
          verification: "Both output files are verified.",
        },
      ],
      artifacts: [
        {
          id: "report",
          path: "artifacts/output-report.md",
          description: "Final output report.",
        },
        {
          id: "notes",
          path: "artifacts/source-notes.md",
          description: "Supporting source notes.",
        },
      ],
    });
    await store.transitionPlanStep(artifactPlan.id, "deliver", {
      action: "start",
      runId: artifactRun.id,
    });
    await store.transitionPlanStep(artifactPlan.id, "deliver", {
      action: "complete",
      evidence: "Both outputs were produced for review.",
    });
    const artifactFiles = [
      [
        "report",
        "artifacts/output-report.md",
        "# Output report\nVerified delivery.\n",
      ],
      [
        "notes",
        "artifacts/source-notes.md",
        "# Source notes\nEvidence index.\n",
      ],
    ];
    for (const [artifactId, artifactPath, text] of artifactFiles) {
      const bytes = Buffer.from(text, "utf8");
      await writeFile(path.join(workspaceRoot, artifactPath), bytes);
      await store.updatePlanArtifact(artifactPlan.id, artifactId, {
        status: "produced",
        sourceRunId: artifactRun.id,
        evidence: "The runtime observed the output file.",
      });
      const verifiedPlan = await store.updatePlanArtifact(
        artifactPlan.id,
        artifactId,
        {
          status: "verified",
          sha256: sha256(bytes),
          sizeBytes: bytes.byteLength,
          sourceRunId: artifactRun.id,
          evidence: "The runtime verified the output bytes.",
        },
      );
      const verifiedArtifact = verifiedPlan.artifacts.find(
        (artifact) => artifact.id === artifactId,
      );
      if (!verifiedArtifact)
        throw new Error("Verified Artifact is unavailable");
      await store.appendEvent({
        threadId: artifactThread.id,
        runId: artifactRun.id,
        type: "plan.artifact.verified",
        category: "plan",
        visibility: "user",
        payload: createPlanArtifactEventPayload(verifiedPlan, verifiedArtifact),
      });
    }
    await store.finishRun(artifactRun.id, "completed", {
      usage: {
        inputTokens: 2_000,
        outputTokens: 600,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.02,
      },
    });
    await store.setThreadStatus(thread.id, "waiting");
    return {
      threadId: thread.id,
      title: thread.title,
      phase: "Waiting",
      currentAction: "Approval",
      completedItem: "Inspect source evidence",
      blocker: "Operator input is required before the run can continue.",
      nextStep: "Approve final delivery",
      artifactPath: "artifacts/research-brief.md",
      browserTask,
      recovery: {
        threadId: recoveryThread.id,
        title: recoveryThread.title,
        phase: "Recovery blocked",
        currentAction: "Automatic recovery stopped safely",
        completedItem: "Inspect recovery evidence",
        blocker: "2 safety conditions require review.",
        nextStep: "Review the Retry card or resume manually.",
      },
      longRun: {
        threadId: longRunThread.id,
        title: longRunThread.title,
        phase: "Settled",
        currentAction: "Latest run completed",
        completedItem:
          "Read 12 files · Searched the web 5 times · Completed 3 browser steps",
        blocker: "",
        nextStep: "Start a follow-up task or inspect the evidence.",
        artifactPath: "",
      },
      artifactNavigation: {
        threadId: artifactThread.id,
        title: artifactThread.title,
        paths: artifactFiles.map(([, artifactPath]) => artifactPath),
      },
    };
  } finally {
    store.close();
  }
}

async function seedBrowserTaskHistory(dataRoot) {
  const taskId = "browser_task_0123456789abcdef0123456789abcdef";
  const backend = "browser_use_local";
  const error = {
    type: "error",
    backend,
    code: "server_restarted",
    message: "Browser task stopped when the Napier server restarted",
    diagnosticSha256: sha256(`${backend}_server_restarted`),
    recovery: "Retry the same task to start a fresh browser session",
  };
  await new BrowserTaskJournal(dataRoot).save({
    taskId,
    backend,
    status: "running",
    createdAt: Date.now(),
    input: {
      backend,
      task: "Summarize the public Example Domain page",
      startUrl: "https://example.com/",
      model: { provider: "openai", id: "gpt-4.1-mini" },
      credentialEnv: "",
      allowedDomains: ["example.com"],
      maxSteps: 5,
      maxCostUsd: 1,
    },
    events: [
      {
        type: "started",
        backend,
        model: "openai/gpt-4.1-mini",
        allowedDomainCount: 1,
        costStatus: "unknown",
        interactionPolicy: "public_read_only",
        startUrl: "https://example.com/",
        pauseAvailable: true,
        takeoverAvailable: true,
        browserVisibility: "visible",
        browserProduct: "system_chrome",
        browserVersion: "fixture",
        pauseMode: "immediate_agent_process",
        challengeMode: "automatic_takeover_pause",
        cancelMode: "terminate_process_group",
      },
      {
        type: "step",
        backend,
        step: 1,
        url: "https://example.com/",
        title: "Example Domain",
        actionNames: ["extract_content"],
        screenshotSha256: "a".repeat(64),
      },
    ],
  });
  return {
    taskId,
    status: "restored history · terminal",
    step: "Step 1extract_contenthttps://example.com/",
    recovery: `${error.message}${error.recovery}`,
  };
}

async function appendCompletedToolCalls(store, threadId, runId, groups) {
  let index = 0;
  for (const [toolName, count] of groups) {
    for (let occurrence = 0; occurrence < count; occurrence += 1) {
      index += 1;
      const callId = `call_long_${String(index)}`;
      for (const state of ["started", "completed"]) {
        await store.appendEvent({
          threadId,
          runId,
          type: `tool.${state}`,
          category: "tool",
          visibility: "user",
          payload: { callId, toolName, status: state, effect: "read" },
        });
      }
    }
  }
}
