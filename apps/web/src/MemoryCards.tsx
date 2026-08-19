import type { ReactNode } from "react";
import { Layers, PenLine } from "lucide-react";

import type { MemoryFact, ReviewMemoryRequest } from "@napier/contracts";

import { copy } from "./copy";

export function MemoryGroup({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section className="memory-group">
      <header>
        <h3>{title}</h3>
        <span>{String(count).padStart(2, "0")}</span>
      </header>
      <div>{children}</div>
    </section>
  );
}

export function MemoryCard({
  memory,
  actions,
  reviewDue = false,
  consolidationDisabled = false,
  consolidationSelected = false,
  replacementPending = false,
  onCorrect,
  onToggleConsolidation,
  onReview,
}: {
  memory: MemoryFact;
  actions: Array<{
    label: string;
    icon: ReactNode;
    action: ReviewMemoryRequest["action"];
  }>;
  reviewDue?: boolean;
  consolidationDisabled?: boolean;
  consolidationSelected?: boolean;
  replacementPending?: boolean;
  onCorrect?: (memory: MemoryFact) => void;
  onToggleConsolidation?: (memory: MemoryFact) => void;
  onReview: (memoryId: string, action: ReviewMemoryRequest["action"]) => void;
}) {
  return (
    <article
      className={`memory-card memory-${memory.status}${reviewDue ? " memory-review-due" : ""}${consolidationSelected ? " memory-consolidation-selected" : ""}`}
    >
      <div className="memory-card-meta">
        <span>{memory.category}</span>
        <span>{memory.scope}</span>
        <span>{Math.round(memory.confidence * 100)}%</span>
        {replacementPending ? (
          <span>{copy.memory.pendingReplacement}</span>
        ) : null}
      </div>
      <p>{memory.content}</p>
      <dl className="memory-evidence">
        <div>
          <dt>{copy.memory.review}</dt>
          <dd>
            {memory.reviewDueAt
              ? formatDate(memory.reviewDueAt)
              : copy.memory.notScheduled}
          </dd>
        </div>
        <div>
          <dt>{copy.memory.uses}</dt>
          <dd>{memory.useCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>{copy.memory.lastUsed}</dt>
          <dd>
            {memory.lastUsedAt
              ? formatDate(memory.lastUsedAt)
              : copy.memory.never}
          </dd>
        </div>
      </dl>
      {memoryReplacementTargetIds(memory).length > 0 ||
      memory.supersededByMemoryId ? (
        <div className="memory-relation">
          {memory.supersedesMemoryId ? (
            <span>
              {copy.memory.corrects}
              <code title={memory.supersedesMemoryId}>
                {shortIdentifier(memory.supersedesMemoryId)}
              </code>
            </span>
          ) : null}
          {memory.consolidatesMemoryIds ? (
            <span>
              {copy.memory.consolidates}
              {memory.consolidatesMemoryIds.map((memoryId) => (
                <code key={memoryId} title={memoryId}>
                  {shortIdentifier(memoryId)}
                </code>
              ))}
            </span>
          ) : null}
          {memory.supersededByMemoryId ? (
            <span>
              {copy.memory.supersededBy}
              <code title={memory.supersededByMemoryId}>
                {shortIdentifier(memory.supersededByMemoryId)}
              </code>
            </span>
          ) : null}
        </div>
      ) : null}
      <footer>
        <time dateTime={memory.updatedAt}>{formatDate(memory.updatedAt)}</time>
        <div>
          {onToggleConsolidation &&
          (memory.status === "active" || memory.status === "stale") ? (
            <button
              className="memory-consolidate-button"
              type="button"
              aria-pressed={consolidationSelected}
              disabled={
                replacementPending ||
                (consolidationDisabled && !consolidationSelected)
              }
              onClick={() => onToggleConsolidation(memory)}
            >
              <Layers size={12} aria-hidden="true" />
              {consolidationSelected
                ? copy.memory.sourceSelected
                : copy.memory.consolidate}
            </button>
          ) : null}
          {onCorrect &&
          (memory.status === "active" || memory.status === "stale") ? (
            <button
              className="memory-correct-button"
              type="button"
              disabled={replacementPending}
              onClick={() => onCorrect(memory)}
            >
              <PenLine size={12} aria-hidden="true" />
              {copy.memory.correct}
            </button>
          ) : null}
          {actions.map((item) => (
            <button
              key={item.action}
              type="button"
              onClick={() => onReview(memory.id, item.action)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      </footer>
    </article>
  );
}

export function memoryReplacementTargetIds(memory: MemoryFact): string[] {
  return memory.supersedesMemoryId
    ? [memory.supersedesMemoryId]
    : (memory.consolidatesMemoryIds ?? []);
}

export function isConsolidationIncompatible(
  memory: MemoryFact,
  anchor: MemoryFact | undefined,
): boolean {
  return Boolean(
    anchor &&
    (anchor.scope !== memory.scope || anchor.agentId !== memory.agentId),
  );
}

export function isMemoryReviewDueForDisplay(memory: MemoryFact): boolean {
  return (
    memory.status === "active" &&
    Boolean(memory.reviewDueAt) &&
    Date.parse(memory.reviewDueAt!) <= Date.now()
  );
}

function shortIdentifier(value: string): string {
  return value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-5)}` : value;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}
