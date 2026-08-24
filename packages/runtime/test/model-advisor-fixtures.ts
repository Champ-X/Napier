import type { RunEvent } from "@napier/contracts";

export const DEFAULT_MODEL_ADVISOR_TEST_POLICY = {
  mode: "observe" as const,
  enabledRules: [
    "unverified_verification_claim" as const,
    "destructive_command_reference" as const,
  ],
  maxCorrectionAttempts: 0,
};

export function toolCompleted(
  seq: number,
  payload: Record<string, unknown>,
): RunEvent {
  return {
    id: `evt_${seq}`,
    threadId: "thread_1",
    runId: "run_1",
    seq,
    type: "tool.completed",
    category: "tool",
    visibility: "user",
    createdAt: "2026-07-27T00:00:00.000Z",
    payload,
  };
}

export function planEvent(
  seq: number,
  type:
    | "plan.artifact.verified"
    | "plan.artifact.missing"
    | "plan.step.completed",
  payload: Record<string, unknown>,
): RunEvent {
  return {
    id: `evt_${seq}`,
    threadId: "thread_1",
    runId: "run_1",
    seq,
    type,
    category: "plan",
    visibility: "user",
    createdAt: "2026-07-27T00:00:00.000Z",
    payload,
  };
}

export function goalEvent(
  seq: number,
  payload: Record<string, unknown>,
): RunEvent {
  return {
    id: `evt_${seq}`,
    threadId: "thread_1",
    runId: "run_1",
    seq,
    type: "goal.evaluated",
    category: "goal",
    visibility: "user",
    createdAt: "2026-07-27T00:00:00.000Z",
    payload,
  };
}

export function runEvent(
  seq: number,
  type:
    | "run.interrupted"
    | "run.recovery.auto.completed"
    | "run.recovery.auto.failed",
  payload: Record<string, unknown>,
): RunEvent {
  return {
    id: `evt_${seq}`,
    threadId: "thread_1",
    runId: "run_1",
    seq,
    type,
    category: "lifecycle",
    visibility: "user",
    createdAt: "2026-07-27T00:00:00.000Z",
    payload,
  };
}

export function evaluationEvent(
  seq: number,
  type:
    | "evaluation.completed"
    | "evaluation.suite.completed"
    | "evaluation.suite.updated",
  payload: Record<string, unknown>,
): RunEvent {
  return {
    id: `evt_${seq}`,
    threadId: "thread_1",
    runId: "run_1",
    seq,
    type,
    category: "evaluation",
    visibility: "user",
    createdAt: "2026-07-27T00:00:00.000Z",
    payload,
  };
}
