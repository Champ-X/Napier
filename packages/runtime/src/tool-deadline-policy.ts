export interface ToolDeadlinePolicy {
  timeoutMs: number;
  settlementGraceMs: number;
}

/**
 * Long-lived built-in tools can publish the minimum outer deadline they need
 * to finish their own bounded cancellation and settlement protocol. The Run
 * budget remains the hard upper bound.
 */
export const TOOL_MINIMUM_DEADLINE_MS = Symbol(
  "napier-tool-minimum-deadline-ms",
);

export interface ToolMinimumDeadline {
  [TOOL_MINIMUM_DEADLINE_MS]?: number;
}

export type ToolDeadlineReason = "deadline_exceeded" | "parent_cancelled";
export type ToolEffectState = "not_started" | "started_unknown" | "completed";

export interface ToolDeadlineEvidence {
  callId: string;
  toolName: string;
  reason: ToolDeadlineReason;
  effect: "read" | "write" | "unknown";
  state: ToolEffectState;
  timeoutMs: number;
  graceMs: number;
  callSha256: string;
  contentSha256: string;
}

export interface ToolEffectJournalEvidence {
  callId: string;
  toolNameSha256: string;
  effect: "read" | "write" | "unknown";
  state: ToolEffectState;
  attempt: number;
  callSha256: string;
  contentSha256: string;
}

export class ToolDeadlineError extends Error {
  constructor(readonly evidence: ToolDeadlineEvidence) {
    super(
      `Tool deadline triggered deterministic finalization: ${evidence.toolName} ${evidence.reason} (${evidence.state}).`,
    );
    this.name = "ToolDeadlineError";
  }
}

export class ToolNotStartedError extends Error {
  constructor(message = "Tool execution did not start") {
    super(message);
    this.name = "ToolNotStartedError";
  }
}

export const DEFAULT_TOOL_DEADLINE_POLICY: Readonly<ToolDeadlinePolicy> = {
  // Complex research, browser, and verification operations routinely need
  // more than two minutes. The Run budget and any explicit per-tool timeout
  // remain hard upper bounds, so a longer outer deadline does not make an
  // individual operation unbounded.
  timeoutMs: 600_000,
  settlementGraceMs: 5_000,
};
