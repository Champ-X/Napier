/** Evaluate the Agent's process state before campaign cleanup. Tool completion
 * alone does not prove a whole interactive lifecycle on the same process. Never
 * retain raw stdin/stdout or infer Python use from the requested policy. */
export function collectProcessEvidence(events, sessions, requirements) {
  const allowed = new Set([
    "start",
    "start_write",
    "input",
    "poll",
    "cancel",
    "resize",
  ]);
  const required = requirements?.requiredActions ?? {};
  for (const [action, count] of Object.entries(required)) {
    if (!allowed.has(action) || !Number.isSafeInteger(count) || count < 1)
      throw new Error("Invalid process acceptance action/count");
  }
  if (requirements && typeof requirements.noRunningSessions !== "boolean")
    throw new Error("Process acceptance must specify noRunningSessions");
  const calls = new Set();
  const records = sessions.map((session) => ({
    processId: session.id,
    runId: session.runId,
    runtime: session.runtime,
    status: session.status,
    actions: {},
  }));
  for (const event of events) {
    if (
      event.type !== "tool.completed" ||
      event.payload.toolName !== "workspace_process"
    )
      continue;
    const { callId, details } = event.payload;
    if (!callId || calls.has(callId) || !allowed.has(details?.action)) continue;
    const record = records.find(
      (item) =>
        item.processId === details.processId && item.runId === event.runId,
    );
    if (!record) continue;
    calls.add(callId);
    record.actions[details.action] = (record.actions[details.action] ?? 0) + 1;
  }
  const runningSessions = records.filter(
    (item) => item.status === "running",
  ).length;
  const matchingProcessIds = records
    .filter((record) =>
      Object.entries(required).every(
        ([action, count]) => (record.actions[action] ?? 0) >= count,
      ),
    )
    .map((record) => record.processId);
  return {
    observedBeforeCleanup: true,
    sessions: records,
    runningSessions,
    matchingProcessIds,
    requirements: requirements ?? null,
    passed:
      !requirements ||
      (matchingProcessIds.length > 0 &&
        (!requirements.noRunningSessions || runningSessions === 0)),
  };
}
