import path from "node:path";

import { sandboxImageSourceEvidence } from "./check-sandbox-image-sbom.mjs";
import {
  githubCommand,
  githubJson,
  githubJsonWithRetry,
  runGitCli,
  runGithubCli,
} from "./github-actions-dispatch-io.mjs";
import {
  canonicalJson,
  sha256,
} from "./sandbox-external-publication-model.mjs";
import {
  SANDBOX_PUBLICATION_ACTIVE_RUN_STATUSES,
  activePublicationProjection,
  requireBootstrapRun,
  validatedPublicationRunPage,
} from "./sandbox-external-release-dispatch-state.mjs";
import {
  SANDBOX_RELEASE_DISPATCH_PREVIEW_KIND,
  SANDBOX_RELEASE_DISPATCH_RESULT_KIND,
  dispatchRetention,
  validateSandboxExternalReleaseDispatchPreview,
  validateSandboxExternalReleaseDispatchResult,
} from "./sandbox-external-release-dispatch-model.mjs";
import { inspectAnonymousSandboxBootstrap } from "./sandbox-external-release-visibility.mjs";

const REPOSITORY = "Champ-X/Napier";
const WORKFLOW = ".github/workflows/publish-sandbox.yml";
const SHA = /^[a-f0-9]{40}$/u;

export {
  SANDBOX_RELEASE_DISPATCH_PREVIEW_KIND,
  SANDBOX_RELEASE_DISPATCH_RESULT_KIND,
  validateSandboxExternalReleaseDispatchPreview,
  validateSandboxExternalReleaseDispatchResult,
};

export async function previewSandboxExternalReleaseDispatch(options) {
  return (await inspectReleaseDispatch(options)).preview;
}

export async function applySandboxExternalReleaseDispatch(options) {
  const state = await inspectReleaseDispatch(options);
  if (state.preview.contentSha256 !== options.expectedPreviewSha256) {
    throw new Error("Sandbox release dispatch preview is stale");
  }
  if (state.preview.status !== "ready") {
    throw new Error("Sandbox release dispatch prerequisites are unavailable");
  }
  const runGh = options.runGh ?? runGithubCli;
  let dispatch;
  try {
    dispatch = await githubCommand(
      runGh,
      [
        "workflow",
        "run",
        path.basename(WORKFLOW),
        "--repo",
        `github.com/${REPOSITORY}`,
        "--ref",
        "main",
        "-f",
        "mode=release",
        "-f",
        `source_sha=${state.preview.sourceSha}`,
      ],
      state.repoRoot,
    );
  } catch {
    return createReleaseDispatchResult(
      state.preview,
      "indeterminate",
      "dispatch_command_failed",
    );
  }
  const workflowRunId = dispatchRunId(dispatch.stdout);
  if (!workflowRunId) {
    return createReleaseDispatchResult(
      state.preview,
      "indeterminate",
      "run_url_missing",
    );
  }
  let run;
  try {
    run = await githubJsonWithRetry(
      runGh,
      `repos/${REPOSITORY}/actions/runs/${workflowRunId}`,
      state.repoRoot,
      options.sleep,
    );
  } catch {
    return createReleaseDispatchResult(
      state.preview,
      "indeterminate",
      "run_lookup_failed",
      workflowRunId,
    );
  }
  if (!releaseRunMatches(run, state.preview.sourceSha, workflowRunId)) {
    return createReleaseDispatchResult(
      state.preview,
      "indeterminate",
      "run_identity_invalid",
      workflowRunId,
    );
  }
  return createReleaseDispatchResult(
    state.preview,
    "dispatched",
    "run_identity_verified",
    workflowRunId,
    String(run.run_attempt),
    run.status,
  );
}

async function inspectReleaseDispatch(options) {
  const repoRoot = path.resolve(options.repoRoot);
  const sourceSha = String(options.sourceSha ?? "");
  const bootstrapRunId = String(options.bootstrapRunId ?? "");
  if (!SHA.test(sourceSha) || !positiveIntegerText(bootstrapRunId)) {
    throw new Error("Sandbox release dispatch source is invalid");
  }
  const runGh = options.runGh ?? runGithubCli;
  const runGit = options.runGit ?? runGitCli;
  const [main, localHead, bootstrap, source, visibility, activeRuns, releases] =
    await Promise.all([
      githubJson(runGh, `repos/${REPOSITORY}/commits/main`, repoRoot),
      runGit(["rev-parse", "HEAD"], { cwd: repoRoot }),
      githubJson(
        runGh,
        `repos/${REPOSITORY}/actions/runs/${bootstrapRunId}`,
        repoRoot,
      ),
      sandboxImageSourceEvidence(repoRoot),
      inspectAnonymousSandboxBootstrap({
        repoRoot,
        sourceSha,
        request: options.request,
      }),
      publicationRuns(runGh, repoRoot, "active"),
      publicationRuns(runGh, repoRoot, "success", sourceSha),
    ]);
  if (main?.sha !== sourceSha || localHead.stdout.trim() !== sourceSha) {
    throw new Error(
      "Sandbox release dispatch source is not exact current main",
    );
  }
  const bootstrapIdentity = requireBootstrapRun(
    bootstrap,
    sourceSha,
    bootstrapRunId,
  );
  const successfulReleases = releases.filter(
    (run) =>
      run.head_sha === sourceSha &&
      run.display_title === `Sandbox OCI release @ ${sourceSha}`,
  );
  const active = activePublicationProjection(activeRuns);
  const blockers = [];
  if (visibility.status !== "ready") blockers.push(visibility.blocker);
  if (active.length > 0) blockers.push("sandbox_publication_run_active");
  if (successfulReleases.length > 0) {
    blockers.push("sandbox_release_already_succeeded");
  }
  const content = {
    kind: SANDBOX_RELEASE_DISPATCH_PREVIEW_KIND,
    schemaVersion: 1,
    repository: REPOSITORY,
    workflow: WORKFLOW,
    sourceSha,
    contextSha256: source.contextSha256,
    bootstrap: bootstrapIdentity,
    visibility,
    activeRunCount: active.length,
    activeRunStateSha256: sha256(canonicalJson(active)),
    successfulReleaseCount: successfulReleases.length,
    successfulReleaseSetSha256: sha256(
      canonicalJson(
        successfulReleases
          .map((run) => ({
            id: String(run.id),
            attempt: String(run.run_attempt),
            updatedAt: run.updated_at,
          }))
          .sort((left, right) => left.id.localeCompare(right.id)),
      ),
    ),
    status: blockers.length === 0 ? "ready" : "blocked",
    blockers,
    retention: dispatchRetention(),
    scope: {
      currentMainVerified: true,
      bootstrapRunVerified: true,
      anonymousVisibilityOnly: true,
      packageVisibilityChanged: false,
      dispatchAllowed: blockers.length === 0,
      externalReleaseAccepted: false,
      s1Complete: false,
    },
  };
  const preview = { ...content, contentSha256: sha256(canonicalJson(content)) };
  const errors = validateSandboxExternalReleaseDispatchPreview(preview);
  if (errors.length > 0) {
    throw new Error(
      `Sandbox release dispatch preview is invalid: ${errors.join("; ")}`,
    );
  }
  return { repoRoot, preview };
}

function createReleaseDispatchResult(
  preview,
  status,
  outcomeCode,
  workflowRunId = null,
  workflowRunAttempt = null,
  runStatus = null,
) {
  const content = {
    kind: SANDBOX_RELEASE_DISPATCH_RESULT_KIND,
    schemaVersion: 1,
    repository: REPOSITORY,
    workflow: WORKFLOW,
    sourceSha: preview.sourceSha,
    workflowRunId,
    workflowRunAttempt,
    runStatus,
    status,
    outcomeCode,
    previewSha256: preview.contentSha256,
    visibilityEvidenceSha256: preview.visibility.evidenceSha256,
    retention: dispatchRetention(),
    scope: {
      anonymousVisibilityVerified: true,
      packageVisibilityChanged: false,
      dispatchRequested: true,
      dispatchOutcomeKnown: status === "dispatched",
      externalReleaseAccepted: false,
      s1Complete: false,
    },
  };
  const result = { ...content, contentSha256: sha256(canonicalJson(content)) };
  const errors = validateSandboxExternalReleaseDispatchResult(result, preview);
  if (errors.length > 0) {
    throw new Error(
      `Sandbox release dispatch result is invalid: ${errors.join("; ")}`,
    );
  }
  return result;
}

async function publicationRuns(runGh, cwd, mode, sourceSha) {
  const base = `repos/${REPOSITORY}/actions/workflows/${path.basename(
    WORKFLOW,
  )}/runs?event=workflow_dispatch&branch=main&per_page=100`;
  if (mode === "success") {
    const page = await githubJson(
      runGh,
      `${base}&status=success&head_sha=${sourceSha}`,
      cwd,
    );
    return validatedPublicationRunPage(page, "success");
  }
  const pages = await Promise.all(
    SANDBOX_PUBLICATION_ACTIVE_RUN_STATUSES.map(async (status) => ({
      status,
      page: await githubJson(runGh, `${base}&status=${status}`, cwd),
    })),
  );
  return pages.flatMap(({ page, status }) =>
    validatedPublicationRunPage(page, status),
  );
}

function dispatchRunId(stdout) {
  return /^https:\/\/github\.com\/Champ-X\/Napier\/actions\/runs\/([1-9][0-9]*)\s*$/u.exec(
    stdout,
  )?.[1];
}

function releaseRunMatches(run, sourceSha, workflowRunId) {
  return (
    String(run?.id ?? "") === workflowRunId &&
    positiveIntegerText(String(run?.run_attempt ?? "")) &&
    run.event === "workflow_dispatch" &&
    [...SANDBOX_PUBLICATION_ACTIVE_RUN_STATUSES, "completed"].includes(
      run.status,
    ) &&
    run.head_branch === "main" &&
    run.head_sha === sourceSha &&
    run.path === WORKFLOW &&
    run.display_title === `Sandbox OCI release @ ${sourceSha}` &&
    run.repository?.full_name === REPOSITORY &&
    run.head_repository?.full_name === REPOSITORY
  );
}

function positiveIntegerText(value) {
  return typeof value === "string" && /^[1-9][0-9]*$/u.test(value);
}
