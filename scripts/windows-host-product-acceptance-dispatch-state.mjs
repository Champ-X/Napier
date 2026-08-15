export const WINDOWS_ACCEPTANCE_RUNNER_LABELS = [
  "windows-2025",
];
export const WINDOWS_ACCEPTANCE_ACTIVE_RUN_STATUSES = [
  "requested",
  "waiting",
  "pending",
  "queued",
  "in_progress",
];

export function validatedWindowsRunnerState(value) {
  if (
    !record(value) ||
    !Number.isSafeInteger(value.total_count) ||
    value.total_count < 0 ||
    value.total_count > 100 ||
    !Array.isArray(value.runners) ||
    value.runners.length !== value.total_count
  ) {
    throw new Error("Windows acceptance runner response is invalid");
  }
  const matching = value.runners
    .map((runner) => runnerProjection(runner))
    .filter((runner) =>
      WINDOWS_ACCEPTANCE_RUNNER_LABELS.every((label) =>
        runner.labels.includes(label),
      ),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(matching.map((runner) => runner.id)).size !== matching.length) {
    throw new Error("Windows acceptance runner identity is duplicated");
  }
  const online = matching.filter((runner) => runner.status === "online");
  return {
    matching,
    online,
    idle: online.filter((runner) => runner.busy === false),
  };
}

export function validatedWindowsRunState(value, expected) {
  if (
    !record(value) ||
    !Number.isSafeInteger(value.total_count) ||
    value.total_count < 0 ||
    value.total_count > 100 ||
    !Array.isArray(value.workflow_runs) ||
    value.workflow_runs.length !== value.total_count
  ) {
    throw new Error("Windows acceptance workflow runs response is invalid");
  }
  const all = value.workflow_runs.map((run) => {
    if (
      !positiveIntegerText(String(run?.id ?? "")) ||
      !positiveIntegerText(String(run?.run_attempt ?? "")) ||
      !WINDOWS_ACCEPTANCE_ACTIVE_RUN_STATUSES.includes(run?.status) ||
      run.event !== "workflow_dispatch" ||
      run.head_branch !== "main" ||
      !/^[a-f0-9]{40}$/u.test(run.head_sha ?? "") ||
      run.path !== expected.workflow ||
      run.repository?.full_name !== expected.repository ||
      run.head_repository?.full_name !== expected.repository
    ) {
      throw new Error("Windows acceptance workflow run identity is invalid");
    }
    return run;
  });
  if (new Set(all.map((run) => String(run.id))).size !== all.length) {
    throw new Error("Windows acceptance workflow run identity is duplicated");
  }
  const active = all
    .filter((run) => run.status !== "completed")
    .map((run) => ({
      id: String(run.id),
      status: run.status,
      headSha: String(run.head_sha ?? ""),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return { all, active };
}

export function windowsActiveRunPage(value, expectedStatus) {
  if (
    !record(value) ||
    !Number.isSafeInteger(value.total_count) ||
    value.total_count < 0 ||
    value.total_count > 100 ||
    !Array.isArray(value.workflow_runs) ||
    value.workflow_runs.length !== value.total_count
  ) {
    throw new Error("Windows acceptance active run response is invalid");
  }
  if (
    !WINDOWS_ACCEPTANCE_ACTIVE_RUN_STATUSES.includes(expectedStatus) ||
    value.workflow_runs.some((run) => run?.status !== expectedStatus)
  ) {
    throw new Error("Windows acceptance active run status is invalid");
  }
  return value.workflow_runs;
}

function runnerProjection(value) {
  const id = String(value?.id ?? "");
  const labels = Array.isArray(value?.labels)
    ? value.labels
        .map((label) => String(label?.name ?? ""))
        .filter(Boolean)
        .sort()
    : [];
  if (
    !positiveIntegerText(id) ||
    !["online", "offline"].includes(value?.status) ||
    typeof value?.busy !== "boolean" ||
    labels.length === 0 ||
    labels.length > 64 ||
    new Set(labels).size !== labels.length ||
    labels.some((label) => label.length > 100)
  ) {
    throw new Error("Windows acceptance runner identity is invalid");
  }
  return { id, labels, status: value.status, busy: value.busy };
}

function positiveIntegerText(value) {
  return typeof value === "string" && /^[1-9][0-9]*$/u.test(value);
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
