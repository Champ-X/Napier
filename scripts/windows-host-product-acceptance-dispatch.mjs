import path from "node:path";

import {
  canonicalJson,
  sha256,
} from "./sandbox-external-publication-model.mjs";
import { WINDOWS_ACCEPTANCE_WORKFLOW } from "./windows-host-product-acceptance-artifact.mjs";
import {
  githubCommand,
  githubJson,
  githubJsonWithRetry,
  runGitCli,
  runGithubCli,
} from "./windows-host-product-acceptance-dispatch-io.mjs";
import {
  WINDOWS_ACCEPTANCE_ACTIVE_RUN_STATUSES,
  WINDOWS_ACCEPTANCE_RUNNER_LABELS as REQUIRED_LABELS,
  validatedWindowsRunnerState,
  validatedWindowsRunState,
  windowsActiveRunPage,
} from "./windows-host-product-acceptance-dispatch-state.mjs";

export const WINDOWS_ACCEPTANCE_DISPATCH_PREVIEW_KIND =
  "napier.windows-host-product-acceptance-dispatch-preview";
export const WINDOWS_ACCEPTANCE_DISPATCH_RESULT_KIND =
  "napier.windows-host-product-acceptance-dispatch-result";

const REPOSITORY = "Champ-X/Napier";
const SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const WORKFLOW_TITLE = "Windows Docker host acceptance";

export async function previewWindowsHostProductAcceptanceDispatch(options) {
  return (await inspectDispatchState(options)).preview;
}

export async function applyWindowsHostProductAcceptanceDispatch(options) {
  const state = await inspectDispatchState(options);
  if (state.preview.contentSha256 !== options.expectedPreviewSha256) {
    throw new Error("Windows acceptance dispatch preview is stale");
  }
  if (state.preview.status !== "ready") {
    throw new Error("Windows acceptance runner capacity is unavailable");
  }
  const runGh = options.runGh ?? runGithubCli;
  let dispatch;
  try {
    dispatch = await githubCommand(
      runGh,
      [
        "workflow",
        "run",
        path.basename(WINDOWS_ACCEPTANCE_WORKFLOW),
        "--repo",
        `github.com/${REPOSITORY}`,
        "--ref",
        "main",
        "-f",
        `source_sha=${state.preview.sourceSha}`,
      ],
      state.repoRoot,
    );
  } catch {
    return createDispatchResult(
      state.preview,
      "indeterminate",
      "dispatch_command_failed",
    );
  }
  const workflowRunId = dispatchRunId(dispatch.stdout);
  if (!workflowRunId) {
    return createDispatchResult(
      state.preview,
      "indeterminate",
      "run_url_missing",
    );
  }
  let workflowRun;
  try {
    workflowRun = await githubJsonWithRetry(
      runGh,
      `repos/${REPOSITORY}/actions/runs/${workflowRunId}`,
      state.repoRoot,
      options.sleep,
    );
  } catch {
    return createDispatchResult(
      state.preview,
      "indeterminate",
      "run_lookup_failed",
      workflowRunId,
    );
  }
  if (
    !dispatchedRunMatches(workflowRun, state.preview.sourceSha, workflowRunId)
  ) {
    return createDispatchResult(
      state.preview,
      "indeterminate",
      "run_identity_invalid",
      workflowRunId,
    );
  }
  return createDispatchResult(
    state.preview,
    "dispatched",
    "run_identity_verified",
    workflowRunId,
    String(workflowRun.run_attempt),
    workflowRun.status,
  );
}

async function inspectDispatchState(options) {
  const repoRoot = path.resolve(options.repoRoot);
  const sourceSha = String(options.sourceSha ?? "");
  if (!SHA.test(sourceSha)) {
    throw new Error("Windows acceptance dispatch source SHA is invalid");
  }
  const runGh = options.runGh ?? runGithubCli;
  const runGit = options.runGit ?? runGitCli;
  const [main, runners, runs, localHead] = await Promise.all([
    githubJson(runGh, `repos/${REPOSITORY}/commits/main`, repoRoot),
    githubJson(
      runGh,
      `repos/${REPOSITORY}/actions/runners?per_page=100`,
      repoRoot,
    ),
    workflowRuns(runGh, repoRoot),
    runGit(["rev-parse", "HEAD"], { cwd: repoRoot }),
  ]);
  if (main?.sha !== sourceSha || localHead.stdout.trim() !== sourceSha) {
    throw new Error(
      "Windows acceptance dispatch source is not exact current main",
    );
  }
  const runnerState = validatedWindowsRunnerState(runners);
  const runState = validatedWindowsRunState(runs, {
    repository: REPOSITORY,
    workflow: WINDOWS_ACCEPTANCE_WORKFLOW,
  });
  const blockers = [];
  if (runnerState.matching.length === 0) {
    blockers.push("windows_runner_missing");
  } else if (runnerState.online.length === 0) {
    blockers.push("windows_runner_offline");
  } else if (runnerState.idle.length === 0) {
    blockers.push("windows_runner_busy");
  }
  if (runState.active.length > 0) {
    blockers.push("windows_acceptance_run_active");
  }
  const content = {
    kind: WINDOWS_ACCEPTANCE_DISPATCH_PREVIEW_KIND,
    schemaVersion: 1,
    repository: REPOSITORY,
    workflow: WINDOWS_ACCEPTANCE_WORKFLOW,
    sourceSha,
    requiredLabels: REQUIRED_LABELS,
    matchingRunnerCount: runnerState.matching.length,
    onlineRunnerCount: runnerState.online.length,
    idleRunnerCount: runnerState.idle.length,
    runnerStateSha256: sha256(canonicalJson(runnerState.matching)),
    activeRunCount: runState.active.length,
    activeRunStateSha256: sha256(canonicalJson(runState.active)),
    status: blockers.length === 0 ? "ready" : "blocked",
    blockers,
    retention: retention(),
    scope: {
      currentMainVerified: true,
      runnerCapacityOnly: true,
      dispatchAllowed: blockers.length === 0,
      acceptanceReceiptVerified: false,
      windowsHostProductAcceptance: false,
      s1Complete: false,
    },
  };
  const preview = {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
  const errors = validateWindowsHostProductAcceptanceDispatchPreview(preview);
  if (errors.length > 0) {
    throw new Error(
      `Windows acceptance dispatch preview is invalid: ${errors.join("; ")}`,
    );
  }
  return {
    repoRoot,
    preview,
  };
}

export function validateWindowsHostProductAcceptanceDispatchPreview(value) {
  const errors = [];
  if (
    !record(value) ||
    !exactKeys(value, [
      "kind",
      "schemaVersion",
      "repository",
      "workflow",
      "sourceSha",
      "requiredLabels",
      "matchingRunnerCount",
      "onlineRunnerCount",
      "idleRunnerCount",
      "runnerStateSha256",
      "activeRunCount",
      "activeRunStateSha256",
      "status",
      "blockers",
      "retention",
      "scope",
      "contentSha256",
    ]) ||
    value.kind !== WINDOWS_ACCEPTANCE_DISPATCH_PREVIEW_KIND ||
    value.schemaVersion !== 1 ||
    value.repository !== REPOSITORY ||
    value.workflow !== WINDOWS_ACCEPTANCE_WORKFLOW ||
    !SHA.test(value.sourceSha ?? "") ||
    canonicalJson(value.requiredLabels) !== canonicalJson(REQUIRED_LABELS) ||
    !countsValid(value) ||
    !SHA256.test(value.runnerStateSha256 ?? "") ||
    !SHA256.test(value.activeRunStateSha256 ?? "") ||
    !validPreviewState(value) ||
    canonicalJson(value.retention) !== canonicalJson(retention()) ||
    !SHA256.test(value.contentSha256 ?? "")
  ) {
    errors.push("Windows acceptance dispatch preview shape is invalid");
    return errors;
  }
  const { contentSha256, ...content } = value;
  if (contentSha256 !== sha256(canonicalJson(content))) {
    errors.push("Windows acceptance dispatch preview hash is invalid");
  }
  return errors;
}

export function validateWindowsHostProductAcceptanceDispatchResult(
  value,
  preview,
) {
  const errors = [];
  if (
    validateWindowsHostProductAcceptanceDispatchPreview(preview).length > 0 ||
    preview.status !== "ready" ||
    !record(value) ||
    !exactKeys(value, [
      "kind",
      "schemaVersion",
      "repository",
      "workflow",
      "sourceSha",
      "workflowRunId",
      "workflowRunAttempt",
      "runStatus",
      "status",
      "outcomeCode",
      "previewSha256",
      "runnerStateSha256",
      "priorRunStateSha256",
      "retention",
      "scope",
      "contentSha256",
    ]) ||
    value.kind !== WINDOWS_ACCEPTANCE_DISPATCH_RESULT_KIND ||
    value.schemaVersion !== 1 ||
    value.repository !== REPOSITORY ||
    value.workflow !== WINDOWS_ACCEPTANCE_WORKFLOW ||
    value.sourceSha !== preview.sourceSha ||
    !validDispatchOutcome(value) ||
    value.previewSha256 !== preview.contentSha256 ||
    value.runnerStateSha256 !== preview.runnerStateSha256 ||
    value.priorRunStateSha256 !== preview.activeRunStateSha256 ||
    canonicalJson(value.retention) !== canonicalJson(retention()) ||
    canonicalJson(value.scope) !==
      canonicalJson({
        runnerCapacityObserved: true,
        dispatchRequested: true,
        dispatchOutcomeKnown: value.status === "dispatched",
        acceptanceReceiptVerified: false,
        windowsHostProductAcceptance: false,
        s1Complete: false,
      }) ||
    !SHA256.test(value.contentSha256 ?? "")
  ) {
    errors.push("Windows acceptance dispatch result shape is invalid");
    return errors;
  }
  const { contentSha256, ...content } = value;
  if (contentSha256 !== sha256(canonicalJson(content))) {
    errors.push("Windows acceptance dispatch result hash is invalid");
  }
  return errors;
}

function createDispatchResult(
  preview,
  status,
  outcomeCode,
  workflowRunId = null,
  workflowRunAttempt = null,
  runStatus = null,
) {
  const content = {
    kind: WINDOWS_ACCEPTANCE_DISPATCH_RESULT_KIND,
    schemaVersion: 1,
    repository: REPOSITORY,
    workflow: WINDOWS_ACCEPTANCE_WORKFLOW,
    sourceSha: preview.sourceSha,
    workflowRunId,
    workflowRunAttempt,
    runStatus,
    status,
    outcomeCode,
    previewSha256: preview.contentSha256,
    runnerStateSha256: preview.runnerStateSha256,
    priorRunStateSha256: preview.activeRunStateSha256,
    retention: retention(),
    scope: {
      runnerCapacityObserved: true,
      dispatchRequested: true,
      dispatchOutcomeKnown: status === "dispatched",
      acceptanceReceiptVerified: false,
      windowsHostProductAcceptance: false,
      s1Complete: false,
    },
  };
  const result = { ...content, contentSha256: sha256(canonicalJson(content)) };
  const errors = validateWindowsHostProductAcceptanceDispatchResult(
    result,
    preview,
  );
  if (errors.length > 0) {
    throw new Error(
      `Windows acceptance dispatch result is invalid: ${errors.join("; ")}`,
    );
  }
  return result;
}

function dispatchRunId(stdout) {
  const match =
    /^https:\/\/github\.com\/Champ-X\/Napier\/actions\/runs\/([1-9][0-9]*)\s*$/u.exec(
      stdout,
    );
  return match?.[1];
}

function dispatchedRunMatches(run, sourceSha, workflowRunId) {
  return String(run?.id ?? "") !== workflowRunId ||
    !positiveIntegerText(String(run?.run_attempt ?? "")) ||
    run.event !== "workflow_dispatch" ||
    ![...WINDOWS_ACCEPTANCE_ACTIVE_RUN_STATUSES, "completed"].includes(
      run.status,
    ) ||
    run.head_branch !== "main" ||
    run.head_sha !== sourceSha ||
    run.path !== WINDOWS_ACCEPTANCE_WORKFLOW ||
    run.repository?.full_name !== REPOSITORY ||
    run.head_repository?.full_name !== REPOSITORY ||
    run.display_title !== `${WORKFLOW_TITLE} @ ${sourceSha}`
    ? false
    : true;
}

async function workflowRuns(runGh, cwd) {
  const base = `repos/${REPOSITORY}/actions/workflows/${path.basename(
    WINDOWS_ACCEPTANCE_WORKFLOW,
  )}/runs?event=workflow_dispatch&branch=main&per_page=100`;
  const pages = await Promise.all(
    WINDOWS_ACCEPTANCE_ACTIVE_RUN_STATUSES.map(async (status) => ({
      status,
      page: await githubJson(runGh, `${base}&status=${status}`, cwd),
    })),
  );
  const workflowRuns = pages.flatMap(({ page, status }) =>
    windowsActiveRunPage(page, status),
  );
  return {
    total_count: workflowRuns.length,
    workflow_runs: workflowRuns,
  };
}

function validPreviewState(value) {
  const allowedBlockers = [
    "windows_runner_missing",
    "windows_runner_offline",
    "windows_runner_busy",
    "windows_acceptance_run_active",
  ];
  const blockersValid =
    Array.isArray(value.blockers) &&
    value.blockers.every((blocker) => allowedBlockers.includes(blocker)) &&
    new Set(value.blockers).size === value.blockers.length;
  const expectedBlockers = [];
  if (value.matchingRunnerCount === 0) {
    expectedBlockers.push("windows_runner_missing");
  } else if (value.onlineRunnerCount === 0) {
    expectedBlockers.push("windows_runner_offline");
  } else if (value.idleRunnerCount === 0) {
    expectedBlockers.push("windows_runner_busy");
  }
  if (value.activeRunCount > 0) {
    expectedBlockers.push("windows_acceptance_run_active");
  }
  const ready = value.blockers.length === 0;
  return (
    blockersValid &&
    canonicalJson(value.blockers) === canonicalJson(expectedBlockers) &&
    value.status === (ready ? "ready" : "blocked") &&
    canonicalJson(value.scope) ===
      canonicalJson({
        currentMainVerified: true,
        runnerCapacityOnly: true,
        dispatchAllowed: ready,
        acceptanceReceiptVerified: false,
        windowsHostProductAcceptance: false,
        s1Complete: false,
      })
  );
}

function validDispatchOutcome(value) {
  const fixedCodes = [
    "dispatch_command_failed",
    "run_url_missing",
    "run_lookup_failed",
    "run_identity_invalid",
    "run_identity_verified",
  ];
  if (!fixedCodes.includes(value.outcomeCode)) return false;
  if (value.status === "dispatched") {
    return (
      value.outcomeCode === "run_identity_verified" &&
      positiveIntegerText(value.workflowRunId) &&
      positiveIntegerText(value.workflowRunAttempt) &&
      [...WINDOWS_ACCEPTANCE_ACTIVE_RUN_STATUSES, "completed"].includes(
        value.runStatus,
      )
    );
  }
  if (value.status !== "indeterminate") return false;
  if (value.workflowRunAttempt !== null || value.runStatus !== null)
    return false;
  if (
    ["run_lookup_failed", "run_identity_invalid"].includes(value.outcomeCode)
  ) {
    return positiveIntegerText(value.workflowRunId);
  }
  return value.workflowRunId === null;
}

function countsValid(value) {
  return (
    [value.matchingRunnerCount, value.onlineRunnerCount, value.idleRunnerCount]
      .concat(value.activeRunCount)
      .every((count) => Number.isSafeInteger(count) && count >= 0) &&
    value.idleRunnerCount <= value.onlineRunnerCount &&
    value.onlineRunnerCount <= value.matchingRunnerCount
  );
}

function retention() {
  return {
    credentialValues: false,
    rawApiResponse: false,
    rawRunnerIdentity: false,
    actorIdentity: false,
    workflowLogs: false,
    downloadUrl: false,
    workspacePaths: false,
  };
}

function positiveIntegerText(value) {
  return typeof value === "string" && /^[1-9][0-9]*$/u.test(value);
}

function exactKeys(value, keys) {
  return (
    record(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort())
  );
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
