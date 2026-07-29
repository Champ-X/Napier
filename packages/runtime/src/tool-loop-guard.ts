import type {
  RunEvent,
  ToolLoopGuardContextReceipt,
  ToolLoopGuardPolicy,
  ToolLoopGuardTriggerReceipt,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";

export const TOOL_LOOP_GUARD_CONTEXT_EVENT = "context.tool_loop_guard";
export const TOOL_LOOP_GUARD_TRIGGERED_EVENT = "model.tool_loop.detected";
export const TOOL_LOOP_GUARD_POLICY_REASON = "tool_loop_guard";
export const MIN_TOOL_LOOP_GUARD_THRESHOLD = 2;
export const MAX_TOOL_LOOP_GUARD_THRESHOLD = 8;
export const MAX_TOOL_LOOP_GUARD_EXEMPT_TOOLS = 32;

export const DEFAULT_TOOL_LOOP_GUARD_POLICY: Readonly<ToolLoopGuardPolicy> = {
  enabled: true,
  threshold: 3,
  exemptTools: [],
};

const SHA256 = /^[a-f0-9]{64}$/u;
const TOOL_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/u;

interface ToolLoopTurn {
  responseSeq: number;
  callSha256?: string;
  attempt?: ToolLoopAttempt;
}

interface ToolLoopAttempt {
  responseSeq: number;
  terminalSeq: number;
  toolName: string;
  callSha256: string;
  resultSha256: string;
  status: "completed" | "failed";
}

export interface ToolLoopGuardTriggerProjection {
  eventSeq: number;
  receipt: ToolLoopGuardTriggerReceipt;
}

export interface ActiveToolLoopGuard {
  eventSeq: number;
  receipt: ToolLoopGuardTriggerReceipt;
}

export function normalizeToolLoopGuardPolicy(
  input: ToolLoopGuardPolicy | undefined,
): ToolLoopGuardPolicy {
  if (input === undefined) {
    return structuredClone(DEFAULT_TOOL_LOOP_GUARD_POLICY);
  }
  if (!record(input)) {
    throw new Error("Tool loop guard policy is invalid");
  }
  const keys = ["enabled", "threshold", "exemptTools"];
  if (
    Object.keys(input).length !== keys.length ||
    keys.some((key) => !(key in input)) ||
    typeof input.enabled !== "boolean" ||
    !Number.isSafeInteger(input.threshold) ||
    input.threshold < MIN_TOOL_LOOP_GUARD_THRESHOLD ||
    input.threshold > MAX_TOOL_LOOP_GUARD_THRESHOLD ||
    !Array.isArray(input.exemptTools) ||
    input.exemptTools.length > MAX_TOOL_LOOP_GUARD_EXEMPT_TOOLS
  ) {
    throw new Error("Tool loop guard policy is invalid");
  }
  const exemptTools = input.exemptTools.map((tool) => {
    if (typeof tool !== "string" || !TOOL_NAME.test(tool.trim())) {
      throw new Error("Tool loop guard exempt tool is invalid");
    }
    return tool.trim();
  });
  if (new Set(exemptTools).size !== exemptTools.length) {
    throw new Error("Tool loop guard exempt tools must be distinct");
  }
  return {
    enabled: input.enabled,
    threshold: input.threshold,
    exemptTools: exemptTools.sort(),
  };
}

export function createToolLoopGuardPolicySha256(
  input: ToolLoopGuardPolicy | undefined,
): string {
  return sha256(canonicalJson(normalizeToolLoopGuardPolicy(input)));
}

export function createToolLoopGuardContextReceipt(
  input: ToolLoopGuardPolicy | undefined,
): ToolLoopGuardContextReceipt {
  const policy = normalizeToolLoopGuardPolicy(input);
  const content = {
    kind: "napier.tool-loop-guard-context" as const,
    schemaVersion: 1 as const,
    enabled: policy.enabled,
    threshold: policy.threshold,
    exemptToolCount: policy.exemptTools.length,
    exemptToolSetSha256: sha256(canonicalJson(policy.exemptTools)),
    policySha256: sha256(canonicalJson(policy)),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function createToolCallSha256(toolName: string, args: unknown): string {
  if (!TOOL_NAME.test(toolName)) {
    throw new Error("Tool loop guard tool name is invalid");
  }
  return sha256(canonicalJson({ toolName, args }));
}

export function detectToolCallLoop(
  events: RunEvent[],
  runId: string,
  input: ToolLoopGuardPolicy | undefined,
): ToolLoopGuardTriggerReceipt | undefined {
  const policy = normalizeToolLoopGuardPolicy(input);
  if (!policy.enabled) return undefined;
  const turns = projectToolLoopTurns(events, runId);
  const latest = turns.at(-1)?.attempt;
  if (!latest || policy.exemptTools.includes(latest.toolName)) return undefined;
  const selected: ToolLoopAttempt[] = [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const attempt = turns[index]!.attempt;
    if (
      !attempt ||
      attempt.toolName !== latest.toolName ||
      attempt.callSha256 !== latest.callSha256 ||
      attempt.resultSha256 !== latest.resultSha256 ||
      attempt.status !== latest.status
    ) {
      break;
    }
    selected.push(attempt);
    if (selected.length === policy.threshold) break;
  }
  if (selected.length !== policy.threshold) return undefined;
  selected.reverse();
  const attemptEvidence = selected.map((attempt) => ({
    responseSeq: attempt.responseSeq,
    terminalSeq: attempt.terminalSeq,
    status: attempt.status,
    callSha256: attempt.callSha256,
    resultSha256: attempt.resultSha256,
  }));
  const content = {
    kind: "napier.tool-loop-guard-trigger" as const,
    schemaVersion: 1 as const,
    toolName: latest.toolName,
    threshold: policy.threshold,
    attemptCount: selected.length,
    fromSeq: selected[0]!.responseSeq,
    toSeq: selected.at(-1)!.terminalSeq,
    callSha256: latest.callSha256,
    resultSha256: latest.resultSha256,
    attemptSetSha256: sha256(canonicalJson(attemptEvidence)),
    policySha256: sha256(canonicalJson(policy)),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function projectToolLoopGuardContexts(
  events: RunEvent[],
  runId?: string,
): ToolLoopGuardContextReceipt[] {
  return events
    .filter(
      (event) =>
        event.type === TOOL_LOOP_GUARD_CONTEXT_EVENT &&
        (!runId || event.runId === runId),
    )
    .sort((left, right) => left.seq - right.seq)
    .flatMap((event) => {
      const receipt = parseToolLoopGuardContextReceipt(event.payload);
      return receipt ? [receipt] : [];
    });
}

export function projectToolLoopGuardTriggers(
  events: RunEvent[],
  runId?: string,
): ToolLoopGuardTriggerProjection[] {
  return events
    .filter(
      (event) =>
        event.type === TOOL_LOOP_GUARD_TRIGGERED_EVENT &&
        (!runId || event.runId === runId),
    )
    .sort((left, right) => left.seq - right.seq)
    .flatMap((event) => {
      const receipt = parseToolLoopGuardTriggerReceipt(event.payload);
      return receipt ? [{ eventSeq: event.seq, receipt }] : [];
    });
}

export function validateToolLoopGuardTriggerEvidence(
  event: RunEvent,
  events: RunEvent[],
  input: ToolLoopGuardPolicy | undefined,
): boolean {
  if (event.type !== TOOL_LOOP_GUARD_TRIGGERED_EVENT) return false;
  const receipt = parseToolLoopGuardTriggerReceipt(event.payload);
  if (!receipt) return false;
  const observed = detectToolCallLoop(
    events.filter(
      (candidate) =>
        candidate.runId === event.runId && candidate.seq < event.seq,
    ),
    event.runId,
    input,
  );
  return (
    observed !== undefined && canonicalJson(observed) === canonicalJson(receipt)
  );
}

export function latestActiveToolLoopGuard(
  events: RunEvent[],
  runId: string,
  input: ToolLoopGuardPolicy | undefined,
): ActiveToolLoopGuard | undefined {
  const policy = normalizeToolLoopGuardPolicy(input);
  if (!policy.enabled) return undefined;
  const trigger = projectToolLoopGuardTriggers(events, runId).at(-1);
  if (
    !trigger ||
    trigger.receipt.policySha256 !== sha256(canonicalJson(policy))
  ) {
    return undefined;
  }
  const latestTurn = projectToolLoopTurns(events, runId)
    .filter((turn) => turn.responseSeq > trigger.eventSeq)
    .at(-1);
  if (latestTurn && latestTurn.callSha256 !== trigger.receipt.callSha256) {
    return undefined;
  }
  return trigger;
}

export function formatToolLoopGuardContext(
  active: ActiveToolLoopGuard | undefined,
): string {
  if (!active) return "";
  const receipt = active.receipt;
  return [
    "<tool-loop-guard>",
    "A deterministic runtime guard detected a repeated tool-call loop.",
    `Tool: ${receipt.toolName}`,
    `Repeated identical call and result: ${receipt.attemptCount} times`,
    `Call SHA-256: ${receipt.callSha256}`,
    `Result SHA-256: ${receipt.resultSha256}`,
    "Do not repeat the same call. Change the arguments, inspect different evidence, choose another tool, or explain the blocker.",
    "</tool-loop-guard>",
  ].join("\n");
}

export function toolLoopGuardBlockReason(active: ActiveToolLoopGuard): string {
  return [
    `Tool loop guard blocked repeated ${active.receipt.toolName} call.`,
    `The identical call already returned the same result ${active.receipt.attemptCount} times.`,
    "Change arguments, inspect different evidence, use another tool, or explain the blocker.",
  ].join(" ");
}

function projectToolLoopTurns(
  events: RunEvent[],
  runId: string,
): ToolLoopTurn[] {
  const ordered = events
    .filter((event) => event.runId === runId)
    .sort((left, right) => left.seq - right.seq);
  return ordered.flatMap((event, index): ToolLoopTurn[] => {
    if (
      event.type !== "model.response" ||
      !record(event.payload) ||
      !Array.isArray(event.payload["toolCalls"])
    ) {
      return [];
    }
    const toolCalls = event.payload["toolCalls"];
    if (toolCalls.length !== 1 || !record(toolCalls[0])) {
      return [{ responseSeq: event.seq }];
    }
    const call = toolCalls[0];
    const callId = call["id"];
    const toolName = call["name"];
    if (
      typeof callId !== "string" ||
      typeof toolName !== "string" ||
      !TOOL_NAME.test(toolName)
    ) {
      return [{ responseSeq: event.seq }];
    }
    const callSha256 = toolCallSha256FromLedger(toolName, call["arguments"]);
    if (!callSha256) return [{ responseSeq: event.seq }];
    let turnEnd = index + 1;
    while (
      turnEnd < ordered.length &&
      ordered[turnEnd]!.type !== "model.response"
    ) {
      turnEnd += 1;
    }
    const turnEvents = ordered.slice(index + 1, turnEnd);
    const guardBlocked = turnEvents.some(
      (candidate) =>
        candidate.type === "tool.blocked" &&
        record(candidate.payload) &&
        candidate.payload["policyReason"] === TOOL_LOOP_GUARD_POLICY_REASON &&
        candidate.payload["callId"] === callId,
    );
    const terminals = turnEvents.filter(
      (candidate) =>
        (candidate.type === "tool.completed" ||
          candidate.type === "tool.failed") &&
        record(candidate.payload) &&
        candidate.payload["callId"] === callId,
    );
    if (guardBlocked || terminals.length !== 1) {
      return [{ responseSeq: event.seq, callSha256 }];
    }
    const terminal = terminals[0]!;
    if (
      !record(terminal.payload) ||
      terminal.payload["toolName"] !== toolName
    ) {
      return [{ responseSeq: event.seq, callSha256 }];
    }
    const resultSha256 = toolResultSha256FromLedger(terminal.payload);
    if (!resultSha256) return [{ responseSeq: event.seq, callSha256 }];
    return [
      {
        responseSeq: event.seq,
        callSha256,
        attempt: {
          responseSeq: event.seq,
          terminalSeq: terminal.seq,
          toolName,
          callSha256,
          resultSha256,
          status: terminal.type === "tool.completed" ? "completed" : "failed",
        },
      },
    ];
  });
}

function toolCallSha256FromLedger(
  toolName: string,
  args: unknown,
): string | undefined {
  if (
    record(args) &&
    args["kind"] === "napier.redacted-tool-arguments" &&
    args["schemaVersion"] === 1 &&
    args["redacted"] === true &&
    typeof args["inputSha256"] === "string" &&
    SHA256.test(args["inputSha256"])
  ) {
    return args["inputSha256"];
  }
  return createToolCallSha256(toolName, args);
}

function toolResultSha256FromLedger(
  payload: Record<string, unknown>,
): string | undefined {
  if (
    typeof payload["resultSha256"] === "string" &&
    SHA256.test(payload["resultSha256"])
  ) {
    return payload["resultSha256"];
  }
  if (typeof payload["output"] === "string") {
    return sha256(payload["output"]);
  }
  return typeof payload["outputSha256"] === "string" &&
    SHA256.test(payload["outputSha256"])
    ? payload["outputSha256"]
    : undefined;
}

function parseToolLoopGuardContextReceipt(
  input: unknown,
): ToolLoopGuardContextReceipt | undefined {
  if (!record(input)) return undefined;
  const keys = [
    "kind",
    "schemaVersion",
    "enabled",
    "threshold",
    "exemptToolCount",
    "exemptToolSetSha256",
    "policySha256",
    "contentSha256",
  ];
  if (
    Object.keys(input).length !== keys.length ||
    keys.some((key) => !(key in input)) ||
    input["kind"] !== "napier.tool-loop-guard-context" ||
    input["schemaVersion"] !== 1 ||
    typeof input["enabled"] !== "boolean"
  ) {
    return undefined;
  }
  const threshold = boundedInteger(
    input["threshold"],
    MIN_TOOL_LOOP_GUARD_THRESHOLD,
    MAX_TOOL_LOOP_GUARD_THRESHOLD,
  );
  const exemptToolCount = boundedInteger(
    input["exemptToolCount"],
    0,
    MAX_TOOL_LOOP_GUARD_EXEMPT_TOOLS,
  );
  const enabled = input["enabled"];
  const exemptToolSetSha256 = hashValue(input["exemptToolSetSha256"]);
  const policySha256 = hashValue(input["policySha256"]);
  const contentSha256 = hashValue(input["contentSha256"]);
  if (
    threshold === undefined ||
    exemptToolCount === undefined ||
    typeof enabled !== "boolean" ||
    exemptToolSetSha256 === undefined ||
    policySha256 === undefined ||
    contentSha256 === undefined
  ) {
    return undefined;
  }
  const content = {
    kind: "napier.tool-loop-guard-context" as const,
    schemaVersion: 1 as const,
    enabled,
    threshold,
    exemptToolCount,
    exemptToolSetSha256,
    policySha256,
  };
  return sha256(canonicalJson(content)) === contentSha256
    ? { ...content, contentSha256 }
    : undefined;
}

function parseToolLoopGuardTriggerReceipt(
  input: unknown,
): ToolLoopGuardTriggerReceipt | undefined {
  if (!record(input)) return undefined;
  const keys = [
    "kind",
    "schemaVersion",
    "toolName",
    "threshold",
    "attemptCount",
    "fromSeq",
    "toSeq",
    "callSha256",
    "resultSha256",
    "attemptSetSha256",
    "policySha256",
    "contentSha256",
  ];
  if (
    Object.keys(input).length !== keys.length ||
    keys.some((key) => !(key in input)) ||
    input["kind"] !== "napier.tool-loop-guard-trigger" ||
    input["schemaVersion"] !== 1 ||
    typeof input["toolName"] !== "string" ||
    !TOOL_NAME.test(input["toolName"])
  ) {
    return undefined;
  }
  const threshold = boundedInteger(
    input["threshold"],
    MIN_TOOL_LOOP_GUARD_THRESHOLD,
    MAX_TOOL_LOOP_GUARD_THRESHOLD,
  );
  const attemptCount = boundedInteger(
    input["attemptCount"],
    MIN_TOOL_LOOP_GUARD_THRESHOLD,
    MAX_TOOL_LOOP_GUARD_THRESHOLD,
  );
  const fromSeq = boundedInteger(input["fromSeq"], 1, Number.MAX_SAFE_INTEGER);
  const toSeq = boundedInteger(input["toSeq"], 1, Number.MAX_SAFE_INTEGER);
  const callSha256 = hashValue(input["callSha256"]);
  const resultSha256 = hashValue(input["resultSha256"]);
  const attemptSetSha256 = hashValue(input["attemptSetSha256"]);
  const policySha256 = hashValue(input["policySha256"]);
  const contentSha256 = hashValue(input["contentSha256"]);
  if (
    threshold === undefined ||
    attemptCount !== threshold ||
    fromSeq === undefined ||
    toSeq === undefined ||
    fromSeq > toSeq ||
    callSha256 === undefined ||
    resultSha256 === undefined ||
    attemptSetSha256 === undefined ||
    policySha256 === undefined ||
    contentSha256 === undefined
  ) {
    return undefined;
  }
  const content = {
    kind: "napier.tool-loop-guard-trigger" as const,
    schemaVersion: 1 as const,
    toolName: input["toolName"],
    threshold,
    attemptCount,
    fromSeq,
    toSeq,
    callSha256,
    resultSha256,
    attemptSetSha256,
    policySha256,
  };
  return sha256(canonicalJson(content)) === contentSha256
    ? { ...content, contentSha256 }
    : undefined;
}

function hashValue(input: unknown): string | undefined {
  return typeof input === "string" && SHA256.test(input) ? input : undefined;
}

function boundedInteger(
  input: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return Number.isSafeInteger(input) &&
    Number(input) >= minimum &&
    Number(input) <= maximum
    ? Number(input)
    : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
