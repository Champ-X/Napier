import { createHash } from "node:crypto";

/** Observes ordering and exact request reuse, not whether an inline command is
 * a good test or an assertion follows the specification. No raw code is emitted.
 * Callers supply one Run's ledger events and a hash-validating capsule store. */
export async function collectVerificationProtocolEvidence(
  sourceEvents,
  capsules,
  protocolText,
) {
  const events = [...sourceEvents].sort((a, b) => a.seq - b.seq);
  if (new Set(events.map((event) => event.runId).filter(Boolean)).size > 1)
    throw new Error("Verification protocol evidence requires one Run");
  const firstPatch = events.find(
    (event) =>
      event.type === "tool.started" && event.payload.toolName === "apply_patch",
  );
  const calls = new Map(
    events
      .filter(
        (event) =>
          event.type === "tool.started" &&
          ["run_command", "verify_workspace"].includes(event.payload.toolName),
      )
      .map((event) => [
        `${event.runId}:${event.payload.callId}`,
        {
          runId: event.runId,
          callId: event.payload.callId,
          toolName: event.payload.toolName,
          startedEventId: event.id,
          startedSeq: event.seq,
          phase: firstPatch
            ? event.seq < firstPatch.seq
              ? "before_first_patch"
              : "after_first_patch"
            : "no_patch_observed",
          requestSha256: null,
          classification: "unknown",
          status: "unsettled",
          exitCode: null,
        },
      ]),
  );
  for (const event of events) {
    const call = calls.get(`${event.runId}:${event.payload?.callId}`);
    if (
      call &&
      ["tool.completed", "tool.failed", "tool.blocked"].includes(event.type)
    ) {
      call.status = event.type.slice(5);
      call.settledEventId = event.id;
      call.settledSeq = event.seq;
      call.exitCode =
        typeof event.payload.details?.exitCode === "number"
          ? event.payload.details.exitCode
          : null;
      call.verificationStatus =
        typeof event.payload.details?.status === "string"
          ? event.payload.details.status
          : null;
    }
  }
  let unavailableCapsules = 0;
  const invocations = [];
  for (const event of events.filter(
    (event) =>
      event.type === "context.model_invocation" &&
      event.payload.purpose === "agent_turn",
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
    )
      throw new Error(
        "Verification protocol evidence belongs to a different invocation",
      );
    invocations.push({
      eventId: event.id,
      capsuleSha256: event.payload.capsuleSha256,
      protocolPresent: Boolean(
        protocolText && capsule.context.systemPrompt?.includes(protocolText),
      ),
    });
    for (const message of capsule.context.messages) {
      if (message.role !== "assistant") continue;
      for (const item of message.content) {
        if (item.type !== "toolCall") continue;
        const call = calls.get(`${capsule.sourceRunId}:${item.id}`);
        if (!call || item.name !== call.toolName) continue;
        const requestSha256 = digest(item.arguments);
        if (call.requestSha256 && call.requestSha256 !== requestSha256)
          throw new Error("Verification request changed across capsules");
        call.requestSha256 = requestSha256;
        call.sourceCapsuleSha256 = event.payload.capsuleSha256;
        call.classification = classify(call.toolName, item.arguments);
      }
    }
  }
  const executions = [...calls.values()].map((call) => ({
    ...call,
    settledBeforeFirstPatch: Boolean(
      firstPatch &&
      call.settledSeq !== undefined &&
      call.settledSeq < firstPatch.seq,
    ),
  }));
  const reusedRequests = executions
    .filter((call) => call.phase === "before_first_patch" && call.requestSha256)
    .map((before) => ({
      beforeCallId: before.callId,
      requestSha256: before.requestSha256,
      afterCallIds: executions
        .filter(
          (after) =>
            after.phase === "after_first_patch" &&
            after.requestSha256 === before.requestSha256,
        )
        .map((after) => after.callId),
    }))
    .filter((pair) => pair.afterCallIds.length > 0);
  return {
    firstPatchStartEventId: firstPatch?.id ?? null,
    firstPatchStartSeq: firstPatch?.seq ?? null,
    protocolSha256: protocolText
      ? createHash("sha256").update(protocolText).digest("hex")
      : null,
    invocations,
    executions,
    reusedRequests,
    unavailableCapsules,
    complete:
      unavailableCapsules === 0 &&
      executions.every((call) => call.requestSha256 !== null),
    scope:
      "Chronology relative to first observed apply_patch request and byte-identical argument reuse. Other mutation paths may exist. Inline commands are not automatically classified as tests; passing executions do not establish oracle correctness or full contract coverage.",
  };
}

function classify(toolName, args) {
  if (toolName === "verify_workspace")
    return args?.kind === "test"
      ? "explicit_test_verification"
      : "other_verification";
  if (typeof args?.code === "string") return "inline_command";
  if (
    Array.isArray(args?.args) &&
    args.args.some(
      (arg) =>
        arg === "-e" ||
        arg === "--eval" ||
        (typeof arg === "string" && arg.startsWith("--eval=")),
    )
  )
    return "inline_command";
  return "other_command";
}

function digest(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
