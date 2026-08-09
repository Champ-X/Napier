import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { LocalStore, sha256 } from "../packages/runtime/dist/index.js";

export async function seedWebUiNarrativeFixture(root) {
  const dataRoot = path.join(root, "state");
  const workspaceRoot = path.join(root, "workspace");
  const store = new LocalStore({ dataRoot, workspaceRoot });
  await store.initialize();
  try {
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
      recovery: {
        threadId: recoveryThread.id,
        title: recoveryThread.title,
        phase: "Recovery blocked",
        currentAction: "Automatic recovery stopped safely",
        completedItem: "Inspect recovery evidence",
        blocker: "2 safety conditions require review.",
        nextStep: "Review the Retry card or resume manually.",
      },
    };
  } finally {
    store.close();
  }
}
