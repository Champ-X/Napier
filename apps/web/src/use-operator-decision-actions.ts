import { useRef, useState } from "react";
import type {
  AnswerOperatorDecisionRequest,
  OperatorDecision,
  StreamFrame,
  ThreadDetail,
} from "@napier/contracts";
import {
  answerOperatorDecision,
  cancelOperatorDecision,
  continueOperatorDecision,
} from "./thread-run-api";
import { formatApiErrorMessage } from "./api-error";
import { operatorDecisionCopy as copy } from "./operator-decision-copy";

export interface OperatorDecisionUiState {
  phase?: "saving" | "continuing" | "cancelling" | undefined;
  error?: string | undefined;
  draft?: AnswerOperatorDecisionRequest | undefined;
  savedDecision?: OperatorDecision;
}

interface Input {
  workspaceKey: string | undefined;
  detail: ThreadDetail | undefined;
  decision: OperatorDecision | undefined;
  isRunning: boolean;
  onStart(threadId: string, detail: ThreadDetail): void;
  onFinish(threadId: string): void;
  onFrame(threadId: string): (frame: StreamFrame) => void;
  onCommit(threadId: string, detail: ThreadDetail): void;
  loadThread(threadId: string): Promise<ThreadDetail>;
  onRunError(threadId: string, error: unknown): void;
}

export function useOperatorDecisionActions(input: Input) {
  const [states, setStates] = useState<Record<string, OperatorDecisionUiState>>(
    {},
  );
  const active = useRef(input);
  active.current = input;
  const pending = useRef(new Set<string>());
  const key =
    input.workspaceKey && input.decision
      ? JSON.stringify([
          input.workspaceKey,
          input.decision.threadId,
          input.decision.id,
        ])
      : undefined;
  const update = (id: string, patch: Partial<OperatorDecisionUiState>) =>
    setStates((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }));

  const execute = async (
    action: "save" | "answer_continue" | "continue" | "cancel",
    decisionId: string,
    answer?: AnswerOperatorDecisionRequest,
  ): Promise<void> => {
    const { detail, decision, workspaceKey } = input;
    if (
      !key ||
      !detail ||
      !decision ||
      !matchesDecision(detail, decision, decisionId) ||
      pending.current.has(key)
    )
      return;
    const workflowOwned =
      detail.runs.find((run) => run.id === decision.runId)?.source ===
      "workflow";
    const continuing = ["continue", "answer_continue"].includes(action);
    if (continuing && (workflowOwned || input.isRunning)) return;
    pending.current.add(key);
    const sameWorkspace = () => active.current.workspaceKey === workspaceKey;
    const threadId = detail.thread.id;
    let saved =
      states[key]?.savedDecision ??
      (decision.status === "answered" ? decision : undefined);
    let started = false;
    let failed = false;
    let runError: string | undefined;
    update(key, {
      phase: (
        {
          cancel: "cancelling",
          continue: "continuing",
          save: "saving",
          answer_continue: "saving",
        } as const
      )[action],
      error: undefined,
    });
    try {
      if (action === "cancel") {
        await cancelOperatorDecision(threadId, decisionId);
      } else {
        if (answer) {
          saved = await answerOperatorDecision(threadId, decisionId, answer);
          update(key, { savedDecision: saved, draft: undefined });
        }
        if (continuing && sameWorkspace()) {
          update(key, { phase: "continuing" });
          await continueSaved(input, detail, saved, sameWorkspace, () => {
            started = true;
          });
        }
      }
    } catch (error) {
      failed = true;
      const message = decisionFailureMessage(action, saved, error);
      update(key, { error: message });
      if (started) runError = message;
    } finally {
      if (sameWorkspace()) {
        const refreshed = await refreshDecision(
          input,
          threadId,
          decisionId,
          sameWorkspace,
          (confirmed) => {
            if (
              failed &&
              !saved &&
              answer &&
              matchesAnswer(confirmed, answer)
            ) {
              update(key, {
                savedDecision: confirmed,
                draft: undefined,
                error: continuing ? copy.savedReady : undefined,
              });
            }
          },
        );
        if (started && sameWorkspace()) {
          reportContinuationFailure(
            input,
            decisionId,
            threadId,
            refreshed,
            runError,
          );
          input.onFinish(threadId);
        }
      }
      pending.current.delete(key);
      update(key, { phase: undefined });
    }
  };

  return {
    operatorDecisionState: key ? states[key] : undefined,
    operatorDecisionBusy: Boolean(key && states[key]?.phase),
    setOperatorDecisionDraft: (draft: AnswerOperatorDecisionRequest) => {
      if (key && !pending.current.has(key))
        update(key, { draft, error: undefined });
    },
    answerOperatorDecision: (
      id: string,
      answer: AnswerOperatorDecisionRequest,
    ) => execute("save", id, answer),
    answerAndContinueOperatorDecision: (
      id: string,
      answer: AnswerOperatorDecisionRequest,
    ) => execute("answer_continue", id, answer),
    continueOperatorDecision: (decision: OperatorDecision) =>
      execute("continue", decision.id),
    cancelOperatorDecision: (id: string) => execute("cancel", id),
  };
}

function matchesDecision(
  detail: ThreadDetail,
  decision: OperatorDecision,
  decisionId: string,
): boolean {
  return decision.id === decisionId && detail.thread.id === decision.threadId;
}

async function continueSaved(
  input: Input,
  detail: ThreadDetail,
  saved: OperatorDecision | undefined,
  sameWorkspace: () => boolean,
  onStarted: () => void,
): Promise<void> {
  if (!saved || !["answered", "continued"].includes(saved.status))
    throw new Error(copy.answerUnavailable);
  const source = {
    ...detail,
    operatorDecisions: detail.operatorDecisions.map((item) =>
      item.id === saved.id ? saved : item,
    ),
  };
  input.onStart(detail.thread.id, source);
  onStarted();
  await continueOperatorDecision(detail.thread.id, saved.id, (frame) => {
    if (sameWorkspace()) input.onFrame(detail.thread.id)(frame);
  });
}

function decisionFailureMessage(
  action: string,
  saved: OperatorDecision | undefined,
  error: unknown,
): string {
  const explanation =
    action === "cancel"
      ? copy.cancelFailed
      : saved
        ? copy.continueFailed
        : copy.saveUnconfirmed;
  return `${explanation} ${formatApiErrorMessage(error)}`;
}

async function refreshDecision(
  input: Input,
  threadId: string,
  decisionId: string,
  sameWorkspace: () => boolean,
  onConfirmed: (decision: OperatorDecision) => void,
): Promise<ThreadDetail | undefined> {
  try {
    const refreshed = await input.loadThread(threadId);
    if (!sameWorkspace()) return;
    const decision = refreshed.operatorDecisions.find(
      (item) => item.id === decisionId,
    );
    if (decision) onConfirmed(decision);
    input.onCommit(threadId, refreshed);
    return refreshed;
  } catch {
    // Keep input and the actual answer response if reconciliation is offline.
  }
}

function matchesAnswer(
  decision: OperatorDecision,
  answer: AnswerOperatorDecisionRequest,
): boolean {
  return (
    ["answered", "continued"].includes(decision.status) &&
    (decision.customText ?? "") === (answer.customText?.trim() ?? "") &&
    JSON.stringify([...(decision.selectedOptionIds ?? [])].sort()) ===
      JSON.stringify([...answer.selectedOptionIds].sort())
  );
}

function reportContinuationFailure(
  input: Input,
  decisionId: string,
  threadId: string,
  refreshed: ThreadDetail | undefined,
  error: string | undefined,
): void {
  if (!error) return;
  const runId = refreshed?.operatorDecisions.find(
    (item) => item.id === decisionId,
  )?.continuationRunId;
  const completed =
    runId &&
    refreshed?.runs.some(
      (run) => run.id === runId && run.status === "completed",
    );
  if (!completed) input.onRunError(threadId, error);
}
