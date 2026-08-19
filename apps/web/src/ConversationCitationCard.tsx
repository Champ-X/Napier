import { BookOpenCheck } from "lucide-react";

import {
  conversationCitationTargetId,
  type ConversationCitation,
} from "./conversation-citation-view-model";
import { conversationDetailCopy } from "./conversation-detail-copy";
import { getLocale } from "./locale";

export interface ConversationCitationCardProps {
  citation: ConversationCitation;
  index: number;
}

export function ConversationCitationCard({
  citation,
  index,
}: ConversationCitationCardProps) {
  const copy = conversationDetailCopy.citation;
  return (
    <details
      id={conversationCitationTargetId(citation)}
      className="conversation-citation"
    >
      <summary>
        <BookOpenCheck size={15} aria-hidden="true" />
        <div>
          <span>
            {copy.label} {formatNumber(index)}
          </span>
          <strong>
            {citation.sourceKind === "web_fetch"
              ? copy.webEvidence
              : copy.browserEvidence}
          </strong>
        </div>
        <time dateTime={citation.createdAt}>
          {formatTime(citation.createdAt)}
        </time>
      </summary>
      <dl>
        <div>
          <dt>{copy.source}</dt>
          <dd>{shortId(citation.sourceId)}</dd>
        </div>
        <div>
          <dt>{copy.lines}</dt>
          <dd>
            {citation.startLine}–{citation.endLine}
          </dd>
        </div>
        <div>
          <dt>{copy.capture}</dt>
          <dd title={citation.sourceContentSha256}>
            {citation.sourceContentSha256.slice(0, 12)}
          </dd>
        </div>
        <div>
          <dt>{copy.title}</dt>
          <dd title={citation.sourceTitleSha256}>
            {citation.sourceTitleSha256.slice(0, 12)}
          </dd>
        </div>
        <div>
          <dt>{copy.quote}</dt>
          <dd title={citation.quoteSha256}>
            {citation.quoteSha256.slice(0, 12)}
          </dd>
        </div>
        <div>
          <dt>{copy.claim}</dt>
          <dd title={citation.claimSha256}>
            {citation.claimSha256.slice(0, 12)}
          </dd>
        </div>
      </dl>
      <p>{copy.guidance}</p>
    </details>
  );
}

function shortId(value: string): string {
  return value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(getLocale() === "zh" ? "zh-CN" : "en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(getLocale() === "zh" ? "zh-CN" : "en").format(
    value,
  );
}
