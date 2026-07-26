import type { ReactNode } from "react";
import {
  Archive,
  Brain,
  Check,
  Clock,
  Layers,
  PenLine,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";

import type {
  MemoryCategory,
  MemoryFact,
  MemoryScope,
  ReviewMemoryRequest,
} from "@napier/contracts";

import { copy } from "./copy";

const MEMORY_CATEGORIES: MemoryCategory[] = [
  "preference",
  "context",
  "goal",
  "constraint",
  "decision",
  "identity",
  "behavior",
  "correction",
  "other",
];

export default function MemoryPanel({
  memories,
  draft,
  category,
  scope,
  reviewIntervalDays,
  supersedesMemoryId,
  consolidatesMemoryIds,
  onDraft,
  onCategory,
  onScope,
  onReviewIntervalDays,
  onSave,
  onCorrect,
  onCancelCorrection,
  onToggleConsolidation,
  onCancelConsolidation,
  onReview,
}: {
  memories: MemoryFact[];
  draft: string;
  category: MemoryCategory;
  scope: MemoryScope;
  reviewIntervalDays: number;
  supersedesMemoryId: string | undefined;
  consolidatesMemoryIds: string[];
  onDraft: (value: string) => void;
  onCategory: (value: MemoryCategory) => void;
  onScope: (value: MemoryScope) => void;
  onReviewIntervalDays: (value: number) => void;
  onSave: () => void;
  onCorrect: (memory: MemoryFact) => void;
  onCancelCorrection: () => void;
  onToggleConsolidation: (memory: MemoryFact) => void;
  onCancelConsolidation: () => void;
  onReview: (memoryId: string, action: ReviewMemoryRequest["action"]) => void;
}) {
  const correctionTarget = supersedesMemoryId
    ? memories.find((memory) => memory.id === supersedesMemoryId)
    : undefined;
  const consolidationTargets = consolidatesMemoryIds.flatMap((memoryId) => {
    const memory = memories.find((candidate) => candidate.id === memoryId);
    return memory ? [memory] : [];
  });
  const consolidationAnchor = consolidationTargets[0];
  const consolidating = consolidatesMemoryIds.length > 0;
  const proposed = memories.filter((memory) => memory.status === "proposed");
  const pendingReplacementIds = new Set(
    proposed.flatMap(memoryReplacementTargetIds),
  );
  const active = memories.filter(
    (memory) =>
      memory.status === "active" && !isMemoryReviewDueForDisplay(memory),
  );
  const stale = memories.filter(
    (memory) =>
      memory.status === "stale" || isMemoryReviewDueForDisplay(memory),
  );
  const history = memories.filter(
    (memory) => memory.status === "rejected" || memory.status === "archived",
  );
  const correctionUnchanged = correctionTarget?.content.trim() === draft.trim();
  const consolidationIncomplete =
    consolidating && consolidatesMemoryIds.length < 2;
  const scopeLocked = Boolean(correctionTarget || consolidating);
  return (
    <section
      className="panel-section memory-panel"
      aria-labelledby="memory-title"
    >
      <div className="panel-heading">
        <div>
          <span>{copy.memory.eyebrow}</span>
          <h2 id="memory-title">{copy.memory.title}</h2>
        </div>
        <span className="memory-count">
          {active.length} {copy.memory.live}
          {stale.length > 0 ? ` · ${stale.length} ${copy.memory.dueShort}` : ""}
        </span>
      </div>

      <div className="memory-compose">
        {correctionTarget ? (
          <div className="memory-correction-ticket" role="status">
            <div>
              <span>
                <PenLine size={11} aria-hidden="true" />
                {copy.memory.correction}
              </span>
              <p>{correctionTarget.content}</p>
              <code title={correctionTarget.id}>
                {shortIdentifier(correctionTarget.id)}
              </code>
            </div>
            <button type="button" onClick={onCancelCorrection}>
              <X size={11} aria-hidden="true" />
              {copy.memory.cancelReplacement}
            </button>
          </div>
        ) : null}
        {consolidating ? (
          <div
            className="memory-correction-ticket memory-consolidation-ticket"
            role="status"
          >
            <div>
              <span>
                <Layers size={11} aria-hidden="true" />
                {copy.memory.consolidation}
                <b>{consolidatesMemoryIds.length}/8</b>
              </span>
              <ol>
                {consolidationTargets.map((memory) => (
                  <li key={memory.id}>
                    <p>{memory.content}</p>
                    <button
                      type="button"
                      aria-label={`${copy.memory.removeSource}: ${memory.content}`}
                      onClick={() => onToggleConsolidation(memory)}
                    >
                      <X size={10} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ol>
            </div>
            <button type="button" onClick={onCancelConsolidation}>
              <X size={11} aria-hidden="true" />
              {copy.memory.cancelReplacement}
            </button>
          </div>
        ) : null}
        <textarea
          rows={4}
          value={draft}
          aria-label={
            correctionTarget
              ? copy.memory.correctionDraftLabel
              : consolidating
                ? copy.memory.consolidationDraftLabel
                : copy.memory.draftLabel
          }
          placeholder={
            correctionTarget
              ? copy.memory.correctionPlaceholder
              : consolidating
                ? copy.memory.consolidationPlaceholder
                : copy.memory.placeholder
          }
          onChange={(event) => onDraft(event.target.value)}
        />
        <div className="memory-compose-controls">
          <select
            aria-label={copy.memory.categoryLabel}
            value={category}
            onChange={(event) =>
              onCategory(event.target.value as MemoryCategory)
            }
          >
            {MEMORY_CATEGORIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select
            aria-label={copy.memory.scopeLabel}
            value={scope}
            disabled={scopeLocked}
            onChange={(event) => onScope(event.target.value as MemoryScope)}
          >
            <option value="workspace">{copy.memory.workspace}</option>
            <option value="agent">{copy.memory.agent}</option>
          </select>
          <label className="memory-review-interval">
            <span>{copy.memory.reviewEvery}</span>
            <span>
              <input
                type="number"
                min={1}
                max={3650}
                step={1}
                value={reviewIntervalDays}
                aria-label={copy.memory.reviewIntervalLabel}
                onChange={(event) => {
                  const value = event.currentTarget.valueAsNumber;
                  if (Number.isFinite(value)) {
                    onReviewIntervalDays(
                      Math.min(3650, Math.max(1, Math.round(value))),
                    );
                  }
                }}
              />
              {copy.memory.days}
            </span>
          </label>
        </div>
        {correctionTarget && correctionUnchanged ? (
          <p className="memory-compose-hint">{copy.memory.changeRequired}</p>
        ) : null}
        {consolidationIncomplete ? (
          <p className="memory-compose-hint">
            {copy.memory.consolidationNeedsSources}
          </p>
        ) : null}
        <button
          className="primary-wide"
          type="button"
          disabled={
            !draft.trim() || correctionUnchanged || consolidationIncomplete
          }
          onClick={onSave}
        >
          {correctionTarget ? (
            <PenLine size={14} aria-hidden="true" />
          ) : consolidating ? (
            <Layers size={14} aria-hidden="true" />
          ) : (
            <Brain size={14} aria-hidden="true" />
          )}
          {correctionTarget
            ? copy.memory.proposeCorrection
            : consolidating
              ? copy.memory.proposeConsolidation
              : copy.memory.add}
        </button>
      </div>

      {memories.length === 0 ? (
        <p className="empty-panel">{copy.memory.empty}</p>
      ) : null}
      <MemoryGroup title={copy.memory.proposed} count={proposed.length}>
        {proposed.map((memory) => (
          <MemoryCard
            key={memory.id}
            memory={memory}
            actions={[
              {
                label: copy.memory.approve,
                icon: <Check size={12} />,
                action: "approve",
              },
              {
                label: copy.memory.reject,
                icon: <X size={12} />,
                action: "reject",
              },
            ]}
            onReview={onReview}
          />
        ))}
      </MemoryGroup>
      <MemoryGroup title={copy.memory.active} count={active.length}>
        {active.map((memory) => (
          <MemoryCard
            key={memory.id}
            memory={memory}
            actions={[
              {
                label: copy.memory.refresh,
                icon: <RefreshCw size={12} />,
                action: "refresh",
              },
              {
                label: copy.memory.markStale,
                icon: <Clock size={12} />,
                action: "mark_stale",
              },
              {
                label: copy.memory.archive,
                icon: <Archive size={12} />,
                action: "archive",
              },
            ]}
            consolidationDisabled={isConsolidationIncompatible(
              memory,
              consolidationAnchor,
            )}
            consolidationSelected={consolidatesMemoryIds.includes(memory.id)}
            replacementPending={pendingReplacementIds.has(memory.id)}
            onCorrect={onCorrect}
            onToggleConsolidation={onToggleConsolidation}
            onReview={onReview}
          />
        ))}
      </MemoryGroup>
      <MemoryGroup title={copy.memory.stale} count={stale.length}>
        {stale.map((memory) => (
          <MemoryCard
            key={memory.id}
            memory={memory}
            reviewDue
            actions={[
              {
                label: copy.memory.refresh,
                icon: <RefreshCw size={12} />,
                action: "refresh",
              },
              ...(memory.status === "active"
                ? [
                    {
                      label: copy.memory.markStale,
                      icon: <Clock size={12} />,
                      action: "mark_stale" as const,
                    },
                  ]
                : []),
              {
                label: copy.memory.archive,
                icon: <Archive size={12} />,
                action: "archive",
              },
            ]}
            consolidationDisabled={isConsolidationIncompatible(
              memory,
              consolidationAnchor,
            )}
            consolidationSelected={consolidatesMemoryIds.includes(memory.id)}
            replacementPending={pendingReplacementIds.has(memory.id)}
            onCorrect={onCorrect}
            onToggleConsolidation={onToggleConsolidation}
            onReview={onReview}
          />
        ))}
      </MemoryGroup>
      <MemoryGroup title={copy.memory.history} count={history.length}>
        {history.map((memory) => (
          <MemoryCard
            key={memory.id}
            memory={memory}
            actions={
              memory.status === "archived" && memory.supersededByMemoryId
                ? []
                : [
                    {
                      label:
                        memory.status === "archived"
                          ? copy.memory.restore
                          : copy.memory.approve,
                      icon:
                        memory.status === "archived" ? (
                          <RotateCcw size={12} />
                        ) : (
                          <Check size={12} />
                        ),
                      action:
                        memory.status === "archived" ? "restore" : "approve",
                    },
                  ]
            }
            onReview={onReview}
          />
        ))}
      </MemoryGroup>
      <p className="guardrail-note">
        <ShieldCheck size={13} aria-hidden="true" />
        {copy.memory.safety}
      </p>
    </section>
  );
}

function MemoryGroup({
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

function MemoryCard({
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

function memoryReplacementTargetIds(memory: MemoryFact): string[] {
  return memory.supersedesMemoryId
    ? [memory.supersedesMemoryId]
    : (memory.consolidatesMemoryIds ?? []);
}

function isConsolidationIncompatible(
  memory: MemoryFact,
  anchor: MemoryFact | undefined,
): boolean {
  return Boolean(
    anchor &&
    (anchor.scope !== memory.scope || anchor.agentId !== memory.agentId),
  );
}

function isMemoryReviewDueForDisplay(memory: MemoryFact): boolean {
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
