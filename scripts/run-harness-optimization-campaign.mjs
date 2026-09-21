import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { campaignLimitOverrides } from "./harness-campaign-limits.mjs";
import { openSpendingBudget } from "./harness-spending-budget.mjs";
import { installSpendingBudget } from "./harness-spending-transport.mjs";
import {
  readHostAwakeEvidence,
  holdHarnessHostAwake,
} from "./harness-host-awake.mjs";
import {
  parseBranchHistoryFixture,
  seedBranchHistory,
  auditBranchHistory,
} from "./harness-branch-history-fixture.mjs";
import {
  assertProfileFileSelection,
  readCampaignProfile,
} from "./harness-campaign-profile.mjs";
import {
  createApiRequestBudget,
  openApiRequestBudget,
  installDeepSeekRequestBudget,
} from "./harness-api-request-budget.mjs";
import { collectEditOperationEvidence } from "./harness-edit-operation-evidence.mjs";
import { collectProcessEvidence } from "./harness-process-evidence.mjs";
import { auditProcessExchanges } from "./harness-process-exchanges.mjs";
import { collectEnvironmentEvidence } from "./harness-environment-evidence.mjs";
import { collectUsageEvidence } from "./harness-usage-evidence.mjs";
import {
  prepareSandboxGrader,
  runSandboxGrader,
} from "./harness-sandbox-grader.mjs";
import { createObservedWorkspaceReceipt } from "./harness-observed-workspace.mjs";
import {
  scanRuntimeDependencies,
  dependencyGraphReceipt,
} from "./harness-runtime-dependencies.mjs";
import {
  assertDebuggerAcceptance,
  collectDebuggerEvidence,
} from "./harness-debugger-evidence.mjs";

const { values } = parseArgs({
  options: {
    "runtime-root": { type: "string", default: process.cwd() },
    "case-root": { type: "string" },
    output: { type: "string" },
    arm: { type: "string", default: "baseline" },
    trials: { type: "string", default: "1" },
    "trial-offset": { type: "string", default: "0" },
    policy: { type: "string" },
    "profile-file": { type: "string" },
    "profile-file-sha256": { type: "string" },
    "profile-mode": { type: "string" },
    "edit-dialect": { type: "string" },
    "calibration-catalog": { type: "string" },
    "context-delivery": { type: "string" },
    finalization: { type: "string" },
    "api-budget": { type: "string" },
    "max-api-requests": { type: "string" },
    "api-request-interval-ms": { type: "string" },
    "max-cost-usd": { type: "string" },
    "run-timeout-ms": { type: "string" },
    "spending-budget": { type: "string" },
    "branch-history-fixture": { type: "string" },
    "grader-mode": { type: "string", default: "host" },
    "grader-runtimes": { type: "string", default: "node" },
  },
});
const limitOverrides = campaignLimitOverrides(values);
if (!["host", "sandbox"].includes(values["grader-mode"]))
  throw new Error("grader-mode must be host or sandbox");
if (values["grader-mode"] === "host" && values["grader-runtimes"] !== "node")
  throw new Error("Explicit grader runtimes require sandbox mode");
if (
  !values.output ||
  !values["case-root"] ||
  !["baseline", "candidate"].includes(values.arm)
)
  throw new Error("Specify --case-root, --output and --arm baseline|candidate");
if (
  values["api-budget"]
    ? values["max-api-requests"] !== undefined ||
      values["api-request-interval-ms"] !== undefined
    : values["max-api-requests"] === undefined ||
      values["api-request-interval-ms"] === undefined
)
  throw new Error(
    "Specify a shared --api-budget OR explicit --max-api-requests and --api-request-interval-ms",
  );
const trials = Number(values.trials);
const trialOffset = Number(values["trial-offset"]);
if (
  !Number.isSafeInteger(trialOffset) ||
  trialOffset < 0 ||
  trialOffset + trials > 100
)
  throw new Error("Invalid campaign trial offset");
if (!Number.isInteger(trials) || trials < 1 || trials > 100)
  throw new Error("Invalid trial count");
if (
  values["profile-mode"] !== undefined &&
  !["default", "policy"].includes(values["profile-mode"])
)
  throw new Error("profile-mode must be default or policy");
const root = path.resolve(values["runtime-root"]);
assertProfileFileSelection(values);
if (values["profile-file-sha256"] && !values["profile-file"])
  throw new Error("Profile file hash requires --profile-file");
const explicitProfile = values["profile-file"]
  ? await readCampaignProfile(
      path.resolve(values["profile-file"]),
      root,
      values["profile-file-sha256"],
    )
  : undefined;
values.policy ??= "edit-references";
if (
  ![
    "edit-references",
    "unified-diff",
    "toolchains",
    "memory",
    "working-state",
    "prompt-cache",
    "coding-node.v1",
    "coding-python.v1",
    "research.v1",
  ].includes(values.policy)
)
  throw new Error("Unknown candidate policy");
const runtimeArtifactRoot = path.join(root, "packages/runtime/dist");
const runtimeDependencies = await scanRuntimeDependencies(root);
const runtimeArtifactSha256 = digest(
  JSON.stringify(await inventory(runtimeArtifactRoot)),
);
const sourceIdentity = await sourceIdentityAt(root);
const load = (name) =>
  import(pathToFileURL(path.join(root, "packages/runtime/dist", name)));
const { AgentRuntime } = await load("agent-runtime.js");
const { LocalStore } = await load("store.js");
const { ModelInvocationCapsuleStore } = await load(
  "model-invocation-capsule-store.js",
);
const { ModelRegistry } = await load("models.js");
const { CredentialReferenceStore } = await load("credentials.js");
const { createPlatformSandboxAdapter } = await load("sandbox.js");
const { WorkspaceProcessManager } = await load("workspace-processes.js");
const caseRoot = path.resolve(values["case-root"]);
const campaignScriptSha256 = digest(
  await readFile(fileURLToPath(import.meta.url)),
);
const campaignHelperSha256 = digest(await helperIdentity());
const manifest = JSON.parse(
  await readFile(path.join(caseRoot, "manifest.json"), "utf8"),
);
assertDebuggerAcceptance(manifest.debuggerAcceptance);
const maxTurns = manifest.maxTurns ?? 24;
if (!Number.isSafeInteger(maxTurns) || maxTurns < 1 || maxTurns > 64)
  throw new Error("Campaign maxTurns must be 1-64");
const prompt = await readFile(path.join(caseRoot, manifest.promptPath), "utf8");
const outcome = await readFile(
  path.join(caseRoot, manifest.outcomeTestPath),
  "utf8",
);
const memorySeedText = manifest.memorySeedPath
  ? await readFile(path.join(caseRoot, manifest.memorySeedPath), "utf8")
  : undefined;
const memorySeeds = memorySeedText ? JSON.parse(memorySeedText) : [];
const branchHistoryText = values["branch-history-fixture"]
  ? await readFile(path.resolve(values["branch-history-fixture"]), "utf8")
  : undefined;
const branchHistory =
  branchHistoryText !== undefined
    ? parseBranchHistoryFixture(branchHistoryText)
    : undefined;
const servingModel = {
  provider: "deepseek",
  id: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
};
if (!process.env.DEEPSEEK_API_KEY)
  throw new Error("DeepSeek credential is required");
const resolvedServingModel = new ModelRegistry().resolve(servingModel);
const servingApi = resolvedServingModel?.api;
if (!servingApi) throw new Error("Serving model API is unavailable");
if (new URL(resolvedServingModel.baseUrl).origin !== "https://api.deepseek.com")
  throw new Error(
    "Campaign request guard requires the standard DeepSeek endpoint",
  );
const output = path.resolve(values.output);
await mkdir(output, { recursive: true });
const hostAwake = readHostAwakeEvidence();
await writeFile(
  path.join(output, "host-awake.before.json"),
  JSON.stringify(hostAwake, null, 2) + "\n",
  { flag: "wx" },
);
const hostAwakeLease = await holdHarnessHostAwake(hostAwake);
const apiBudgetFile = values["api-budget"]
  ? path.resolve(values["api-budget"])
  : path.join(output, "api-budget.sqlite");
if (!values["api-budget"])
  createApiRequestBudget(apiBudgetFile, {
    maxRequests: Number(values["max-api-requests"]),
    minIntervalMs: Number(values["api-request-interval-ms"]),
  });
const apiBudget = openApiRequestBudget(apiBudgetFile);
const spendingBudget = values["spending-budget"]
  ? openSpendingBudget(path.resolve(values["spending-budget"]))
  : undefined;
const restoreSpending = spendingBudget
  ? installSpendingBudget(spendingBudget)
  : undefined;
const restoreFetch = installDeepSeekRequestBudget(apiBudget);
await writeFile(
  path.join(output, "runtime-dependencies.before.json"),
  JSON.stringify(runtimeDependencies, null, 2),
  { flag: "wx" },
);
let profile = explicitProfile?.profile;
if (
  !explicitProfile &&
  (values["profile-mode"] === "policy" ||
    (values["profile-mode"] === undefined && values.arm === "candidate"))
) {
  const { createHarnessPolicyProfile } = await load(
    "harness-policy-profile.js",
  );
  const { createModelHarnessExperimentProfile, bindRunHarnessProfile } =
    await load("model-harness-experiment-profile.js");
  profile = ["coding-node.v1", "coding-python.v1", "research.v1"].includes(
    values.policy,
  )
    ? bindRunHarnessProfile({ harnessPolicyPreset: values.policy })
        .harnessExperimentProfile
    : createModelHarnessExperimentProfile({
        id: `${values.policy}.v1`,
        maxActiveTools: 28,
        policies: createHarnessPolicyProfile({
          id: "coding-node",
          revision: 1,
          context: {
            prompt: values.policy === "prompt-cache" ? "stable-v1" : "legacy",
            memory: values.policy === "memory" ? "task-aware-v1" : "legacy",
            workingState:
              values.policy === "working-state" ? "evidence-v1" : "legacy",
          },
          toolSurface: {
            editReferences: ["edit-references", "unified-diff"].includes(
              values.policy,
            ),
            ...(values.policy === "unified-diff" ? { unifiedDiff: true } : {}),
          },
          verification:
            values.policy === "toolchains" ? "node-python-v1" : "node-v1",
        }),
      });
}
if (values["context-delivery"] !== undefined) {
  if (
    !profile?.policies ||
    !["system", "tail-v1"].includes(values["context-delivery"])
  )
    throw new Error(
      "Context delivery requires an explicit policy and system|tail-v1",
    );
  const { createHarnessPolicyProfile } = await load(
    "harness-policy-profile.js",
  );
  const { createModelHarnessExperimentProfile } = await load(
    "model-harness-experiment-profile.js",
  );
  const {
    schemaVersion: _version,
    contentSha256: _hash,
    ...policies
  } = profile.policies;
  if (policies.context.prompt !== "stable-v1")
    throw new Error("Context delivery comparison requires stable-v1");
  profile = createModelHarnessExperimentProfile({
    ...profile,
    policies: createHarnessPolicyProfile({
      ...policies,
      context: {
        ...policies.context,
        ...(values["context-delivery"] === "tail-v1"
          ? { delivery: "tail-v1" }
          : {}),
      },
    }),
  });
}
if (values.finalization !== undefined) {
  if (
    !profile?.policies ||
    !["legacy", "request-aware-v1"].includes(values.finalization)
  )
    throw new Error(
      "Finalization requires an explicit policy and legacy|request-aware-v1",
    );
  const { createHarnessPolicyProfile } = await load(
    "harness-policy-profile.js",
  );
  const { createModelHarnessExperimentProfile } = await load(
    "model-harness-experiment-profile.js",
  );
  const {
    contentSha256: _hash,
    schemaVersion: _version,
    ...policies
  } = profile.policies;
  const { finalization: _previous, ...context } = policies.context;
  profile = createModelHarnessExperimentProfile({
    ...profile,
    policies: createHarnessPolicyProfile({
      ...policies,
      context: {
        ...context,
        ...(values.finalization === "request-aware-v1"
          ? { finalization: values.finalization }
          : {}),
      },
    }),
  });
}
if (values["edit-dialect"] !== undefined) {
  if (
    !profile?.policies ||
    !["structured_patch", "hashline", "unified_diff"].includes(
      values["edit-dialect"],
    )
  )
    throw new Error(
      "An edit dialect requires an explicit policy and a supported format",
    );
  const { createHarnessPolicyProfile } = await load(
    "harness-policy-profile.js",
  );
  const { createModelHarnessExperimentProfile } = await load(
    "model-harness-experiment-profile.js",
  );
  const {
    contentSha256: _hash,
    schemaVersion: _version,
    ...policies
  } = profile.policies;
  profile = createModelHarnessExperimentProfile({
    ...profile,
    policies: createHarnessPolicyProfile({
      ...policies,
      toolSurface: {
        ...policies.toolSurface,
        editPreference: {
          provider: servingModel.provider,
          model: servingModel.id,
          api: servingApi,
          taskPhase: "coding",
          dialect: values["edit-dialect"],
        },
      },
    }),
  });
}
let calibrationSelection;
const { inferModelHarnessTaskPhases } = await load(
  "model-harness-resolution.js",
);
const taskPhases = inferModelHarnessTaskPhases([
  { role: "user", content: prompt, timestamp: 0 },
]);
if (values["calibration-catalog"]) {
  const { selectCalibratedEditProfile } = await load(
    "edit-format-calibration.js",
  );
  const selected = selectCalibratedEditProfile({
    catalog: JSON.parse(await readFile(values["calibration-catalog"], "utf8")),
    model: { ...servingModel, api: servingApi },
    taskPhases,
    runtimeArtifactSha256,
  });
  calibrationSelection = selected.receipt;
  profile = selected.profile ?? profile;
}
for (let trial = trialOffset; trial < trialOffset + trials; trial++) {
  const apiBudgetBefore = apiBudget.snapshot();
  const spendingBefore = spendingBudget?.snapshot();
  if (apiBudgetBefore.remaining === 0) {
    process.exitCode = 1;
    break;
  }
  const dir = path.join(output, `trial-${trial + 1}`);
  await mkdir(dir, { recursive: false });
  const workspaceRoot = path.join(dir, "workspace");
  await cp(path.join(caseRoot, manifest.fixturePath), workspaceRoot, {
    recursive: true,
  });
  const before = await inventory(workspaceRoot);
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(dir, "data"),
  });
  let processes;
  try {
    await store.initialize();
    await store.createCredentialReference({
      providerId: "deepseek",
      label: "Harness quality campaign",
      source: { type: "environment", variable: "DEEPSEEK_API_KEY" },
    });
    const credentials = new CredentialReferenceStore({
      store,
      env: { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY },
    });
    const models = new ModelRegistry(credentials);
    const enabledTools = [
      ...new Set([
        "read_file",
        "list_files",
        "search_files",
        "apply_patch",
        "run_command",
        ...manifest.requiredTools,
      ]),
    ];
    const agent = await store.updateAgent(store.listAgents()[0].id, {
      toolPolicy: "workspace",
      enabledTools,
      runLimits: {
        maxTurns,
        maxTotalTokens: 250_000,
        ...limitOverrides,
      },
    });
    let thread = await store.createThread({
      title: manifest.title,
      agentId: agent.id,
    });
    let branchHistoryReceipt;
    if (branchHistory) {
      const seeded = await seedBranchHistory({
        store,
        thread,
        fixture: branchHistory,
        ...(await load("thread-branches.js")),
      });
      thread = seeded.thread;
      branchHistoryReceipt = seeded.receipt;
    }
    for (const seed of memorySeeds) {
      const proposed = await store.proposeMemory(
        { content: seed.content, category: seed.category ?? "context" },
        {
          type: "manual",
          ...(seed.fileDependencies
            ? { fileDependencies: seed.fileDependencies }
            : {}),
        },
      );
      if (seed.approved !== false)
        await store.reviewMemory(proposed.id, { action: "approve" });
    }
    const sandbox = createPlatformSandboxAdapter();
    const graderConfiguration =
      values["grader-mode"] === "sandbox"
        ? await prepareSandboxGrader(
            sandbox,
            values["grader-runtimes"].split(","),
          )
        : undefined;
    if (
      enabledTools.some((name) =>
        ["workspace_process", "node_debugger"].includes(name),
      )
    ) {
      processes = new WorkspaceProcessManager({
        store,
        workspaceRoot,
        dataRoot: path.join(dir, "data"),
        sandbox,
      });
      await processes.initialize();
    }
    const runtime = new AgentRuntime(
      store,
      models,
      undefined,
      sandbox,
      processes,
    );
    const started = Date.now();
    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: prompt,
      model: servingModel,
      ...(profile ? { harnessExperimentProfile: profile } : {}),
      onEvent: (event) => {
        if (
          ["tool.completed", "tool.failed", "run.failed"].includes(event.type)
        )
          process.stderr.write(
            JSON.stringify({
              arm: values.arm,
              trial,
              event: event.type,
              tool: event.payload.toolName,
            }) + "\n",
          );
      },
    });
    const events = await store.listRunEvents(run.id);
    const componentProbe = branchHistoryReceipt
      ? {
          fixtureSha256: digest(branchHistoryText),
          ...(await auditBranchHistory(store, branchHistoryReceipt, events)),
        }
      : undefined;
    const environmentEvidence = collectEnvironmentEvidence(
      run,
      events,
      enabledTools,
      sandbox.id,
      { ...(await load("run-config.js")), ...(await load("ed25519.js")) },
    );
    const debuggerEvidence = await collectDebuggerEvidence(
      events,
      new ModelInvocationCapsuleStore(path.join(dir, "data")),
      manifest.debuggerAcceptance,
      before,
      await load("ed25519.js"),
    );
    const processEvidence = collectProcessEvidence(
      events,
      processes ? await processes.list(thread.id) : [],
      manifest.processAcceptance,
    );
    processEvidence.exchanges = await auditProcessExchanges(
      events,
      new ModelInvocationCapsuleStore(path.join(dir, "data")),
      processEvidence,
    );
    processEvidence.passed &&= processEvidence.exchanges.passed;
    const runtimeContextEvidence = await auditRuntimeContext(
      events,
      new ModelInvocationCapsuleStore(path.join(dir, "data")),
    );
    const after = await inventory(workspaceRoot);
    const changed = [
      ...new Set([...Object.keys(before), ...Object.keys(after)]),
    ].filter((file) => before[file] !== after[file]);
    // The external grader is introduced only after the agent stops.
    const graderPath = path.join(
      workspaceRoot,
      "__napier_external_grader__.mjs",
    );
    await writeFile(graderPath, outcome, { flag: "wx" });
    const graded = graderConfiguration
      ? await runSandboxGrader({
          sandbox,
          configuration: graderConfiguration,
          runSandboxedProcess: (await load("sandboxed-process.js"))
            .runSandboxedProcess,
          runId: run.id,
          workspaceRoot,
          graderPath,
        })
      : spawnSync(process.execPath, [graderPath], {
          cwd: workspaceRoot,
          encoding: "utf8",
          timeout: 30_000,
          env: { PATH: path.dirname(process.execPath) },
        });
    const requiredTools = (manifest.requiredCompletedTools ?? []).every(
      (name) =>
        events.some(
          (event) =>
            event.type === "tool.completed" && event.payload.toolName === name,
        ),
    );
    const allowedChanges = changed.every((file) =>
      manifest.allowedChangedPaths.includes(file),
    );
    const artifactStable =
      runtimeArtifactSha256 ===
      digest(JSON.stringify(await inventory(runtimeArtifactRoot)));
    const sourceStable =
      JSON.stringify(sourceIdentity) ===
        JSON.stringify(await sourceIdentityAt(root)) &&
      campaignScriptSha256 ===
        digest(await readFile(fileURLToPath(import.meta.url))) &&
      campaignHelperSha256 === digest(await helperIdentity());
    const dependenciesAfter = await scanRuntimeDependencies(root);
    await writeFile(
      path.join(dir, "runtime-dependencies.after.json"),
      JSON.stringify(dependenciesAfter, null, 2),
      { flag: "wx" },
    );
    const runtimeDependencyEvidence = dependencyGraphReceipt(
      runtimeDependencies,
      dependenciesAfter,
      run.id,
    );
    const responses = events
      .filter((event) => event.type === "model.response")
      .map((event) => event.payload);
    const servingIdentityMatched =
      responses.length > 0 &&
      responses.every(
        (response) =>
          response.model === `${servingModel.provider}/${servingModel.id}`,
      );
    const apiBudgetAfter = apiBudget.snapshot();
    const spendingAfter = spendingBudget?.snapshot();
    const report = {
      schemaVersion: spendingBudget ? 8 : 7,
      arm: values.arm,
      caseId: manifest.id,
      caseManifest: manifest,
      runLimits: agent.runLimits,
      trial,
      sourceCommit: spawnSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).stdout.trim(),
      runtimeArtifactSha256,
      campaignScriptSha256,
      campaignHelperSha256,
      memorySeedSha256: memorySeedText ? digest(memorySeedText) : null,
      runtimeArtifactStable: artifactStable,
      sourceIdentity,
      sourceStable,
      servingIdentityMatched,
      sandbox: sandbox.id,
      environmentEvidence,
      runtimeDependencyEvidence,
      qualifyingEvidence:
        !componentProbe &&
        artifactStable &&
        sourceStable &&
        servingIdentityMatched &&
        runtimeContextEvidence.valid,
      ...(componentProbe ? { componentProbe } : {}),
      apiRequestBudget: {
        before: apiBudgetBefore,
        after: apiBudgetAfter,
        scope: "Shared campaign/suite counters, not per-Run billing or usage",
      },
      ...(spendingBefore
        ? { spendingBudget: { before: spendingBefore, after: spendingAfter } }
        : {}),
      runtimeContextEvidence,
      fixtureSha256: digest(JSON.stringify(before)),
      promptSha256: digest(prompt),
      outcomeSha256: digest(outcome),
      acceptanceSha256: digest(
        JSON.stringify({
          maxTurns,
          allowedChangedPaths: manifest.allowedChangedPaths,
          requiredTools: manifest.requiredTools,
          requiredCompletedTools: manifest.requiredCompletedTools ?? [],
          processAcceptance: manifest.processAcceptance ?? null,
          debuggerAcceptance: manifest.debuggerAcceptance ?? null,
        }),
      ),
      requestedModel: servingModel,
      taskPhases,
      servingModelApis: [
        ...new Set(
          events
            .filter((event) => event.type === "model.harness.resolved")
            .map((event) => event.payload.modelApi),
        ),
      ],
      ...(calibrationSelection ? { calibrationSelection } : {}),
      profile: profile ?? null,
      runId: run.id,
      threadId: thread.id,
      status: run.status,
      error: run.error,
      durationMs: Date.now() - started,
      changed,
      observedWorkspace: createObservedWorkspaceReceipt(run.id, after),
      allowedChanges,
      requiredTools,
      processEvidence,
      debuggerEvidence,
      graderExitCode: graded.status,
      graderOutput: (graded.stdout + graded.stderr).slice(0, 8000),
      ...(graderConfiguration
        ? { graderConfiguration, graderExecution: graded.receipt }
        : {}),
      taskSuccess:
        run.status === "completed" &&
        graded.status === 0 &&
        allowedChanges &&
        requiredTools &&
        (!componentProbe || componentProbe.passed) &&
        processEvidence.passed &&
        debuggerEvidence.passed,
      modelResponses: responses,
      finalizationReceipts: events
        .filter((event) => event.type === "run.finalization.reserved")
        .map((event) => ({ eventId: event.id, ...event.payload })),
      editOperationEvidence: await collectEditOperationEvidence(
        events,
        new ModelInvocationCapsuleStore(path.join(dir, "data")),
      ),
      verificationExecutions: events
        .filter(
          (event) =>
            event.type === "tool.completed" &&
            event.payload.toolName === "verify_workspace",
        )
        .map((event) => ({
          eventId: event.id,
          callId: event.payload.callId,
          details: event.payload.details,
        })),
      memoryProjections: events
        .filter((event) => event.type === "context.memory")
        .map((event) => event.payload),
      promptCacheProjections: events
        .filter((event) => event.type === "context.prompt_cache_projection")
        .map((event) => event.payload),
      usage: structuredClone(run.usage),
      usageEvidence: collectUsageEvidence(
        run,
        events,
        store.listSubagentTasks(thread.id, run.id),
      ),
      toolFailures: events.filter((event) => event.type === "tool.failed")
        .length,
      toolCalls: events.filter((event) => event.type === "tool.started").length,
    };
    await writeFile(
      path.join(dir, "result.json"),
      JSON.stringify(report, null, 2),
    );
    process.stdout.write(
      JSON.stringify({
        arm: report.arm,
        caseId: report.caseId,
        trial,
        taskSuccess: report.taskSuccess,
        status: report.status,
        toolFailures: report.toolFailures,
        durationMs: report.durationMs,
      }) + "\n",
    );
  } finally {
    try {
      await processes?.shutdown();
    } finally {
      await store.close();
    }
  }
}
restoreFetch();
restoreSpending?.();
hostAwakeLease.release();
spendingBudget?.close();
apiBudget.close();

async function helperIdentity() {
  return JSON.stringify(
    await Promise.all(
      [
        "harness-edit-operation-evidence.mjs",
        "harness-process-evidence.mjs",
        "harness-process-exchanges.mjs",
        "harness-debugger-evidence.mjs",
        "harness-environment-evidence.mjs",
        "harness-runtime-dependencies.mjs",
        "harness-usage-evidence.mjs",
        "harness-observed-workspace.mjs",
        "harness-sandbox-grader.mjs",
        "harness-suite.mjs",
        "harness-sample-identity.mjs",
        "harness-api-request-budget.mjs",
        "harness-campaign-profile.mjs",
        "harness-campaign-limits.mjs",
        "harness-spending-budget.mjs",
        "harness-spending-transport.mjs",
        "harness-host-awake.mjs",
        "harness-branch-history-fixture.mjs",
      ].map(async (name) => [
        name,
        digest(await readFile(new URL(`./${name}`, import.meta.url))),
      ]),
    ),
  );
}

async function auditRuntimeContext(events, capsules) {
  const deliveries = events.filter(
    (event) => event.type === "context.runtime_context.delivered",
  );
  if (deliveries.length === 0)
    return { valid: true, deliveries: 0, auditedCapsules: 0 };
  let auditedCapsules = 0;
  try {
    const { assertModelRequestEvidenceBindings } = await load(
      "model-prompt-evidence-bindings.js",
    );
    const { assertRuntimeContextInvocation } = await load(
      "runtime-context-evidence.js",
    );
    assertModelRequestEvidenceBindings(events);
    for (const event of events.filter(
      (event) =>
        event.type === "context.model_invocation" &&
        event.payload.purpose === "agent_turn",
    )) {
      const capsule = await capsules.read(event.payload.capsuleSha256);
      if (
        capsule.sourceRunId !== event.runId ||
        capsule.contextEnvelopeSha256 !== event.payload.contextEnvelopeSha256
      )
        throw new Error("Runtime context capsule identity differs");
      assertRuntimeContextInvocation(events, capsule);
      auditedCapsules++;
    }
    if (auditedCapsules !== deliveries.length)
      throw new Error("Runtime context capsule count differs");
    return { valid: true, deliveries: deliveries.length, auditedCapsules };
  } catch (error) {
    return {
      valid: false,
      deliveries: deliveries.length,
      auditedCapsules,
      diagnosticSha256: digest(String(error)),
    };
  }
}

async function sourceIdentityAt(root) {
  const names = [
    "packages/runtime/src",
    "packages/contracts/src",
    "packages/contracts/dist",
  ];
  const snapshots = {};
  for (const name of names)
    snapshots[name] = digest(
      JSON.stringify(await inventory(path.join(root, name))),
    );
  snapshots.packageLockSha256 = digest(
    await readFile(path.join(root, "package-lock.json")),
  );
  snapshots.nodeExecutableSha256 = digest(await readFile(process.execPath));
  snapshots.nodeVersion = process.version;
  return snapshots;
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}
async function inventory(root, prefix = "") {
  const files = {};
  for (const entry of (
    await readdir(path.join(root, prefix), { withFileTypes: true })
  ).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory())
      Object.assign(files, await inventory(root, relative));
    else if (entry.isFile())
      files[relative] = digest(await readFile(path.join(root, relative)));
    else throw new Error(`Unsupported fixture entry: ${relative}`);
  }
  return files;
}
