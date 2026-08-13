import type { RunEvent } from "@napier/contracts";

import { researchSourceEventEvidence } from "./research-source-event-view";

export interface ConversationCitation {
  id: string;
  seq: number;
  createdAt: string;
  citationId: string;
  sourceId: string;
  sourceKind: "browser" | "web_fetch";
  startLine: number;
  endLine: number;
  sourceContentSha256: string;
  sourceTitleSha256: string;
  quoteSha256: string;
  claimSha256: string;
}

export interface ConversationCitationLink {
  citationId: string;
  targetId: string;
  index: number;
}

export function conversationCitations(
  events: RunEvent[],
  limit = 12,
): ConversationCitation[] {
  const citations: ConversationCitation[] = [];
  for (const event of events) {
    if (event.visibility !== "user" || event.type !== "tool.completed") {
      continue;
    }
    const payload = record(event.payload);
    const view =
      payload?.["toolName"] === "research_source" &&
      payload["status"] === "completed"
        ? researchSourceEventEvidence(payload["details"])
        : undefined;
    if (
      view?.researchSourceAction !== "cite" ||
      !view.researchCitationId ||
      !view.researchSourceId ||
      !view.researchSourceKind ||
      view.researchCitationStartLine === undefined ||
      view.researchCitationEndLine === undefined ||
      !view.researchSourceContentSha256 ||
      !view.researchSourceTitleSha256 ||
      !view.researchCitationQuoteSha256 ||
      !view.researchCitationClaimSha256
    ) {
      continue;
    }
    citations.push({
      id: event.id,
      seq: event.seq,
      createdAt: event.createdAt,
      citationId: view.researchCitationId,
      sourceId: view.researchSourceId,
      sourceKind: view.researchSourceKind,
      startLine: view.researchCitationStartLine,
      endLine: view.researchCitationEndLine,
      sourceContentSha256: view.researchSourceContentSha256,
      sourceTitleSha256: view.researchSourceTitleSha256,
      quoteSha256: view.researchCitationQuoteSha256,
      claimSha256: view.researchCitationClaimSha256,
    });
  }
  return citations.slice(-limit);
}

export function conversationCitationLinks(
  citations: readonly ConversationCitation[],
): ConversationCitationLink[] {
  return citations.map((citation, index) => ({
    citationId: citation.citationId,
    targetId: conversationCitationTargetId(citation),
    index: index + 1,
  }));
}

export function conversationCitationTargetId(
  citation: Pick<ConversationCitation, "citationId" | "seq">,
): string {
  return `conversation-citation-${citation.citationId}-${String(citation.seq)}`;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
