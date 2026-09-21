const actions = new Set([
  "launch",
  "stack_trace",
  "scopes",
  "variables",
  "evaluate",
  "continue",
  "next",
  "step_in",
  "step_out",
  "cancel",
]);
export function assertDebuggerAcceptance(requirements) {
  if (requirements === undefined) return;
  if (
    !requirements ||
    requirements.runtime !== "python" ||
    typeof requirements.sourcePath !== "string" ||
    !requirements.sourcePath ||
    !Array.isArray(requirements.requiredActions) ||
    requirements.requiredActions.length < 1 ||
    requirements.requiredActions.some((a) => !actions.has(a)) ||
    !Number.isSafeInteger(requirements.breakpointLine) ||
    requirements.breakpointLine < 1 ||
    !requirements.variables ||
    typeof requirements.variables !== "object" ||
    Array.isArray(requirements.variables) ||
    Object.entries(requirements.variables).length < 1 ||
    Object.entries(requirements.variables).some(
      ([k, v]) => !k || typeof v !== "string",
    ) ||
    typeof requirements.evaluation?.expression !== "string" ||
    !requirements.evaluation.expression ||
    typeof requirements.evaluation?.result !== "string"
  )
    throw new Error("Invalid debugger acceptance requirements");
}

/** Require actual hash-bound DAP observations on the original source and one
 * process. Neither the final report nor a completed tool name proves debugging. */
export async function collectDebuggerEvidence(
  events,
  capsules,
  requirements,
  sourceHashes,
  hashes,
) {
  assertDebuggerAcceptance(requirements);
  if (!requirements) return { required: false, passed: true };
  const { canonicalJson, sha256 } = hashes;
  const reasons = new Set();
  const expectedSource = sourceHashes[requirements.sourcePath];
  if (!/^[a-f0-9]{64}$/u.test(expectedSource ?? ""))
    reasons.add("original_source_missing");
  const completed = new Map(
    events
      .filter(
        (e) =>
          e.type === "tool.completed" && e.payload.toolName === "node_debugger",
      )
      .map((e) => [e.payload.callId, e]),
  );
  const started = new Map(
    events
      .filter(
        (e) =>
          e.type === "tool.started" && e.payload.toolName === "node_debugger",
      )
      .map((e) => [e.payload.callId, e]),
  );
  const inputs = new Map(),
    results = new Map();
  let unavailableCapsules = 0;
  for (const event of events.filter(
    (e) => e.type === "context.model_invocation",
  )) {
    let capsule;
    try {
      capsule = await capsules.read(event.payload.capsuleSha256);
    } catch {
      unavailableCapsules++;
      continue;
    }
    if (
      capsule.sourceRunId !== event.runId ||
      capsule.contextEnvelopeSha256 !== event.payload.contextEnvelopeSha256
    ) {
      reasons.add("capsule_binding_mismatch");
      continue;
    }
    for (const message of capsule.context.messages) {
      if (message.role === "assistant") {
        for (const call of message.content ?? []) {
          if (
            call.type !== "toolCall" ||
            call.name !== "node_debugger" ||
            !completed.has(call.id)
          )
            continue;
          if (completed.get(call.id).runId !== capsule.sourceRunId) {
            reasons.add("call_run_mismatch");
            continue;
          }
          const previous = inputs.get(call.id);
          if (
            previous &&
            canonicalJson(previous) !== canonicalJson(call.arguments)
          )
            reasons.add("conflicting_call_arguments");
          inputs.set(call.id, call.arguments);
        }
      }
      if (
        message.role !== "toolResult" ||
        message.toolName !== "node_debugger" ||
        message.isError ||
        !completed.has(message.toolCallId)
      )
        continue;
      const ledger = completed.get(message.toolCallId);
      if (ledger.runId !== capsule.sourceRunId) {
        reasons.add("result_run_mismatch");
        continue;
      }
      const text = message.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      let result;
      try {
        result = JSON.parse(text);
      } catch {
        continue;
      }
      if (result.kind !== "napier.python-debugger") continue;
      const { resultSha256, untrustedLiveData, ...body } = result;
      if (
        untrustedLiveData !== true ||
        sha256(canonicalJson(body)) !== resultSha256 ||
        ledger.payload.details?.resultSha256 !== resultSha256
      ) {
        reasons.add("result_hash_mismatch");
        continue;
      }
      const previous = results.get(message.toolCallId);
      if (previous && previous.result.resultSha256 !== resultSha256)
        reasons.add("conflicting_results");
      results.set(message.toolCallId, {
        result,
        capsuleSha256: event.payload.capsuleSha256,
        eventId: ledger.id,
        order: events.indexOf(ledger),
      });
    }
  }
  if (unavailableCapsules) reasons.add("capsules_unavailable");
  const groups = new Map();
  for (const [callId, record] of results) {
    const { result } = record;
    const input = inputs.get(callId);
    if (
      input?.runtime !== "python" ||
      input.action !== result.action ||
      (input.action !== "launch" && input.processId !== result.processId) ||
      started.get(callId)?.runId !== completed.get(callId).runId ||
      started.get(callId)?.payload.effect !== "write"
    ) {
      reasons.add("call_or_admission_mismatch");
      continue;
    }
    if (
      result.sourcePath !== requirements.sourcePath ||
      result.sourceSha256 !== expectedSource
    )
      continue;
    const records = groups.get(result.processId) ?? [];
    records.push({ callId, input, ...record });
    groups.set(result.processId, records);
  }
  const processes = [...groups].map(([processId, records]) => {
    const completedActions = [...new Set(records.map((r) => r.result.action))];
    const chains = observedFrameChains(records, events, requirements);
    const breakpointMatched = chains.length > 0;
    const variablesMatched = chains.some((c) => c.variablesMatched);
    const evaluationMatched = chains.some((c) => c.evaluationMatched);
    const sameFrameMatched = chains.some(
      (c) => c.variablesMatched && c.evaluationMatched,
    );
    const actionsMatched = requirements.requiredActions.every((a) =>
      completedActions.includes(a),
    );
    return {
      processId,
      completedActions,
      variablesMatched,
      breakpointMatched,
      evaluationMatched,
      actionsMatched,
      sameFrameMatched,
      passed: sameFrameMatched && actionsMatched,
      observations: records.map(
        ({ callId, result, eventId, capsuleSha256 }) => ({
          callId,
          eventId,
          capsuleSha256,
          action: result.action,
          resultSha256: result.resultSha256,
          sourceSha256: result.sourceSha256,
          isolation: result.isolation,
        }),
      ),
    };
  });
  if (!processes.some((p) => p.passed))
    reasons.add("required_observations_missing");
  return {
    required: true,
    originalSourceSha256: expectedSource ?? null,
    unavailableCapsules,
    processes,
    reasons: [...reasons],
    passed: reasons.size === 0,
  };
}

function observedFrameChains(records, events, requirements) {
  const barriers = new Set([
    "launch",
    "continue",
    "next",
    "step_in",
    "step_out",
    "cancel",
  ]);
  const chains = [];
  for (const stack of records.filter(
    (r) => r.result.action === "stack_trace",
  )) {
    const boundary = events.findIndex(
      (event, index) =>
        index > stack.order &&
        event.type === "tool.completed" &&
        event.payload.toolName === "node_debugger" &&
        event.payload.details?.processId === stack.result.processId &&
        barriers.has(event.payload.details?.action),
    );
    const later = records.filter(
      (r) => r.order > stack.order && (boundary < 0 || r.order < boundary),
    );
    for (const frame of stack.result.data?.stackFrames ?? []) {
      if (frame.line !== requirements.breakpointLine) continue;
      const scopes = later.filter(
        (r) => r.result.action === "scopes" && r.input.frameId === frame.id,
      );
      const variables = scopes.flatMap((scope) => {
        const references = (scope.result.data?.scopes ?? [])
          .filter((s) => s.name === "Locals")
          .map((s) => s.variablesReference);
        return later
          .filter(
            (r) =>
              r.order > scope.order &&
              r.result.action === "variables" &&
              references.includes(r.input.variablesReference),
          )
          .flatMap((r) => r.result.data?.variables ?? []);
      });
      chains.push({
        variablesMatched: Object.entries(requirements.variables).every(
          ([name, value]) =>
            variables.some((v) => v.name === name && v.value === value),
        ),
        evaluationMatched: later.some(
          (r) =>
            r.result.action === "evaluate" &&
            r.input.frameId === frame.id &&
            r.input.expression === requirements.evaluation.expression &&
            r.result.data?.result === requirements.evaluation.result,
        ),
      });
    }
  }
  return chains;
}
