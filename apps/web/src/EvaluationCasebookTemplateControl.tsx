import { CheckCircle2, ClipboardList, Plus } from "lucide-react";

import type {
  EvaluationCasebook,
  EvaluationCasebookCase,
} from "@napier/contracts";
import type { EvaluationCasebookTemplate } from "@napier/contracts/evaluation-casebook-template";
import { advancedSurfaceCopy } from "./advanced-surface-copy";

export interface EvaluationCasebookTemplateCreateButtonProps {
  template: EvaluationCasebookTemplate | undefined;
  disabled: boolean;
  creating: boolean;
  onCreate(): void;
}

export function EvaluationCasebookTemplateCreateButton({
  template,
  disabled,
  creating,
  onCreate,
}: EvaluationCasebookTemplateCreateButtonProps) {
  if (!template) return null;
  return (
    <button
      className="casebook-template-create"
      type="button"
      disabled={disabled}
      onClick={onCreate}
    >
      <ClipboardList size={11} aria-hidden="true" />
      {creating
        ? advancedSurfaceCopy.casebookTemplate.creating
        : advancedSurfaceCopy.casebookTemplate.useTemplate}
    </button>
  );
}

export interface EvaluationCasebookTemplateCoverageProps {
  casebook: EvaluationCasebook;
  cases: EvaluationCasebookCase[];
  template: EvaluationCasebookTemplate | undefined;
  selectedCaseId: string;
  disabled: boolean;
  onSelect(caseId: string): void;
  onUseTaskPrompt(prompt: string): void;
}

export function EvaluationCasebookTemplateCoverage({
  casebook,
  cases,
  template,
  selectedCaseId,
  disabled,
  onSelect,
  onUseTaskPrompt,
}: EvaluationCasebookTemplateCoverageProps) {
  const copy = advancedSurfaceCopy.casebookTemplate;
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
          <span>{copy.track}</span>
          <h6 id={`casebook-template-${casebook.id}`}>{template.name}</h6>
        </div>
        <strong>
          {completed}/{template.cases.length}
        </strong>
      </header>
      <p>{template.description}</p>
      <label>
        <span>{copy.slot}</span>
        <select
          aria-label={copy.slotLabel}
          value={selectedCaseId}
          disabled={disabled}
          onChange={(event) => onSelect(event.currentTarget.value)}
        >
          {template.cases.map((item) => (
            <option key={item.id} value={item.id}>
              {covered.has(item.id) ? copy.replace : copy.open} · {item.title}
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
                {copy.useInComposer}
              </button>
            </details>
          </li>
        ))}
      </ol>
      {completed < template.cases.length ? (
        <p role="status">{copy.incomplete}</p>
      ) : (
        <p role="status">{copy.complete}</p>
      )}
    </section>
  );
}
