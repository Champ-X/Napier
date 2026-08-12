export const SANDBOX_PUBLICATION_ACTIVE_RUN_STATUSES = [
  "requested",
  "waiting",
  "pending",
  "queued",
  "in_progress",
];

export function validatedPublicationRunPage(value, expectedStatus) {
  if (
    !record(value) ||
    !Number.isSafeInteger(value.total_count) ||
    value.total_count < 0 ||
    value.total_count > 10_000 ||
    (expectedStatus === "success" && value.total_count > 100) ||
    !Array.isArray(value.workflow_runs) ||
    value.workflow_runs.length > 100 ||
    value.workflow_runs.length !== Math.min(value.total_count, 100)
  ) {
    throw new Error("Sandbox publication run response is invalid");
  }
  if (
    expectedStatus !== "success" &&
    !SANDBOX_PUBLICATION_ACTIVE_RUN_STATUSES.includes(expectedStatus)
  ) {
    throw new Error("Sandbox publication run status query is invalid");
  }
  for (const run of value.workflow_runs) {
    if (
      !positiveIntegerText(String(run?.id ?? "")) ||
      !positiveIntegerText(String(run?.run_attempt ?? "")) ||
      run.event !== "workflow_dispatch" ||
      run.head_branch !== "main" ||
      !/^[a-f0-9]{40}$/u.test(run.head_sha ?? "") ||
      run.path !== ".github/workflows/publish-sandbox.yml" ||
      run.repository?.full_name !== "Champ-X/Napier" ||
      run.head_repository?.full_name !== "Champ-X/Napier" ||
      typeof run.display_title !== "string" ||
      run.display_title.length < 1 ||
      run.display_title.length > 200 ||
      !validTimestamp(run.updated_at) ||
      (expectedStatus === "success"
        ? run.status !== "completed" || run.conclusion !== "success"
        : run.status !== expectedStatus)
    ) {
      throw new Error("Sandbox publication run identity is invalid");
    }
  }
  if (
    new Set(value.workflow_runs.map((run) => String(run.id))).size !==
    value.workflow_runs.length
  ) {
    throw new Error("Sandbox publication run identity is duplicated");
  }
  return value.workflow_runs;
}

export function requireBootstrapRun(run, sourceSha, runId) {
  if (
    String(run?.id ?? "") !== runId ||
    !positiveIntegerText(String(run?.run_attempt ?? "")) ||
    run.event !== "workflow_dispatch" ||
    run.status !== "completed" ||
    run.conclusion !== "success" ||
    run.head_branch !== "main" ||
    run.head_sha !== sourceSha ||
    run.path !== ".github/workflows/publish-sandbox.yml" ||
    run.display_title !== `Sandbox OCI bootstrap @ ${sourceSha}` ||
    run.repository?.full_name !== "Champ-X/Napier" ||
    run.head_repository?.full_name !== "Champ-X/Napier" ||
    !validTimestamp(run.updated_at)
  ) {
    throw new Error("Sandbox bootstrap run identity is invalid");
  }
  return {
    workflowRunId: runId,
    workflowRunAttempt: String(run.run_attempt),
    updatedAt: new Date(run.updated_at).toISOString(),
  };
}

export function activePublicationProjection(runs) {
  return runs
    .map((run) => ({
      id: String(run.id),
      status: run.status,
      headSha: run.head_sha,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function positiveIntegerText(value) {
  return typeof value === "string" && /^[1-9][0-9]*$/u.test(value);
}

function validTimestamp(value) {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    /^[0-9]{4}-[0-9]{2}-[0-9]{2}T/u.test(value)
  );
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
