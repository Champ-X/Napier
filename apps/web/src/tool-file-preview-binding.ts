import type { ThreadDetail } from "@napier/contracts";
import {
  taskArtifactCurrentFact,
  toolFileDeliverableMatches,
  validToolFileReceipt,
  type ToolFileReceiptPayload,
} from "@napier/contracts/task-narrative";
import type { TaskArtifactTarget } from "./task-completion-output-paths";
import { canonicalJson } from "./stable-digest";

type Deliverable = NonNullable<
  NonNullable<ThreadDetail["taskNarrative"]>["deliverables"]
>[number];

export interface ToolFilePreviewBinding {
  sourceEventId: string;
  receipt: ToolFileReceiptPayload;
}

/** A path reference or a manifest assertion alone cannot grant this binding. */
export function toolFilePreviewBinding(
  entry: Deliverable,
): ToolFilePreviewBinding | undefined {
  if (
    !toolFileDeliverableMatches(entry) ||
    taskArtifactCurrentFact(entry) !== "integrity_observed"
  )
    return;
  return {
    sourceEventId: entry.sourceEventId!,
    receipt: { ...entry.toolFile! },
  };
}

/** Include invocation identity even when path and digest have not changed. */
export function toolFilePreviewSelectionKey(
  binding: ToolFilePreviewBinding | undefined,
  scope: {
    path: string;
    threadId: string | undefined;
    expectedSha256: string | undefined;
  },
): string | undefined {
  if (
    !binding ||
    typeof binding.sourceEventId !== "string" ||
    !binding.sourceEventId.trim() ||
    !validToolFileReceipt(binding.receipt) ||
    binding.receipt.threadId !== scope.threadId ||
    binding.receipt.path !== scope.path ||
    binding.receipt.fileSha256 !== scope.expectedSha256
  )
    return;
  return canonicalJson(binding);
}

/** Recover provenance only for the exact target selected by the shared output mapper. */
export function toolFilePreviewBindingForTarget(
  deliverables: readonly Deliverable[] | undefined,
  target: TaskArtifactTarget | undefined,
): ToolFilePreviewBinding | undefined {
  if (!target?.artifact || target.planId) return;
  const matches = (deliverables ?? []).filter(
    (entry) =>
      entry.path === target.path &&
      canonicalJson(entry.artifact) === canonicalJson(target.artifact),
  );
  return matches.length === 1 ? toolFilePreviewBinding(matches[0]!) : undefined;
}

/** App-level projection: current provenance advances identity; lost provenance retains the selected digest fence. */
export function toolFilePreviewForTarget(
  deliverables: readonly Deliverable[] | undefined,
  target: TaskArtifactTarget | undefined,
  selectedExpectedSha256: string | undefined,
): {
  binding: ToolFilePreviewBinding | undefined;
  expectedSha256: string | undefined;
} {
  const binding = toolFilePreviewBindingForTarget(deliverables, target);
  return {
    binding,
    expectedSha256: binding?.receipt.fileSha256 ?? selectedExpectedSha256,
  };
}
