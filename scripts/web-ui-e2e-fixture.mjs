import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  canonicalJson,
  createPlanArtifactEventPayload,
  LocalStore,
  sha256,
} from "../packages/runtime/dist/index.js";
import { BrowserTaskJournal } from "../apps/server/dist/browser-task-journal.js";
import { seedWebUiCasebook } from "./web-ui-e2e-casebook.mjs";

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
    const emptyThread = await store.createThread({
      title: "Start a new desktop task",
      agentId: agent.id,
    });
    const thread = await store.createThread({
      title: "Ship verified research brief",
      agentId: agent.id,
    });
    const casebook = await seedWebUiCasebook(store, thread, agent);
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
      model: { provider: "faux-narrative", id: "faux-1" },
    });
    await appendConversationMessages(store, thread.id, run.id, [
      ["user", "Prepare and verify the research brief."],
      ["assistant", "The brief is ready for final approval."],
    ]);
    await appendModelHarnessResolution(
      store,
      thread.id,
      run.id,
      "faux-narrative",
    );
    await appendToolResultContextPruning(store, thread.id, run.id);
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
    const runningThread = await store.createThread({
      title: "Run active browser verification",
      agentId: agent.id,
    });
    const { run: runningRun } = await store.createLeasedRun(
      {
        threadId: runningThread.id,
        agentId: agent.id,
        model: { provider: "faux-running", id: "faux-1" },
      },
      {
        ownerId: `process:${String(process.pid)}:web_ui_e2e`,
        ttlMs: 10 * 60_000,
      },
    );
    const runningPlan = await store.createPlan(runningThread.id, {
      objective: "Verify the active browser result.",
      steps: [
        {
          id: "browse",
          title: "Inspect active browser",
          description: "Review the current browser session.",
          verification: "The browser result is recorded.",
        },
      ],
    });
    await store.transitionPlanStep(runningPlan.id, "browse", {
      action: "start",
      runId: runningRun.id,
    });
    await appendConversationMessages(store, runningThread.id, runningRun.id, [
      ["user", "Verify the active browser result."],
    ]);
    await store.appendEvent({
      threadId: runningThread.id,
      runId: runningRun.id,
      type: "tool.completed",
      category: "tool",
      visibility: "user",
      payload: {
        callId: "call_running_browser",
        toolName: "browser",
        status: "completed",
        effect: "read",
        details: { action: "open" },
      },
    });
    const longRunThread = await store.createThread({
      title: "Synthesize long-running evidence",
      agentId: agent.id,
    });
    const priorLongRun = await store.createRun({
      threadId: longRunThread.id,
      agentId: agent.id,
      model: { provider: "faux-long-run", id: "faux-1" },
    });
    await appendConversationMessages(store, longRunThread.id, priorLongRun.id, [
      ["user", "Establish the first evidence checkpoint."],
      ["assistant", "The first evidence checkpoint is recorded."],
    ]);
    await store.finishRun(priorLongRun.id, "completed");
    const longRun = await store.createRun({
      threadId: longRunThread.id,
      agentId: agent.id,
      model: { provider: "faux-long-run", id: "faux-1" },
    });
    await appendConversationMessages(
      store,
      longRunThread.id,
      longRun.id,
      Array.from({ length: 170 }, (_, index) => [
        index % 2 === 0 ? "user" : "assistant",
        `Long conversation checkpoint ${String(index + 1).padStart(3, "0")}`,
      ]),
    );
    await appendCompletedToolCalls(store, longRunThread.id, longRun.id, [
      ["read_file", 12],
      ["web_search", 5],
      ["browser", 3],
    ]);
    await appendModelHarnessResolution(
      store,
      longRunThread.id,
      longRun.id,
      "faux-long-run",
    );
    await appendToolResultContextPruning(store, longRunThread.id, longRun.id);
    await appendEnvironmentDegradation(store, longRunThread.id, longRun.id);
    await appendContextContinuityCheckpoint(store, longRunThread.id, longRun.id);
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
      empty: {
        threadId: emptyThread.id,
        title: emptyThread.title,
      },
      threadId: thread.id,
      title: thread.title,
      phase: "Waiting",
      currentAction: "Approval",
      completedItem: "Inspect source evidence",
      blocker: "Operator input is required before the run can continue.",
      nextStep: "Approve final delivery",
      harness: "Generic · Focused · 18 / 42 tools",
      artifactPath: "artifacts/research-brief.md",
      latestTerminalRunId: run.id,
      browserTask,
      casebook,
      running: {
        threadId: runningThread.id,
        runId: runningRun.id,
        title: runningThread.title,
      },
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

async function appendConversationMessages(store, threadId, runId, messages) {
  for (const [role, text] of messages) {
    await store.appendEvent({
      threadId,
      runId,
      type: `message.${role}`,
      category: "message",
      visibility: "user",
      payload: { role, text },
    });
  }
}

async function appendModelHarnessResolution(store, threadId, runId, provider) {
  const activeToolNames = [
    "request_operator_decision",
    "create_plan",
    "update_plan_step",
    "record_run_milestone",
    "skill_load",
    "list_files",
    "read_file",
    "search_files",
    "inspect_code",
    "read_symbol",
    "list_symbols",
    "apply_patch",
    "verify_workspace",
    "run_command",
    "lsp_diagnostics",
    "web_search",
    "web_fetch",
    "browser",
  ];
  const omittedToolNames = Array.from(
    { length: 24 },
    (_, index) => `deferred_tool_${String(index + 1).padStart(2, "0")}`,
  );
  const content = {
    kind: "napier.model-harness-resolution",
    schemaVersion: 1,
    harnessId: "napier.model-harness.generic.v1",
    family: "generic",
    promptDialect: "compact",
    provider,
    model: "faux-1",
    modelApi: "faux:e2e",
    attempt: 1,
    intents: ["coding"],
    toolSurface: "focused",
    configuredToolCount: 42,
    activeToolCount: 18,
    activeToolNames,
    omittedToolNames,
    configuredToolDefinitionBytes: 60_000,
    activeToolDefinitionBytes: 24_000,
    savedToolDefinitionBytes: 36_000,
    maxRetries: 1,
    maxRetriesSource: "harness",
    maxRetryDelayMs: 30_000,
    maxRetryDelayMsSource: "harness",
  };
  await store.appendEvent({
    threadId,
    runId,
    type: "model.harness.resolved",
    category: "model",
    visibility: "debug",
    payload: { ...content, contentSha256: sha256(canonicalJson(content)) },
  });
}

async function appendToolResultContextPruning(store, threadId, runId) {
  const content = {
    kind: "napier.tool-result-context-pruning",
    schemaVersion: 1,
    attempt: 1,
    messageCount: 20,
    toolResultCount: 8,
    replacementCount: 4,
    supersededResultCount: 1,
    repeatedErrorCount: 1,
    largeResultCount: 1,
    emptyResultCount: 1,
    originalToolResultTextBytes: 60_000,
    activeToolResultTextBytes: 24_000,
    savedToolResultTextBytes: 36_000,
    originalToolResultSetSha256: "a".repeat(64),
    activeToolResultSetSha256: "b".repeat(64),
    replacementSetSha256: "c".repeat(64),
  };
  await store.appendEvent({
    threadId,
    runId,
    type: "model.context.tool-results.pruned",
    category: "model",
    visibility: "debug",
    payload: { ...content, contentSha256: sha256(canonicalJson(content)) },
  });
}

async function appendEnvironmentDegradation(store, threadId, runId) {
  const activeToolNames = Array.from(
    { length: 14 },
    (_, index) => `read_tool_${String(index + 1).padStart(2, "0")}`,
  );
  const omittedToolNames = Array.from(
    { length: 28 },
    (_, index) => `withheld_tool_${String(index + 1).padStart(2, "0")}`,
  );
  const content = {
    kind: "napier.environment-capability-negotiation",
    schemaVersion: 1,
    status: "degraded_read_only",
    executionMode: "environment_degraded_read_only",
    reason: "sandbox_unavailable",
    sandboxId: "unsupported",
    readinessId: "sandbox:unsupported",
    readinessDetailSha256: "d".repeat(64),
    configuredToolCount: 42,
    activeToolCount: 14,
    activeToolNames,
    omittedToolNames,
    repairComponent: "sandbox",
    repairCommand:
      "napier setup --workspace 'WORKSPACE_PATH' --component sandbox",
  };
  await store.appendEvent({
    threadId,
    runId,
    type: "run.environment.negotiated",
    category: "system",
    visibility: "user",
    payload: { ...content, contentSha256: sha256(canonicalJson(content)) },
  });
}

async function appendContextContinuityCheckpoint(store, threadId, runId) {
  const events = await store.listEvents(threadId);
  const fromSeq = events[0]?.seq ?? 1;
  const toSeq = events.at(-1)?.seq ?? fromSeq;
  const sourceEvents = events.filter(
    (event) =>
      event.type === "message.user" ||
      event.type === "message.assistant" ||
      event.type === "goal.continuation.prompt",
  );
  const continuityEvents = events.filter(
    (event) =>
      event.visibility === "user" &&
      (event.type === "tool.completed" ||
        event.type === "tool.failed" ||
        event.type === "tool.blocked" ||
        event.type === "tool.result_reused" ||
        event.type.startsWith("plan.") ||
        event.type.startsWith("operator.decision.") ||
        event.type.startsWith("run.recovery.") ||
        event.type === "run.environment.negotiated" ||
        event.type === "verification.completed" ||
        event.type === "workspace.file.mutated" ||
        event.type === "agent.milestone.recorded" ||
        event.type === "goal.evaluated"),
  );
  const summary =
    "Continue with the verified environment boundary, completed reads, and remaining validation step.";
  await store.appendEvent({
    threadId,
    runId,
    type: "context.compaction.completed",
    category: "model",
    visibility: "user",
    payload: {
      schemaVersion: 1,
      checkpointId: "checkpoint_e2e_continuity",
      fromSeq,
      toSeq,
      retainedFromSeq: toSeq + 1,
      sourceEventCount: sourceEvents.length,
      sourceSha256: sha256(sourceEvents.map((event) => JSON.stringify(event)).join("\n")),
      summarySha256: sha256(summary),
      summary,
      decisions: ["Keep the degraded read-only environment boundary."],
      openLoops: ["Complete final validation before delivery."],
      artifacts: [],
      continuityProjectionVersion: 1,
      continuityEventCount: continuityEvents.length,
      continuitySha256: sha256(
        continuityEvents.map((event) => JSON.stringify(event)).join("\n"),
      ),
    },
  });
}
