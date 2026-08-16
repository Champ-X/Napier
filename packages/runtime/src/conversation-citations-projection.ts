import type { RunEvent, ThreadDetail } from "@napier/contracts";
import {
  parseResearchSourceEvidenceV1,
  type ResearchSourceEvidenceV1,
} from "@napier/contracts/skill-load";

export type ConversationCitation = NonNullable<
  ThreadDetail["citations"]
>[number];

const MAX_CITATIONS = 12;

export function applyConversationCitation(
  citations: ConversationCitation[],
  event: RunEvent,
): ConversationCitation[] {
  const citation = conversationCitation(event);
  if (!citation) return citations;
  return [...citations, citation].slice(-MAX_CITATIONS);
}

export function projectConversationCitations(
  events: readonly RunEvent[],
): ConversationCitation[] {
  return events.reduce(applyConversationCitation, []);
}

function conversationCitation(
  event: RunEvent,
): ConversationCitation | undefined {
  if (
    event.visibility !== "user" ||
    event.type !== "tool.completed" ||
    !record(event.payload) ||
    event.payload["toolName"] !== "research_source" ||
    event.payload["status"] !== "completed" ||
    typeof event.payload["callId"] !== "string"
  ) {
    return undefined;
  }
  const evidence = parseResearchSourceEvidenceV1(event.payload["details"]);
  if (!citationEvidence(evidence)) return undefined;
  return {
    id: event.id,
    seq: event.seq,
    createdAt: event.createdAt,
    callId: event.payload["callId"],
    citationId: evidence.citationId,
    sourceId: evidence.sourceId,
    sourceKind: evidence.sourceKind,
    startLine: evidence.citationStartLine,
    endLine: evidence.citationEndLine,
    sourceContentSha256: evidence.sourceContentSha256,
    sourceTitleSha256: evidence.sourceTitleSha256,
    quoteSha256: evidence.citationQuoteSha256,
    claimSha256: evidence.citationClaimSha256,
  };
}

function citationEvidence(
  value: ResearchSourceEvidenceV1 | undefined,
): value is Extract<ResearchSourceEvidenceV1, { action: "cite" }> {
  return value?.action === "cite";
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
