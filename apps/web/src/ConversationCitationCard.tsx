import { BookOpenCheck } from "lucide-react";

import {
  conversationCitationTargetId,
  type ConversationCitation,
} from "./conversation-citation-view-model";

export function ConversationCitationCard({
  citation,
  index,
}: {
  citation: ConversationCitation;
  index: number;
}) {
  return (
    <details
      id={conversationCitationTargetId(citation)}
      className="conversation-citation"
    >
      <summary>
        <BookOpenCheck size={15} aria-hidden="true" />
        <div>
          <span>Citation {index}</span>
          <strong>
            {citation.sourceKind === "web_fetch"
              ? "Web source evidence"
              : "Browser source evidence"}
          </strong>
        </div>
        <time dateTime={citation.createdAt}>{formatTime(citation.createdAt)}</time>
      </summary>
      <dl>
        <div>
          <dt>Source</dt>
          <dd>{shortId(citation.sourceId)}</dd>
        </div>
        <div>
          <dt>Lines</dt>
          <dd>
            {citation.startLine}–{citation.endLine}
          </dd>
        </div>
        <div>
          <dt>Capture</dt>
          <dd title={citation.sourceContentSha256}>
            {citation.sourceContentSha256.slice(0, 12)}
          </dd>
        </div>
        <div>
          <dt>Title</dt>
          <dd title={citation.sourceTitleSha256}>
            {citation.sourceTitleSha256.slice(0, 12)}
          </dd>
        </div>
        <div>
          <dt>Quote</dt>
          <dd title={citation.quoteSha256}>{citation.quoteSha256.slice(0, 12)}</dd>
        </div>
        <div>
          <dt>Claim</dt>
          <dd title={citation.claimSha256}>{citation.claimSha256.slice(0, 12)}</dd>
        </div>
      </dl>
      <p>
        Evidence binding only — source authority and claim sufficiency still
        require review.
      </p>
    </details>
  );
}

function shortId(value: string): string {
  return value.length > 20
    ? `${value.slice(0, 10)}…${value.slice(-6)}`
    : value;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
