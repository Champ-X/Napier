import { CheckCircle2, ClipboardList, Plus } from "lucide-react";

import type {
  EvaluationCasebook,
  EvaluationCasebookCase,
} from "@napier/contracts";
import type { EvaluationCasebookTemplate } from "@napier/contracts/evaluation-casebook-template";

export function EvaluationCasebookTemplateCreateButton({
  template,
  disabled,
  creating,
  onCreate,
}: {
  template: EvaluationCasebookTemplate | undefined;
  disabled: boolean;
  creating: boolean;
  onCreate(): void;
}) {
  if (!template) return null;
  return (
    <button
      className="casebook-template-create"
      type="button"
      disabled={disabled}
      onClick={onCreate}
    >
      <ClipboardList size={11} aria-hidden="true" />
      {creating ? "Creating release template…" : "Use release template"}
    </button>
  );
}

export function EvaluationCasebookTemplateCoverage({
  casebook,
  cases,
  template,
  selectedCaseId,
  disabled,
  onSelect,
  onUseTaskPrompt,
}: {
  casebook: EvaluationCasebook;
  cases: EvaluationCasebookCase[];
  template: EvaluationCasebookTemplate | undefined;
  selectedCaseId: string;
  disabled: boolean;
  onSelect(caseId: string): void;
  onUseTaskPrompt(prompt: string): void;
}) {
  if (!casebook.templateId || !template) return null;
  const covered = new Set(cases.map((item) => item.templateCaseId));
  const completed = template.cases.filter((item) =>
    covered.has(item.id),
  ).length;
  return (
    <section
      className="casebook-template-coverage"
      aria-labelledby={`casebook-template-${casebook.id}`}
    >
      <header>
        <div>
          <span>FIXED PRODUCT COVERAGE</span>
          <h6 id={`casebook-template-${casebook.id}`}>{template.name}</h6>
        </div>
        <strong>
          {completed}/{template.cases.length}
        </strong>
      </header>
      <p>{template.description}</p>
      <label>
        <span>Coverage slot for the reviewed evaluation</span>
        <select
          aria-label="Product Casebook coverage slot"
          value={selectedCaseId}
          disabled={disabled}
          onChange={(event) => onSelect(event.currentTarget.value)}
        >
          {template.cases.map((item) => (
            <option key={item.id} value={item.id}>
              {covered.has(item.id) ? "Replace" : "Open"} · {item.title}
            </option>
          ))}
        </select>
      </label>
      <ol>
        {template.cases.map((item) => (
          <li
            key={item.id}
            className={covered.has(item.id) ? "is-covered" : ""}
          >
            {covered.has(item.id) ? (
              <CheckCircle2 size={12} aria-hidden="true" />
            ) : (
              <Plus size={12} aria-hidden="true" />
            )}
            <details>
              <summary>
                <strong>{item.title}</strong>
                <small>{item.description}</small>
              </summary>
              <p>{item.taskPrompt}</p>
              <ul>
                {item.acceptanceCriteria.map((criterion) => (
                  <li key={criterion}>{criterion}</li>
                ))}
              </ul>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  onSelect(item.id);
                  onUseTaskPrompt(item.taskPrompt);
                }}
              >
                Use in composer
              </button>
            </details>
          </li>
        ))}
      </ol>
      {completed < template.cases.length ? (
        <p role="status">
          Qualification unlocks after every fixed coverage slot has reviewed
          evidence.
        </p>
      ) : (
        <p role="status">
          Fixed Product Casebook coverage is complete and ready for
          qualification trials.
        </p>
      )}
    </section>
  );
}
