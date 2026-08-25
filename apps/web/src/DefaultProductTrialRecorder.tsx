import type { EvaluationCasebook, RunRecord } from "@napier/contracts";
import type { EvaluationCasebookTemplate } from "@napier/contracts/evaluation-casebook-template";
import { ClipboardCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { advancedSurfaceCopy } from "./advanced-surface-copy";
import {
  createEvaluationCasebook,
  listEvaluationCasebooks,
  listEvaluationCasebookTemplates,
} from "./evaluation-casebook-api";
import { ReleaseProductTrialControl } from "./ReleaseProductTrialControl";

export const DEFAULT_PRODUCT_CASE_IDS = [
  "network-reference",
  "coding-verification",
  "dynamic-browser",
  "high-risk-confirmation",
  "artifact-delivery",
  "long-task-recovery",
] as const;

export interface DefaultProductTrialRecorderProps {
  threadId: string;
  runs: RunRecord[];
  listCasebooks?: typeof listEvaluationCasebooks;
  listTemplates?: typeof listEvaluationCasebookTemplates;
  createCasebook?: typeof createEvaluationCasebook;
}

export function DefaultProductTrialRecorder({
  threadId,
  runs,
  listCasebooks = listEvaluationCasebooks,
  listTemplates = listEvaluationCasebookTemplates,
  createCasebook = createEvaluationCasebook,
}: DefaultProductTrialRecorderProps) {
  const copy = advancedSurfaceCopy.defaultTrial;
  const terminalRun = latestTerminalRun(runs);
  const [open, setOpen] = useState(false);
  const [casebook, setCasebook] = useState<EvaluationCasebook>();
  const [template, setTemplate] = useState<EvaluationCasebookTemplate>();
  const [selectedCaseId, setSelectedCaseId] = useState<string>(
    DEFAULT_PRODUCT_CASE_IDS[0],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const cases = useMemo(
    () =>
      DEFAULT_PRODUCT_CASE_IDS.flatMap((caseId) => {
        const templateCase = template?.cases.find((item) => item.id === caseId);
        return templateCase ? [templateCase] : [];
      }),
    [template],
  );

  useEffect(() => {
    if (!open || !terminalRun) return;
    let cancelled = false;
    setError(undefined);
    setCasebook(undefined);
    setTemplate(undefined);
    void Promise.all([listCasebooks(), listTemplates()])
      .then(([casebooks, templates]) => {
        if (cancelled) return;
        const releaseTemplate = templates.find(
          (item) => item.id === "release-product-v1",
        );
        setTemplate(releaseTemplate);
        setCasebook(
          casebooks.find((item) => item.templateId === releaseTemplate?.id),
        );
        if (!releaseTemplate) {
          setError(copy.templateUnavailable);
        } else if (casesMissingFrom(releaseTemplate).length > 0) {
          setError(copy.casesMissing);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(errorMessage(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [listCasebooks, listTemplates, open, terminalRun]);

  if (!terminalRun) return null;

  async function prepareCasebook(): Promise<void> {
    if (!template || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setCasebook(
        await createCasebook({
          threadId,
          name: template.name,
          description: template.description,
          templateId: template.id,
        }),
      );
    } catch (createError) {
      setError(errorMessage(createError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details
      className="default-product-trial"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <ClipboardCheck size={11} aria-hidden="true" />
        {copy.summary}
      </summary>
      {open ? (
        <div>
          <p>{copy.body}</p>
          {casebook &&
          template &&
          cases.length === DEFAULT_PRODUCT_CASE_IDS.length ? (
            <>
              <label>
                <span>{copy.coreCase}</span>
                <select
                  aria-label={copy.coreCaseLabel}
                  value={selectedCaseId}
                  onChange={(event) => setSelectedCaseId(event.target.value)}
                >
                  {cases.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
              <ReleaseProductTrialControl
                threadId={threadId}
                casebook={casebook}
                template={template}
                selectedCaseId={selectedCaseId}
                runs={[terminalRun]}
              />
            </>
          ) : template && cases.length === DEFAULT_PRODUCT_CASE_IDS.length ? (
            <button
              type="button"
              aria-label={copy.prepareLabel}
              disabled={busy}
              onClick={() => void prepareCasebook()}
            >
              {busy ? copy.preparing : copy.prepare}
            </button>
          ) : !template && !error ? (
            <p role="status">{copy.loading}</p>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
        </div>
      ) : null}
    </details>
  );
}

export function latestTerminalRun(
  runs: readonly RunRecord[],
): RunRecord | undefined {
  return runs
    .filter(
      (run) =>
        Boolean(run.finishedAt) && !["queued", "running"].includes(run.status),
    )
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function casesMissingFrom(
  template: EvaluationCasebookTemplate,
): Array<(typeof DEFAULT_PRODUCT_CASE_IDS)[number]> {
  const availableCaseIds = new Set(template.cases.map((item) => item.id));
  return DEFAULT_PRODUCT_CASE_IDS.filter(
    (caseId) => !availableCaseIds.has(caseId),
  );
}
