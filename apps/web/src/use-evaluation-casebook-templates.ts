import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

import type { EvaluationCasebookTemplate } from "@napier/contracts/evaluation-casebook-template";

import { listEvaluationCasebookTemplates } from "./evaluation-casebook-api";
import { formatApiErrorMessage } from "./api-error";

export function useEvaluationCasebookTemplates(setError: Dispatch<SetStateAction<string | undefined>>): EvaluationCasebookTemplate[] {
  const [templates, setTemplates] = useState<EvaluationCasebookTemplate[]>([]);
  useEffect(() => {
    let cancelled = false;
    void listEvaluationCasebookTemplates()
      .then((items) => {
        if (!cancelled) setTemplates(items);
      })
      .catch((error: unknown) => {
        if (!cancelled) setError(formatApiErrorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [setError]);
  return templates;
}
