import type { Context, Message } from "@earendil-works/pi-ai";

const snapshotSources = new WeakMap<Message, Message>();

/** Process-local clone provenance, never a claim inferred from message text. */
export function modelContextMessageSource(message: Message): Message {
  return snapshotSources.get(message) ?? message;
}

/** The caller has just cloned the complete ordered Context. Keep a direct link
 * to each original message, including when cloning an existing snapshot. */
export function preserveModelContextSnapshotSource(
  source: Context,
  snapshot: Context,
): Context {
  snapshot.messages.forEach((message, index) => {
    const original = source.messages[index];
    if (original) snapshotSources.set(message, modelContextMessageSource(original));
  });
  return snapshot;
}
