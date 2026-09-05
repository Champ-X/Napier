import type {
  ToolFailureClass,
  ToolFailureSemantics,
} from "./tool-failure-semantics.js";

export type RunFailureCircuitScope = ToolFailureSemantics["scope"];
export type RunFailureCircuitStatus = "closed" | "open" | "half_open";

export interface RunFailureCircuitPolicy {
  schemaVersion: 1;
  /**
   * Maximum distance in real, admitted operation terminals. The historical
   * field name is retained for ledger-policy compatibility; unrelated events
   * and circuit rejections never advance this window.
   */
  failureWindowEventSpan: number;
  successDecay: number;
  defaultRetryAfterMs: number;
  transientHalfOpenAfterMs: number;
  maxRetryAfterMs: number;
  thresholds: Record<RunFailureCircuitScope, number>;
  epochEventTypes: readonly string[];
}

export interface RunFailureCircuitEntry {
  keySha256: string;
  scope: RunFailureCircuitScope;
  bindingSha256: string;
  epoch: number;
  threshold: number;
  failureCount: number;
  lifetimeFailureCount: number;
  successCount: number;
  recoveryEpoch: number;
  recoveryRequired: boolean;
  windowStartedAtSeq?: number;
  openedAtSeq?: number;
  openedAtMs?: number;
  halfOpenAtMs?: number;
  lastFailureSeq?: number;
  lastSuccessSeq?: number;
  lastFailureClass?: ToolFailureClass;
  lastDisposition?: ToolFailureSemantics["disposition"];
}

export interface RunFailureCircuitProjection {
  schemaVersion: 1;
  runId: string;
  throughSeq: number;
  epoch: number;
  epochStartedAtSeq: number;
  policySha256: string;
  entries: readonly RunFailureCircuitEntry[];
}

export interface ResolvedRunFailureCircuit extends RunFailureCircuitEntry {
  status: RunFailureCircuitStatus;
  blocks: boolean;
  retryAfterMs?: number;
}

export interface RunFailureCircuitProjectionOptions {
  policy?: Partial<Omit<RunFailureCircuitPolicy, "thresholds">> & {
    thresholds?: Partial<RunFailureCircuitPolicy["thresholds"]>;
  };
}

export interface FailureStamp {
  seq: number;
  attemptIndex: number;
  threshold: number;
  sticky: boolean;
}

export interface MutableRunFailureCircuitEntry extends RunFailureCircuitEntry {
  failures: FailureStamp[];
}

export interface ParsedRunFailure extends ToolFailureSemantics {
  /** Typed receipts carry their selected circuit identity directly. */
  bindingSha256?: string;
  coverage?: "trusted_declared" | "legacy_fallback" | "invalid_declared";
  retryAfterMs?: number;
}

export const RUN_FAILURE_CIRCUIT_SCOPE_PRIORITY: readonly RunFailureCircuitScope[] =
  ["session", "capability", "route", "origin", "target", "invocation"];

export const DEFAULT_RUN_FAILURE_CIRCUIT_POLICY: Readonly<RunFailureCircuitPolicy> =
  Object.freeze({
    schemaVersion: 1,
    failureWindowEventSpan: 64,
    successDecay: 1,
    defaultRetryAfterMs: 30_000,
    transientHalfOpenAfterMs: 30_000,
    maxRetryAfterMs: 5 * 60_000,
    thresholds: Object.freeze({
      invocation: 1,
      target: 1,
      origin: 2,
      route: 1,
      capability: 1,
      session: 1,
    }),
    epochEventTypes: Object.freeze([
      "run.control.delivered",
      "run.progress.operator_epoch",
    ]),
  });
