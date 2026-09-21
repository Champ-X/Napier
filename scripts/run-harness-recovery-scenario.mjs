import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createHarnessScenarioController } from "./harness-scenario-controller.mjs";
import { inventorySuiteTree } from "./harness-suite.mjs";
import { collectEnvironmentEvidence } from "./harness-environment-evidence.mjs";

const { values } = parseArgs({
  options: {
    "runtime-root": { type: "string" },
    "case-root": { type: "string" },
    output: { type: "string" },
    "profile-report": { type: "string" },
    resume: { type: "boolean", default: false },
    worker: { type: "boolean", default: false },
  },
});
if (!["runtime-root", "case-root", "output"].every((k) => values[k]))
  throw new Error("Specify runtime-root, case-root and a new output directory");
if (!process.env.DEEPSEEK_API_KEY)
  throw new Error("DeepSeek credential required");
const runtimeRoot = path.resolve(values["runtime-root"]);
const output = path.resolve(values.output);
const caseRoot = path.join(output, "inputs");
const workspaceRoot = path.join(output, "workspace");
const dataRoot = path.join(output, "data");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = async (p) => JSON.parse(await readFile(p, "utf8"));
const publish = (name, value) =>
  writeFile(path.join(output, name), JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
const load = (name) =>
  import(pathToFileURL(path.join(runtimeRoot, "packages/runtime/dist", name)));
if (!values.worker && !values.resume) {
  const execute = async (flag) => {
    const child = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), ...process.argv.slice(2), flag],
      { env: process.env, stdio: ["ignore", "inherit", "inherit"] },
    );
    const result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) =>
        resolve({ pid: child.pid, code, signal }),
      );
    });
    return result;
  };
  const exited = await execute("--worker");
  if (exited.code !== 86 || exited.signal !== null) process.exit(1);
  const original = await json(path.join(output, "initial-result.json"));
  if (original.sourcePid !== exited.pid || !original.scenario.completed)
    process.exit(1);
  await publish("source-process-exit.json", exited);
  const resumed = await execute("--resume");
  process.exit(resumed.code === 0 ? 0 : 1);
}
if (!values.resume) {
  const source = path.resolve(values["case-root"]);
  const before = await inventorySuiteTree(source);
  await mkdir(output, { recursive: false, mode: 0o700 });
  await cp(source, caseRoot, { recursive: true });
  if (
    JSON.stringify(before) !==
    JSON.stringify(await inventorySuiteTree(caseRoot))
  )
    throw new Error("Scenario inputs changed while freezing");
}
const manifest = await json(path.join(caseRoot, "manifest.json"));
if (
  manifest.kind !== "napier.harness-scenario-case" ||
  manifest.schemaVersion !== 1
)
  throw new Error(
    "Requires an explicit scenario case, not a static campaign case",
  );
const scenario = await json(path.join(caseRoot, manifest.scenarioPath));
const model = { provider: "deepseek", id: "deepseek-v4-flash" };
const runtimeIdentity = {
  source: sha(
    JSON.stringify(
      await inventorySuiteTree(path.join(runtimeRoot, "packages/runtime/src")),
    ),
  ),
  compiled: sha(
    JSON.stringify(
      await inventorySuiteTree(path.join(runtimeRoot, "packages/runtime/dist")),
    ),
  ),
};
const caseIdentity = sha(JSON.stringify(await inventorySuiteTree(caseRoot)));
if (!values.resume) {
  await cp(path.join(caseRoot, manifest.fixturePath), workspaceRoot, {
    recursive: true,
  });
}
const { LocalStore } = await load("store.js");
const { ModelRegistry } = await load("models.js");
const { CredentialReferenceStore } = await load("credentials.js");
const { AgentRuntime } = await load("agent-runtime.js");
const { createPlatformSandboxAdapter } = await load("sandbox.js");
const { ModelInvocationCapsuleStore } = await load(
  "model-invocation-capsule-store.js",
);
const { assertModelRequestEvidenceBindings } = await load(
  "model-prompt-evidence-bindings.js",
);
const store = new LocalStore({ workspaceRoot, dataRoot });
// Only this isolated scenario database is opened here. Startup verifies the
// former process owner is unavailable; no Run status or lease is forged.
await store.initialize(values.resume);
let state;
try {
  if (!values.resume) {
    await store.createCredentialReference({
      providerId: "deepseek",
      label: "Recovery scenario",
      source: { type: "environment", variable: "DEEPSEEK_API_KEY" },
    });
    const agent = await store.updateAgent(store.listAgents()[0].id, {
      enabledTools: [
        ...new Set(["list_files", "search_files", ...manifest.requiredTools]),
      ],
      enabledSkills: [],
      enabledSubagents: [],
      toolPolicy: "workspace",
      runLimits: {
        maxTurns: manifest.maxTurns,
        maxTotalTokens: 250000,
        maxCostUsd: 3,
        timeoutMs: 240000,
      },
    });
    const thread = await store.createThread({
      title: manifest.title,
      agentId: agent.id,
    });
    state = {
      threadId: thread.id,
      runtimeIdentity,
      caseIdentity,
      profile: values["profile-report"]
        ? (await json(path.resolve(values["profile-report"]))).profile
        : null,
      initialInventory: await inventorySuiteTree(workspaceRoot),
    };
  } else {
    state = await json(path.join(output, "initial-result.json"));
    if (
      JSON.stringify(state.runtimeIdentity) !==
        JSON.stringify(runtimeIdentity) ||
      state.caseIdentity !== caseIdentity
    )
      throw new Error("Scenario runtime or inputs changed across restart");
    if (!state.scenario.completed)
      throw new Error("Source scenario did not reach its interruption");
  }
  const models = new ModelRegistry(
    new CredentialReferenceStore({
      store,
      env: { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY },
    }),
  );
  const sandbox = createPlatformSandboxAdapter();
  const runtime = new AgentRuntime(store, models, undefined, sandbox);
  let run, controller;
  if (!values.resume) {
    let exitRequested = false;
    run = await runtime.runPrompt({
      threadId: state.threadId,
      text: await readFile(path.join(caseRoot, manifest.promptPath), "utf8"),
      model,
      ...(state.profile ? { harnessExperimentProfile: state.profile } : {}),
      onRunCreated: (current) => {
        controller = createHarnessScenarioController({
          threadId: state.threadId,
          runId: current.id,
          steps: scenario.steps,
          queueMessage: (request) => store.queueRunControlMessage(request),
          beforeInterrupt: async () => {
            const observed = await inventorySuiteTree(workspaceRoot);
            await publish("interrupt-workspace.json", observed);
            return { inventorySha256: sha(JSON.stringify(observed)) };
          },
          interrupt: () => {
            exitRequested = true;
          },
        });
      },
      onEvent: async (event) => {
        await controller?.observe(event);
        if (!exitRequested) return;
        const receipt = await controller.result();
        if (!receipt.completed) return;
        await publish("initial-result.json", {
          ...state,
          runId: event.runId,
          sourcePid: process.pid,
          status: "running",
          scenario: receipt,
          processExitRequested: true,
        });
        // Exit this dedicated worker without Runtime cancellation/finalization.
        // The supervisor waits for actual process exit before opening recovery.
        process.exit(86);
      },
    });
  } else {
    const exited = await json(path.join(output, "source-process-exit.json"));
    if (
      exited.code !== 86 ||
      exited.pid !== state.sourcePid ||
      exited.signal !== null
    )
      throw new Error("Original process exit is not established");
    run = await runtime.resumeInterruptedRun({
      threadId: state.threadId,
      runId: state.runId,
      model,
    });
  }
  const events = await store.listRunEvents(run.id);
  const allEvents = await store.listEvents(state.threadId);
  assertModelRequestEvidenceBindings(allEvents);
  const environment = collectEnvironmentEvidence(
    run,
    events,
    manifest.requiredTools,
    sandbox.id,
    { ...(await load("run-config.js")), ...(await load("ed25519.js")) },
  );
  const observations = {
    runId: run.id,
    parentRunId: run.parentRunId ?? null,
    status: run.status,
    outcome: run.outcome,
    model,
    environment,
    invocationBindingsVerified: true,
    verificationEvents: events
      .filter(
        (e) =>
          e.type === "tool.completed" &&
          e.payload.toolName === "verify_workspace",
      )
      .map((e) => ({ eventId: e.id, seq: e.seq, details: e.payload.details })),
    toolFailures: events
      .filter((e) => e.type === "tool.failed")
      .map((e) => ({ eventId: e.id, tool: e.payload.toolName })),
  };
  if (!values.resume) {
    const result = {
      ...state,
      ...observations,
      scenario: await controller.result(),
    };
    await publish("initial-result.json", result);
    console.log(
      JSON.stringify({
        stage: "initial",
        status: run.status,
        steps: result.scenario.completedSteps,
        scenarioComplete: result.scenario.completed,
      }),
    );
    if (!result.scenario.completed || !environment.eligible)
      process.exitCode = 1;
  } else {
    const finalInventory = await inventorySuiteTree(workspaceRoot);
    const { createWorkspacePathSnapshot } = await load("workspace-snapshot.js");
    const finalSnapshot = await createWorkspacePathSnapshot(
      workspaceRoot,
      workspaceRoot,
    );
    const before = new Map(Object.entries(state.initialInventory));
    const after = new Map(Object.entries(finalInventory));
    const changed = [...new Set([...before.keys(), ...after.keys()])].filter(
      (p) => before.get(p) !== after.get(p),
    );
    const allowedChanges = changed.every((p) =>
      manifest.allowedChangedPaths.includes(p),
    );
    // Grader bytes are introduced only after execution and final inventory.
    const graderPath = path.join(
      workspaceRoot,
      "__napier_scenario_grader__.mjs",
    );
    await writeFile(
      graderPath,
      await readFile(path.join(caseRoot, manifest.outcomeTestPath)),
      { flag: "wx" },
    );
    const grade = spawnSync(process.execPath, [graderPath], {
      cwd: workspaceRoot,
      encoding: "utf8",
      timeout: 30000,
      env: { PATH: path.dirname(process.execPath) },
    });
    const capsules = new ModelInvocationCapsuleStore(dataRoot);
    const invocation = events.find(
      (e) =>
        e.type === "context.model_invocation" &&
        e.payload.purpose === "agent_turn",
    );
    if (!invocation)
      throw new Error("Recovery has no actual invocation capsule");
    const capsule = await capsules.read(invocation.payload.capsuleSha256);
    const expectedState =
      state.profile?.policies?.context.workingState === "evidence-v1";
    let workingState;
    if (expectedState) {
      const { assertRuntimeContextInvocation } = await load(
        "runtime-context-evidence.js",
      );
      assertRuntimeContextInvocation(allEvents, capsule);
      const tail = capsule.context.messages.at(-1);
      const context =
        typeof tail?.content === "string"
          ? JSON.parse(tail.content)
          : undefined;
      const source = context?.sources?.find(
        (s) => s.sourceId === "workspace.task_working_state",
      )?.content;
      if (typeof source !== "string")
        throw new Error("Recovery working state was not delivered");
      workingState = JSON.parse(source.slice(source.lastIndexOf("\n") + 1));
    }
    const stateRetained =
      !expectedState ||
      (workingState.sourceRunIds.includes(state.runId) &&
        workingState.instructionRevision >= 2 &&
        workingState.verifications.some((v) => v.freshness === "stale"));
    const lastEditSeq = Math.max(
      -1,
      ...events
        .filter(
          (e) =>
            e.type === "tool.completed" && e.payload.toolName === "apply_patch",
        )
        .map((e) => e.seq),
    );
    const freshVerification =
      !finalSnapshot.truncated &&
      observations.verificationEvents.some(
        (e) =>
          e.seq > lastEditSeq &&
          e.details.status === "passed" &&
          e.details.workspaceSnapshotSha256 === finalSnapshot.sha256 &&
          e.details.workspaceSnapshotTruncated === false &&
          (e.details.snapshotStatus === undefined ||
            e.details.snapshotStatus === "unchanged"),
      );
    const result = {
      ...observations,
      changed,
      allowedChanges,
      finalInventory,
      graderExitCode: grade.status,
      graderOutputSha256: sha((grade.stdout ?? "") + (grade.stderr ?? "")),
      firstInvocationCapsuleSha256: invocation.payload.capsuleSha256,
      freshProcessRecovery: true,
      sourceProcessExitCode: 86,
      parentBindingValid: run.parentRunId === state.runId,
      workingStateRequired: expectedState,
      workingStateRetained: stateRetained,
      freshVerification,
      inputCaseSha256: caseIdentity,
      runtimeIdentity,
      taskSuccess:
        run.status === "completed" &&
        grade.status === 0 &&
        allowedChanges &&
        environment.eligible &&
        run.parentRunId === state.runId &&
        stateRetained &&
        freshVerification,
      scope:
        "Real steering and interruption after a settled edit, followed by fresh-process manual recovery; not compaction, unknown-side-effect recovery, or broad policy qualification",
      promotionReady: false,
    };
    await publish("recovery-result.json", result);
    console.log(
      JSON.stringify({
        stage: "recovered",
        status: run.status,
        taskSuccess: result.taskSuccess,
        allowedChanges,
      }),
    );
    if (!result.taskSuccess) process.exitCode = 1;
  }
} finally {
  store.close();
}
