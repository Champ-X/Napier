import { Brain, Layers, PenLine, X } from "lucide-react";

import type {
  MemoryCategory,
  MemoryFact,
  MemoryScope,
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

export interface MemoryComposerProps {
  draft: string;
  persistenceReason: string;
  differenceSummary: string;
  category: MemoryCategory;
  scope: MemoryScope;
  reviewIntervalDays: number;
  correctionTarget: MemoryFact | undefined;
  consolidationTargets: MemoryFact[];
  correctionUnchanged: boolean;
  consolidationIncomplete: boolean;
  scopeLocked: boolean;
  onDraft(value: string): void;
  onPersistenceReason(value: string): void;
  onDifferenceSummary(value: string): void;
  onCategory(value: MemoryCategory): void;
  onScope(value: MemoryScope): void;
  onReviewIntervalDays(value: number): void;
  onSave(): void;
  onCancelCorrection(): void;
  onToggleConsolidation(memory: MemoryFact): void;
  onCancelConsolidation(): void;
}

export function MemoryComposer(props: MemoryComposerProps) {
  const consolidating = props.consolidationTargets.length > 0;
  return (
    <div className="memory-compose">
      {props.correctionTarget ? (
        <div className="memory-correction-ticket" role="status">
          <div>
            <span>
              <PenLine size={11} aria-hidden="true" />
              {copy.memory.correction}
            </span>
            <p>{props.correctionTarget.content}</p>
            <code title={props.correctionTarget.id}>
              {shortIdentifier(props.correctionTarget.id)}
            </code>
          </div>
          <button type="button" onClick={props.onCancelCorrection}>
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
              <b>{props.consolidationTargets.length}/8</b>
            </span>
            <ol>
              {props.consolidationTargets.map((memory) => (
                <li key={memory.id}>
                  <p>{memory.content}</p>
                  <button
                    type="button"
                    aria-label={`${copy.memory.removeSource}: ${memory.content}`}
                    onClick={() => props.onToggleConsolidation(memory)}
                  >
                    <X size={10} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <button type="button" onClick={props.onCancelConsolidation}>
            <X size={11} aria-hidden="true" />
            {copy.memory.cancelReplacement}
          </button>
        </div>
      ) : null}
      <textarea
        rows={4}
        value={props.draft}
        aria-label={
          props.correctionTarget
            ? copy.memory.correctionDraftLabel
            : consolidating
              ? copy.memory.consolidationDraftLabel
              : copy.memory.draftLabel
        }
        placeholder={
          props.correctionTarget
            ? copy.memory.correctionPlaceholder
            : consolidating
              ? copy.memory.consolidationPlaceholder
              : copy.memory.placeholder
        }
        onChange={(event) => props.onDraft(event.target.value)}
      />
      <div className="memory-provenance-inputs">
        <label>
          <span>{copy.memory.persistenceReason}</span>
          <textarea
            rows={2}
            maxLength={500}
            value={props.persistenceReason}
            placeholder={copy.memory.persistenceReasonPlaceholder}
            onChange={(event) =>
              props.onPersistenceReason(event.currentTarget.value)
            }
          />
        </label>
        <label>
          <span>{copy.memory.difference}</span>
          <textarea
            rows={2}
            maxLength={500}
            value={props.differenceSummary}
            placeholder={copy.memory.differencePlaceholder}
            onChange={(event) =>
              props.onDifferenceSummary(event.currentTarget.value)
            }
          />
        </label>
      </div>
      <div className="memory-compose-controls">
        <select
          aria-label={copy.memory.categoryLabel}
          value={props.category}
          onChange={(event) =>
            props.onCategory(event.target.value as MemoryCategory)
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
          value={props.scope}
          disabled={props.scopeLocked}
          onChange={(event) => props.onScope(event.target.value as MemoryScope)}
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
              value={props.reviewIntervalDays}
              aria-label={copy.memory.reviewIntervalLabel}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                if (Number.isFinite(value)) {
                  props.onReviewIntervalDays(
                    Math.min(3650, Math.max(1, Math.round(value))),
                  );
                }
              }}
            />
            {copy.memory.days}
          </span>
        </label>
      </div>
      {props.correctionTarget && props.correctionUnchanged ? (
        <p className="memory-compose-hint">{copy.memory.changeRequired}</p>
      ) : null}
      {props.consolidationIncomplete ? (
        <p className="memory-compose-hint">
          {copy.memory.consolidationNeedsSources}
        </p>
      ) : null}
      <button
        className="primary-wide"
        type="button"
        disabled={
          !props.draft.trim() ||
          !props.persistenceReason.trim() ||
          !props.differenceSummary.trim() ||
          props.correctionUnchanged ||
          props.consolidationIncomplete
        }
        onClick={props.onSave}
      >
        {props.correctionTarget ? (
          <PenLine size={14} aria-hidden="true" />
        ) : consolidating ? (
          <Layers size={14} aria-hidden="true" />
        ) : (
          <Brain size={14} aria-hidden="true" />
        )}
        {props.correctionTarget
          ? copy.memory.proposeCorrection
          : consolidating
            ? copy.memory.proposeConsolidation
            : copy.memory.add}
      </button>
    </div>
  );
}

function shortIdentifier(value: string): string {
  return value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-5)}` : value;
}
