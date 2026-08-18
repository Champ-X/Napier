import type { UserMessage } from "@earendil-works/pi-ai";
import type { JsonValue, RunEvent, RunRecord } from "@napier/contracts";

import { controlMessageEventKey } from "./agent-runtime-utils.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { EventSink } from "./event-sink.js";
import {
  RunNoProgressError,
  type RunNoProgressEvidence,
} from "./run-no-progress-policy.js";
import type { LocalStore } from "./store.js";

export interface RunProgressSnapshot {
  turnIndex: number;
  elapsedMs: number;
  progressed: boolean;
  stagnantTurnCount: number;
  stagnantElapsedMs: number;
  workspaceMutationCount: number;
  sourceCount: number;
  planRevisionTotal: number;
  artifactCandidateCount: number;
  userResultCount: number;
  failureFingerprintCount: number;
  contentSha256: string;
}

const WORKSPACE_MUTATION_TOOLS = new Set([
  "apply_patch",
  "workspace_file_apply",
  "lsp_rename_apply",
  "lsp_code_action_apply",
  "subagent_worktree_apply",
  "web_fetch_save",
]);
const ACTION_FIRST_TURN_THRESHOLD = 3;
const ACTION_FIRST_TIME_THRESHOLD_MS = 180_000;
const NO_PROGRESS_TURN_THRESHOLD = 6;
const NO_PROGRESS_TIME_THRESHOLD_MS = 180_000;
const ACTION_FIRST_MESSAGE =
  "Internal execution redirect: this build/edit run has not produced a workspace mutation within three turns or three minutes. Stop expanding analysis, research, or plans. Execute the smallest safe reversible workspace mutation now. If no safe mutation is possible, finalize with the concrete blocker and preserved evidence. Do not repeat completed research.";
const BUILD_EDIT_INTENT =
  /\b(?:build|code|create|develop|edit|fix|implement|modify|patch|refactor|repair|scaffold)\b|\bwrite\s+(?=[^\n]{0,48}\b(?:code|docs?|documentation|file|page|report|script|tests?|workspace)\b)|(?:创建|制作|开发|实现|修改|修复|编写|搭建|重构|编辑|代码|网页|页面|文件)/iu;

export class RunProgressGovernor {
  private pendingReroute: UserMessage | undefined;
  private pendingRerouteKind: "action_first" | "no_progress" | undefined;
  private actionFirstTriggered = false;
  private noProgressRerouted = false;
  private awaitingNoProgressOutcome = false;
  private awaitingFailureRepairOutcome = false;
  private latestFailureFingerprintCount = 0;
  private noProgressFailureFingerprintCount = 0;
  private noProgressRerouteContentSha256 = "";

  constructor(
    private readonly context: {
      store: LocalStore;
      run: Pick<RunRecord, "id" | "threadId">;
      taskIntentSha256: string;
      buildEditTask: boolean;
      onEvent?: EventSink;
    },
  ) {}

  async afterVector(vector: RunProgressSnapshot): Promise<void> {
    this.latestFailureFingerprintCount = vector.failureFingerprintCount;
    if (vector.progressed && this.pendingRerouteKind === "no_progress") {
      this.pendingReroute = undefined;
      this.pendingRerouteKind = undefined;
      this.noProgressRerouted = false;
      this.noProgressRerouteContentSha256 = "";
    }
    if (
      vector.workspaceMutationCount > 0 &&
      this.pendingRerouteKind === "action_first"
    ) {
      this.pendingReroute = undefined;
      this.pendingRerouteKind = undefined;
    }
    if (this.awaitingFailureRepairOutcome) {
      this.awaitingFailureRepairOutcome = false;
      if (!vector.progressed) {
        throw new RunNoProgressError(this.noProgressEvidence(vector));
      }
      return;
    }
    if (this.awaitingNoProgressOutcome) {
      this.awaitingNoProgressOutcome = false;
      if (!vector.progressed) {
        if (
          vector.failureFingerprintCount >
          this.noProgressFailureFingerprintCount
        ) {
          this.awaitingFailureRepairOutcome = true;
          return;
        }
        throw new RunNoProgressError(this.noProgressEvidence(vector));
      }
      return;
    }
    if (this.needsActionFirst(vector)) {
      await this.actionFirstReroute(vector);
      return;
    }
    if (
      !this.noProgressRerouted &&
      (vector.stagnantTurnCount >= NO_PROGRESS_TURN_THRESHOLD ||
        vector.stagnantElapsedMs >= NO_PROGRESS_TIME_THRESHOLD_MS)
    ) {
      await this.noProgressReroute(vector);
      return;
    }
  }

  async steer(
    preRecordedMessages: Map<string, number>,
    external: (mode: "steering") => Promise<UserMessage[]>,
  ): Promise<UserMessage[]> {
    const externalMessages = await external("steering");
    if (externalMessages.length > 0) return externalMessages;
    const message = this.pendingReroute;
    if (!message) return [];
    const kind = this.pendingRerouteKind;
    this.pendingReroute = undefined;
    this.pendingRerouteKind = undefined;
    if (kind === "no_progress") {
      this.noProgressFailureFingerprintCount =
        this.latestFailureFingerprintCount;
      this.awaitingNoProgressOutcome = true;
    }
    const text =
      typeof message.content === "string"
        ? message.content
        : ACTION_FIRST_MESSAGE;
    const key = controlMessageEventKey(message.timestamp, text);
    preRecordedMessages.set(key, (preRecordedMessages.get(key) ?? 0) + 1);
    return [message];
  }

  private async actionFirstReroute(vector: RunProgressSnapshot): Promise<void> {
    this.actionFirstTriggered = true;
    const reason =
      vector.turnIndex >= ACTION_FIRST_TURN_THRESHOLD ? "turns" : "elapsed";
    await this.recordReroute(
      {
        strategy: "action_first",
        reason,
        turnIndex: vector.turnIndex,
        elapsedMs: vector.elapsedMs,
        thresholdTurns: ACTION_FIRST_TURN_THRESHOLD,
        thresholdElapsedMs: ACTION_FIRST_TIME_THRESHOLD_MS,
        progressVectorSha256: vector.contentSha256,
        instructionSha256: sha256(ACTION_FIRST_MESSAGE),
      },
      ACTION_FIRST_MESSAGE,
      "action_first",
    );
  }

  private needsActionFirst(vector: RunProgressSnapshot): boolean {
    return (
      !this.actionFirstTriggered &&
      this.context.buildEditTask &&
      vector.workspaceMutationCount === 0 &&
      vector.userResultCount === 0 &&
      (vector.turnIndex >= ACTION_FIRST_TURN_THRESHOLD ||
        vector.elapsedMs >= ACTION_FIRST_TIME_THRESHOLD_MS)
    );
  }

  private async noProgressReroute(vector: RunProgressSnapshot): Promise<void> {
    this.noProgressRerouted = true;
    const reason =
      vector.stagnantTurnCount >= NO_PROGRESS_TURN_THRESHOLD
        ? "turns"
        : "elapsed";
    const message = noProgressMessage(vector);
    this.noProgressRerouteContentSha256 = await this.recordReroute(
      {
        strategy: "summarize_and_converge",
        reason,
        turnIndex: vector.turnIndex,
        stagnantTurnCount: vector.stagnantTurnCount,
        elapsedMs: vector.elapsedMs,
        stagnantElapsedMs: vector.stagnantElapsedMs,
        thresholdTurns: NO_PROGRESS_TURN_THRESHOLD,
        thresholdElapsedMs: NO_PROGRESS_TIME_THRESHOLD_MS,
        progressVectorSha256: vector.contentSha256,
        instructionSha256: sha256(message),
      },
      message,
      "no_progress",
    );
  }

  private async recordReroute(
    input: Record<string, JsonValue>,
    message: string,
    kind: "action_first" | "no_progress",
  ): Promise<string> {
    const content = {
      kind: "napier.run-progress-reroute" as const,
      schemaVersion: 1 as const,
      ...input,
      taskIntentSha256: this.context.taskIntentSha256,
    };
    const payload = {
      ...content,
      contentSha256: sha256(canonicalJson(content)),
    };
    const event = await this.context.store.appendEvent({
      threadId: this.context.run.threadId,
      runId: this.context.run.id,
      type: "run.progress.rerouted",
      category: "lifecycle",
      visibility: "debug",
      payload,
    });
    this.pendingReroute = {
      role: "user",
      content: message,
      timestamp: Date.now(),
    };
    this.pendingRerouteKind = kind;
    await emit(this.context.onEvent, event);
    return payload.contentSha256;
  }

  private noProgressEvidence(
    vector: RunProgressSnapshot,
  ): RunNoProgressEvidence {
    return {
      reason:
        vector.stagnantTurnCount >= NO_PROGRESS_TURN_THRESHOLD
          ? "turns"
          : "elapsed",
      turnIndex: vector.turnIndex,
      stagnantTurnCount: vector.stagnantTurnCount,
      elapsedMs: vector.elapsedMs,
      stagnantElapsedMs: vector.stagnantElapsedMs,
      thresholdTurns: NO_PROGRESS_TURN_THRESHOLD,
      thresholdElapsedMs: NO_PROGRESS_TIME_THRESHOLD_MS,
      taskIntentSha256: this.context.taskIntentSha256,
      progressVectorSha256: vector.contentSha256,
      rerouteContentSha256: this.noProgressRerouteContentSha256,
    };
  }
}

export function createRunProgressGovernor(input: {
  store: LocalStore;
  run: Pick<RunRecord, "id" | "threadId">;
  prompt: string;
  toolNames: string[];
  onEvent?: EventSink;
}): RunProgressGovernor {
  return new RunProgressGovernor({
    store: input.store,
    run: input.run,
    taskIntentSha256: sha256(input.prompt),
    buildEditTask:
      Boolean(input.prompt && BUILD_EDIT_INTENT.test(input.prompt)) &&
      input.toolNames.some(isWorkspaceMutationTool),
    ...(input.onEvent ? { onEvent: input.onEvent } : {}),
  });
}

export function isWorkspaceMutationTool(toolName: string): boolean {
  return WORKSPACE_MUTATION_TOOLS.has(toolName);
}

function noProgressMessage(vector: RunProgressSnapshot): string {
  return [
    "Internal convergence redirect: the Run has made no measurable product progress.",
    `Bound vector ${vector.contentSha256}; turn ${String(vector.turnIndex)}; stagnant turns ${String(vector.stagnantTurnCount)}; stagnant ms ${String(vector.stagnantElapsedMs)}.`,
    `Current counts: workspace mutations ${String(vector.workspaceMutationCount)}, sources ${String(vector.sourceCount)}, plan revisions ${String(vector.planRevisionTotal)}, artifact candidates ${String(vector.artifactCandidateCount)}, user results ${String(vector.userResultCount)}, distinct failures ${String(vector.failureFingerprintCount)}.`,
    "Do not expand research or planning. Reuse completed evidence, perform one smallest safe action that changes the Progress Vector, or produce the best concrete partial result now.",
    "If this turn still makes no measurable progress, deterministic finalization will stop the Run.",
  ].join("\n");
}

async function emit(
  sink: EventSink | undefined,
  event: RunEvent,
): Promise<void> {
  if (!sink) return;
  try {
    await sink(event);
  } catch {
    // Durable progress governance survives a disconnected stream.
  }
}
