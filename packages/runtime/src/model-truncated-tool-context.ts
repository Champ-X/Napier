import type { Context } from "@earendil-works/pi-ai";

/** Use the provider terminal state, not diagnostic words inside tool data. */
export function redirectTruncatedToolContext(context: Context): Context {
  const index = context.messages.findLastIndex(
    (message) => message.role === "assistant",
  );
  const message = context.messages[index];
  if (message?.role !== "assistant" || message.stopReason !== "length")
    return context;
  const calls = message.content.filter((block) => block.type === "toolCall");
  const following = context.messages.slice(index + 1);
  if (!calls.length || following.some((entry) => entry.role !== "toolResult"))
    return context;
  if (
    !calls.every((call) =>
      following.some(
        (entry) =>
          entry.role === "toolResult" &&
          entry.toolCallId === call.id &&
          entry.isError,
      ),
    )
  )
    return context;
  return {
    ...context,
    messages: [
      ...context.messages,
      {
        role: "user",
        timestamp: Date.now(),
        content:
          "Internal output-limit recovery: the previous response ended at its output limit and its tool calls were rejected before execution. Do not resend the same oversized arguments. Make one smaller complete tool call. For files, create a small coherent section and extend it with bounded edits using each successful write's returned SHA-256. No rejected write established a new file state; preserve existing preconditions and permissions.",
      },
    ],
  };
}
