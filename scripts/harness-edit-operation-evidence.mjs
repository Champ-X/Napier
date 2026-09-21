/** Read only hash-validated invocation capsules through the supplied store.
 * Write-tool ledger arguments are redacted; missing arguments are unknown,
 * never evidence that a model used the requested edit format. */
export async function collectEditOperationEvidence(events, capsules) {
  const calls = new Map(
    events
      .filter(
        (event) =>
          event.type === "tool.started" &&
          event.payload.toolName === "apply_patch",
      )
      .map((event) => [
        event.payload.callId,
        {
          callId: event.payload.callId,
          runId: event.runId,
          operation: "unknown",
          status: "unknown",
        },
      ]),
  );
  for (const event of events) {
    if (
      ["tool.completed", "tool.failed", "tool.blocked"].includes(event.type) &&
      calls.has(event.payload.callId)
    )
      calls.get(event.payload.callId).status = event.type.slice(5);
  }
  let unavailableCapsules = 0;
  for (const event of events.filter(
    (event) => event.type === "context.model_invocation",
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
        "Edit format evidence is bound to a different invocation",
      );
    for (const message of capsule.context.messages) {
      if (message.role !== "assistant") continue;
      for (const call of message.content) {
        if (
          call.type !== "toolCall" ||
          call.name !== "apply_patch" ||
          !calls.has(call.id)
        )
          continue;
        const record = calls.get(call.id);
        if (
          record.runId !== capsule.sourceRunId ||
          typeof call.arguments?.operation !== "string"
        )
          continue;
        if (
          record.operation !== "unknown" &&
          record.operation !== call.arguments.operation
        )
          throw new Error("Edit format changed across invocation capsules");
        record.operation = call.arguments.operation;
        record.sourceCapsuleSha256 = event.payload.capsuleSha256;
      }
    }
  }
  return {
    operations: [...calls.values()],
    unavailableCapsules,
    complete: [...calls.values()].every((call) => call.operation !== "unknown"),
  };
}
