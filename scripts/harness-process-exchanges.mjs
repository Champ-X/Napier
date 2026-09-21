import { isDeepStrictEqual } from "node:util";

/** Reconstruct only completed calls from hash-validated request capsules. This
 * checks actual JSON input/output observations, not an Agent-authored report. */
export async function auditProcessExchanges(events, capsules, processEvidence) {
  const expected = processEvidence.requirements?.jsonExchanges;
  if (!expected) return { required: false, passed: true };
  if (
    !Array.isArray(expected) ||
    !expected.length ||
    expected.length > 16 ||
    expected.some(
      (item) =>
        !item ||
        typeof item.input !== "object" ||
        typeof item.output !== "object",
    )
  )
    throw new Error("Invalid JSON exchange acceptance");
  const calls = new Map(
    events
      .filter(
        (event) =>
          event.type === "tool.completed" &&
          event.payload.toolName === "workspace_process",
      )
      .map((event) => [event.payload.callId, { event }]),
  );
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
      throw new Error("Process evidence invocation binding differs");
    for (const message of capsule.context.messages) {
      if (message.role === "assistant") {
        for (const part of message.content) {
          const record = calls.get(part.id);
          if (
            part.type !== "toolCall" ||
            part.name !== "workspace_process" ||
            !record ||
            record.event.runId !== capsule.sourceRunId
          )
            continue;
          if (record.args && !isDeepStrictEqual(record.args, part.arguments))
            throw new Error(
              "Process arguments changed across invocation capsules",
            );
          record.args = part.arguments;
        }
      } else if (message.role === "toolResult") {
        const record = calls.get(message.toolCallId);
        if (
          !record ||
          message.isError ||
          record.event.runId !== capsule.sourceRunId
        )
          continue;
        const text = message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
        // Only output sections count; status/summary text cannot supply a reply.
        if (text.includes("\nOUTPUT\n"))
          record.output = text.split("\nOUTPUT\n").slice(1).join("\nOUTPUT\n");
      }
    }
  }
  const matched = [];
  for (const processId of processEvidence.matchingProcessIds) {
    const records = [...calls.values()].filter(
      (record) => record.event.payload.details?.processId === processId,
    );
    const inputs = records
      .filter(
        (record) =>
          record.args?.action === "input" &&
          record.args.processId === processId,
      )
      .map((record) => {
        const raw = record.args.text + (record.args.appendNewline ? "\n" : "");
        return {
          record,
          value: raw.endsWith("\n") ? parseJson(raw) : undefined,
        };
      });
    const outputs = records
      .filter(
        (record) =>
          record.args?.action === "poll" &&
          record.args.processId === processId &&
          record.output,
      )
      .flatMap((record) =>
        record.output
          .split("\n")
          .map((line) => ({ record, value: parseJson(line) })),
      );
    const usedInputs = new Set();
    const complete = expected.every((exchange) => {
      const input = inputs.find(
        (item) =>
          !usedInputs.has(item.record) &&
          isDeepStrictEqual(item.value, exchange.input),
      );
      if (
        !input ||
        !outputs.some(
          (item) =>
            item.record.event.seq > input.record.event.seq &&
            isDeepStrictEqual(item.value, exchange.output),
        )
      )
        return false;
      usedInputs.add(input.record);
      return true;
    });
    if (complete) matched.push(processId);
  }
  return {
    required: true,
    expectedExchanges: expected.length,
    matchedProcessIds: matched,
    unavailableCapsules,
    passed: matched.length > 0,
  };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
