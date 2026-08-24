import { useEffect, useState } from "react";
import { ArrowRight, CircleHelp, X } from "lucide-react";

import type {
  AnswerOperatorDecisionRequest,
  OperatorDecision,
} from "@napier/contracts";

import { operatorDecisionCopy as copy } from "./operator-decision-copy";

export default function OperatorDecisionPanel({
  decision,
  workflowOwned,
  busy,
  onAnswer,
  onContinue,
  onCancel,
}: {
  decision: OperatorDecision;
  workflowOwned: boolean;
  busy: boolean;
  onAnswer: (
    decisionId: string,
    answer: AnswerOperatorDecisionRequest,
  ) => Promise<void>;
  onContinue: (decision: OperatorDecision) => Promise<void>;
  onCancel: (decisionId: string) => Promise<void>;
}) {
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>(
    decision.selectedOptionIds ?? [],
  );
  const [customText, setCustomText] = useState(decision.customText ?? "");

  useEffect(() => {
    setSelectedOptionIds(decision.selectedOptionIds ?? []);
    setCustomText(decision.customText ?? "");
  }, [decision.id, decision.selectedOptionIds, decision.customText]);

  const answered = decision.status === "answered";
  const selected = new Set(selectedOptionIds);
  const toggleOption = (optionId: string): void => {
    setSelectedOptionIds((current) =>
      decision.multiSelect
        ? current.includes(optionId)
          ? current.filter((id) => id !== optionId)
          : [...current, optionId]
        : [optionId],
    );
  };
  const canAnswer =
    !busy && (selectedOptionIds.length > 0 || Boolean(customText.trim()));

  return (
    <section
      className="operator-decision"
      aria-labelledby={`operator-decision-${decision.id}`}
      aria-busy={Boolean(busy)}
    >
      <header className="operator-decision-heading">
        <div className="operator-decision-glyph" aria-hidden="true">
          <CircleHelp size={18} />
        </div>
        <div>
          <span>{copy.eyebrow}</span>
          <strong>{answered ? copy.answered : copy.waiting}</strong>
        </div>
        <code title={decision.contentSha256}>{decision.id.slice(-8)}</code>
      </header>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!canAnswer) return;
          void onAnswer(decision.id, {
            selectedOptionIds,
            ...(customText.trim() ? { customText: customText.trim() } : {}),
          });
        }}
      >
        <fieldset disabled={Boolean(busy) || answered}>
          <legend id={`operator-decision-${decision.id}`}>
            <span>{decision.header}</span>
            <strong>{decision.question}</strong>
          </legend>
          <div className="operator-decision-context">
            <p>{copy.runSettled}</p>
            <span>
              {decision.multiSelect ? copy.multiSelect : copy.singleSelect}
            </span>
          </div>
          <div className="operator-decision-options">
            {decision.options.map((option, index) => (
              <label
                className={selected.has(option.id) ? "is-selected" : undefined}
                key={option.id}
              >
                <input
                  type={decision.multiSelect ? "checkbox" : "radio"}
                  name={`decision-${decision.id}`}
                  value={option.id}
                  checked={selected.has(option.id)}
                  onChange={() => toggleOption(option.id)}
                />
                <span className="operator-option-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
          </div>
          <details className="operator-decision-custom">
            <summary>
              {copy.customAnswer} <small>{copy.optional}</small>
            </summary>
            <textarea
              aria-label={copy.customAnswer}
              rows={2}
              maxLength={4096}
              value={customText}
              placeholder={copy.customPlaceholder}
              onChange={(event) => setCustomText(event.target.value)}
            />
          </details>
        </fieldset>

        <footer>
          {answered ? (
            <span className="operator-decision-receipt">
              {copy.receipt}
              <code title={decision.answerSha256}>
                {decision.answerSha256?.slice(0, 12)}
              </code>
            </span>
          ) : (
            <span />
          )}
          <div>
            <button
              className="operator-decision-cancel"
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void onCancel(decision.id)}
            >
              <X size={12} aria-hidden="true" />
              {copy.cancel}
            </button>
            {answered && !workflowOwned ? (
              <button
                className="operator-decision-primary"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void onContinue(decision)}
              >
                {copy.continue}
                <ArrowRight size={13} aria-hidden="true" />
              </button>
            ) : answered ? (
              <small className="operator-decision-workflow-resume">
                {copy.workflowResume}
              </small>
            ) : (
              <button
                className="operator-decision-primary"
                type="submit"
                disabled={!canAnswer}
              >
                {copy.submit}
                <ArrowRight size={13} aria-hidden="true" />
              </button>
            )}
          </div>
        </footer>
      </form>
    </section>
  );
}
