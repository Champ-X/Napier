import {
  Archive,
  Check,
  Clock,
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
import { MemoryComposer } from "./MemoryComposer";
import {
  isConsolidationIncompatible,
  isMemoryReviewDueForDisplay,
  MemoryCard,
  MemoryGroup,
  memoryReplacementTargetIds,
} from "./MemoryCards";

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

      <MemoryComposer
        draft={draft}
        category={category}
        scope={scope}
        reviewIntervalDays={reviewIntervalDays}
        correctionTarget={correctionTarget}
        consolidationTargets={consolidationTargets}
        correctionUnchanged={correctionUnchanged}
        consolidationIncomplete={consolidationIncomplete}
        scopeLocked={scopeLocked}
        onDraft={onDraft}
        onCategory={onCategory}
        onScope={onScope}
        onReviewIntervalDays={onReviewIntervalDays}
        onSave={onSave}
        onCancelCorrection={onCancelCorrection}
        onToggleConsolidation={onToggleConsolidation}
        onCancelConsolidation={onCancelConsolidation}
      />
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
