import { BookOpen, Check, Plus, Save, ShieldCheck, X } from "lucide-react";

import { copy } from "./copy";
import { EvaluationCasebookVolume } from "./EvaluationCasebookVolume";
import { EvaluationCasebookTemplateCreateButton } from "./EvaluationCasebookTemplateControl";
import type { useEvaluationCasebook } from "./use-evaluation-casebook";

type EvaluationCasebookState = ReturnType<typeof useEvaluationCasebook>;

export interface EvaluationCasebookViewProps {
  state: EvaluationCasebookState;
}

export function EvaluationCasebookView({ state }: EvaluationCasebookViewProps) {
  const {
    casebooks,
    setSelectedId,
    setPendingRemoveId,
    creating,
    editing,
    name,
    setName,
    description,
    setDescription,
    busyId,
    error,
    selected,
    releaseTemplate,
    beginCreate,
    cancelForm,
    submitMetadata,
    createReleaseTemplate,
  } = state;
  return (
    <section className="casebook-panel" aria-labelledby="casebook-panel-title">
      <header>
        <div>
          <span>{copy.lab.casebook.eyebrow}</span>
          <h4 id="casebook-panel-title">{copy.lab.casebook.title}</h4>
        </div>
        <BookOpen size={15} aria-hidden="true" />
      </header>
      <p>{copy.lab.casebook.body}</p>

      <div className="casebook-toolbar">
        <label>
          <span>{copy.lab.casebook.select}</span>
          <select
            value={selected?.id ?? ""}
            disabled={casebooks.length === 0 || Boolean(busyId)}
            onChange={(event) => {
              setSelectedId(event.target.value);
              setPendingRemoveId(undefined);
            }}
          >
            {casebooks.length === 0 ? (
              <option value="">{copy.lab.casebook.empty}</option>
            ) : null}
            {casebooks.map((casebook) => {
              const latest = casebook.revisions.at(-1)!;
              return (
                <option key={casebook.id} value={casebook.id}>
                  {latest.name} · r{casebook.currentRevision}
                </option>
              );
            })}
          </select>
        </label>
        <button type="button" disabled={Boolean(busyId)} onClick={beginCreate}>
          <Plus size={11} aria-hidden="true" />
          {copy.lab.casebook.create}
        </button>
        {!casebooks.some(
          (casebook) => casebook.templateId === releaseTemplate?.id,
        ) ? (
          <EvaluationCasebookTemplateCreateButton
            template={releaseTemplate}
            disabled={Boolean(busyId)}
            creating={busyId === "create-template"}
            onCreate={() => void createReleaseTemplate()}
          />
        ) : null}
      </div>

      {creating || editing ? (
        <div className="casebook-metadata-form">
          <label>
            <span>{copy.lab.casebook.name}</span>
            <input
              type="text"
              maxLength={100}
              value={name}
              placeholder={copy.lab.casebook.namePlaceholder}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            <span>{copy.lab.casebook.description}</span>
            <textarea
              rows={3}
              maxLength={1_000}
              value={description}
              placeholder={copy.lab.casebook.descriptionPlaceholder}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <footer>
            <button
              type="button"
              disabled={Boolean(busyId)}
              onClick={cancelForm}
            >
              <X size={11} aria-hidden="true" />
              {copy.lab.casebook.cancel}
            </button>
            <button
              className="casebook-primary"
              type="button"
              disabled={!name.trim() || Boolean(busyId)}
              onClick={() => void submitMetadata()}
            >
              {editing ? (
                <Save size={11} aria-hidden="true" />
              ) : (
                <Check size={11} aria-hidden="true" />
              )}
              {busyId
                ? editing
                  ? copy.lab.casebook.saving
                  : copy.lab.casebook.creating
                : editing
                  ? copy.lab.casebook.save
                  : copy.lab.casebook.create}
            </button>
          </footer>
        </div>
      ) : null}

      <EvaluationCasebookVolume state={state} />

      {error ? (
        <p className="suite-error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="casebook-safety">
        <ShieldCheck size={11} aria-hidden="true" />
        {copy.lab.casebook.safety}
      </p>
    </section>
  );
}
