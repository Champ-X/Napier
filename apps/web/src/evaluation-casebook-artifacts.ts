import type {
  EvaluationCasebookArtifact,
  EvaluationCasebookQualificationReceipt,
  TrustedReceiptEnvelope,
} from "@napier/contracts";

import { formatApiErrorMessage } from "./api-error";
import {
  evaluationCasebookArtifactFilename,
  evaluationCasebookQualificationReceiptFilename,
} from "./evaluation-artifact-view-model";

export function downloadArtifact(artifact: EvaluationCasebookArtifact): void {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(artifact, null, 2)}\n`], {
      type: "application/json",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = evaluationCasebookArtifactFilename(artifact);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadQualificationReceipt(
  receipt: EvaluationCasebookQualificationReceipt,
): void {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(receipt, null, 2)}\n`], {
      type: "application/json",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = evaluationCasebookQualificationReceiptFilename(receipt);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadTrustedReceipt(
  envelope: TrustedReceiptEnvelope,
  filename: string,
): void {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(envelope, null, 2)}\n`], {
      type: "application/json",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function parseModelKey(value: string): { provider: string; id: string } {
  const separator = value.indexOf("/");
  return separator > 0 && separator < value.length - 1
    ? {
        provider: value.slice(0, separator),
        id: value.slice(separator + 1),
      }
    : { provider: "napier", id: "demo" };
}

export function shortId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function toErrorMessage(error: unknown): string {
  return formatApiErrorMessage(error);
}
