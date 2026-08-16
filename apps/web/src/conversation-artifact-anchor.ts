export interface ConversationArtifactAnchorBinding {
  threadId: string;
  runId: string;
  planId: string;
  artifactId: string;
  eventSeq: number;
}

const ARTIFACT_ANCHOR_NAMESPACE = "conversation-artifact-";
const ARTIFACT_ANCHOR_PREFIX = `${ARTIFACT_ANCHOR_NAMESPACE}v1-`;

export function conversationArtifactAnchorId(
  binding: ConversationArtifactAnchorBinding,
): string {
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      binding.threadId,
      binding.runId,
      binding.planId,
      binding.artifactId,
      binding.eventSeq,
    ]),
  );
  return `${ARTIFACT_ANCHOR_PREFIX}${btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")}`;
}

export function clearInvalidConversationArtifactAnchor(
  validTargetIds: ReadonlySet<string>,
  location: Pick<Location, "href"> = window.location,
  history: Pick<History, "replaceState"> = window.history,
): boolean {
  const url = new URL(location.href);
  const targetId = url.hash.slice(1);
  if (
    !targetId.startsWith(ARTIFACT_ANCHOR_NAMESPACE) ||
    validTargetIds.has(targetId)
  ) {
    return false;
  }
  history.replaceState(null, "", `${url.pathname}${url.search}`);
  return true;
}
