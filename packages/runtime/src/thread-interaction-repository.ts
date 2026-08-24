import {
  type AgentMilestone,
  type AnswerOperatorDecisionRequest,
  type OperatorDecision,
  type OperatorDecisionCancellationReason,
  type RecordAgentMilestoneInput,
  type RequestOperatorDecisionInput,
  type RunEvent,
} from "@napier/contracts";
import {
  createAgentMilestoneRecordedPayload,
  MAX_AGENT_MILESTONES_PER_RUN,
  MAX_AGENT_MILESTONES_PER_THREAD,
  projectAgentMilestones,
} from "./agent-milestones.js";
import { createId } from "./ids.js";
import {
  createOperatorDecisionAnsweredPayload,
  createOperatorDecisionCancelledPayload,
  createOperatorDecisionContinuedPayload,
  createOperatorDecisionRequestedPayload,
  MAX_OPERATOR_DECISIONS_PER_THREAD,
  projectOperatorDecisions,
} from "./operator-decisions.js";
import type { StoreRepositoryHost } from "./store-repository-host.js";

export interface RequestOperatorDecisionStoreInput extends RequestOperatorDecisionInput {
  threadId: string;
  runId: string;
}

export interface OperatorDecisionMutation {
  decision: OperatorDecision;
  events: RunEvent[];
}

export interface RecordAgentMilestoneStoreInput extends RecordAgentMilestoneInput {
  threadId: string;
  runId: string;
}

export interface AgentMilestoneMutation {
  milestone: AgentMilestone;
  events: RunEvent[];
}

export class ThreadInteractionRepository {
  constructor(private readonly host: StoreRepositoryHost) {}

  async listOperatorDecisions(
    threadId: string,
    runId?: string,
  ): Promise<OperatorDecision[]> {
    const events = await this.host.listEvents(threadId);
    return projectOperatorDecisions(events, runId);
  }

  async listAgentMilestones(
    threadId: string,
    runId?: string,
  ): Promise<AgentMilestone[]> {
    const events = await this.host.listEvents(threadId);
    return projectAgentMilestones(events, runId);
  }

  async recordAgentMilestone(
    input: RecordAgentMilestoneStoreInput,
  ): Promise<AgentMilestoneMutation> {
    this.host.assertInitialized();
    this.host.validateResourceId(input.threadId);
    this.host.validateResourceId(input.runId);
    return this.host.threadQueue(input.threadId).run(() =>
      this.host.stateQueue.run(async () => {
        const thread = this.host.mutableThread(input.threadId);
        const run = this.host.mutableRun(input.runId);
        if (run.source === "workflow") {
          throw new Error("Workflow node Runs do not record Agent milestones");
        }
        if (
          run.threadId !== thread.id ||
          run.status !== "running" ||
          thread.currentRunId !== run.id
        ) {
          throw new Error("Agent milestone requires the active Thread Run");
        }
        const currentEvents = this.host.requireLedger().listEvents(thread.id);
        const current = projectAgentMilestones(currentEvents);
        if (current.length >= MAX_AGENT_MILESTONES_PER_THREAD) {
          throw new Error(
            `Agent milestone Thread limit reached (${MAX_AGENT_MILESTONES_PER_THREAD})`,
          );
        }
        const runMilestones = current.filter(
          (milestone) => milestone.runId === run.id,
        );
        if (runMilestones.length >= MAX_AGENT_MILESTONES_PER_RUN) {
          throw new Error(
            `Agent milestone Run limit reached (${MAX_AGENT_MILESTONES_PER_RUN})`,
          );
        }
        const payload = createAgentMilestoneRecordedPayload({
          milestoneId: createId("milestone"),
          milestone: {
            phase: input.phase,
            title: input.title,
            summary: input.summary,
            completedItems: input.completedItems,
            openLoops: input.openLoops,
          },
          ...(runMilestones.at(-1)
            ? { predecessor: runMilestones.at(-1)! }
            : {}),
        });
        const events = this.host.appendEventsToThread(thread, [
          {
            threadId: thread.id,
            runId: run.id,
            type: "agent.milestone.recorded",
            category: "plan",
            visibility: "user",
            payload,
          },
        ]);
        await this.host.persistState(events);
        const milestone = projectAgentMilestones([
          ...currentEvents,
          ...events,
        ]).find((candidate) => candidate.id === payload.milestoneId);
        if (!milestone) {
          throw new Error("Agent milestone receipt is invalid");
        }
        return {
          milestone: structuredClone(milestone),
          events: structuredClone(events),
        };
      }),
    );
  }

  async requestOperatorDecision(
    input: RequestOperatorDecisionStoreInput,
  ): Promise<OperatorDecisionMutation> {
    this.host.assertInitialized();
    this.host.validateResourceId(input.threadId);
    this.host.validateResourceId(input.runId);
    return this.host.threadQueue(input.threadId).run(() =>
      this.host.stateQueue.run(async () => {
        const thread = this.host.mutableThread(input.threadId);
        const run = this.host.mutableRun(input.runId);
        if (
          run.threadId !== thread.id ||
          run.status !== "running" ||
          thread.currentRunId !== run.id
        ) {
          throw new Error("Operator decision requires the active Thread Run");
        }
        if (
          run.source !== "workflow" &&
          run.configuration?.model.provider === "napier" &&
          run.configuration.model.id === "demo"
        ) {
          throw new Error("The demo model cannot request operator decisions");
        }
        const currentEvents = this.host.requireLedger().listEvents(thread.id);
        const current = projectOperatorDecisions(currentEvents);
        if (current.length >= MAX_OPERATOR_DECISIONS_PER_THREAD) {
          throw new Error(
            `Operator decision limit reached (${MAX_OPERATOR_DECISIONS_PER_THREAD})`,
          );
        }
        if (
          current.some(
            (decision) =>
              decision.status === "pending" || decision.status === "answered",
          )
        ) {
          throw new Error("Thread already has an open operator decision");
        }
        const payload = createOperatorDecisionRequestedPayload({
          decisionId: createId("decision"),
          request: {
            header: input.header,
            question: input.question,
            options: input.options,
            multiSelect: input.multiSelect,
          },
        });
        const events = this.host.appendEventsToThread(thread, [
          {
            threadId: thread.id,
            runId: run.id,
            type: "operator.decision.requested",
            category: "system",
            visibility: "user",
            payload,
          },
        ]);
        await this.host.persistState(events);
        const decision = projectOperatorDecisions([
          ...currentEvents,
          ...events,
        ]).find((candidate) => candidate.id === payload.decisionId);
        if (!decision || decision.status !== "pending") {
          throw new Error("Operator decision request receipt is invalid");
        }
        return {
          decision: structuredClone(decision),
          events: structuredClone(events),
        };
      }),
    );
  }

  async answerOperatorDecision(
    threadId: string,
    decisionId: string,
    answer: AnswerOperatorDecisionRequest,
  ): Promise<OperatorDecisionMutation> {
    this.host.assertInitialized();
    this.host.validateResourceId(threadId);
    this.host.validateResourceId(decisionId);
    return this.host.threadQueue(threadId).run(() =>
      this.host.stateQueue.run(async () => {
        const thread = this.host.mutableThread(threadId);
        if (thread.currentRunId || thread.status !== "waiting") {
          throw new Error("Operator decision answer requires a waiting Thread");
        }
        const currentEvents = this.host.requireLedger().listEvents(thread.id);
        const current = projectOperatorDecisions(currentEvents).find(
          (decision) => decision.id === decisionId,
        );
        if (!current) {
          throw new Error(`Operator decision not found: ${decisionId}`);
        }
        if (current.status === "answered") {
          throw new Error("Operator decision has already been answered");
        }
        if (current.status !== "pending") {
          throw new Error(
            `Operator decision cannot be answered in ${current.status} state`,
          );
        }
        const originRun = this.host.mutableRun(current.runId);
        if (
          originRun.threadId !== thread.id ||
          (originRun.status !== "completed" &&
            originRun.status !== "interrupted")
        ) {
          throw new Error(
            "Operator decision origin Run is not waiting for input",
          );
        }
        const payload = createOperatorDecisionAnsweredPayload({
          decision: current,
          answer,
        });
        const events = this.host.appendEventsToThread(thread, [
          {
            threadId: thread.id,
            runId: current.runId,
            type: "operator.decision.answered",
            category: "system",
            visibility: "user",
            payload,
          },
        ]);
        await this.host.persistState(events);
        const decision = projectOperatorDecisions([
          ...currentEvents,
          ...events,
        ]).find((candidate) => candidate.id === decisionId);
        if (!decision || decision.status !== "answered") {
          throw new Error("Operator decision answer receipt is invalid");
        }
        return {
          decision: structuredClone(decision),
          events: structuredClone(events),
        };
      }),
    );
  }

  async continueOperatorDecision(
    threadId: string,
    decisionId: string,
    continuationRunId: string,
  ): Promise<OperatorDecisionMutation> {
    this.host.assertInitialized();
    this.host.validateResourceId(threadId);
    this.host.validateResourceId(decisionId);
    this.host.validateResourceId(continuationRunId);
    return this.host.threadQueue(threadId).run(() =>
      this.host.stateQueue.run(async () => {
        const thread = this.host.mutableThread(threadId);
        const continuationRun = this.host.mutableRun(continuationRunId);
        const currentEvents = this.host.requireLedger().listEvents(thread.id);
        const current = projectOperatorDecisions(currentEvents).find(
          (decision) => decision.id === decisionId,
        );
        if (!current) {
          throw new Error(`Operator decision not found: ${decisionId}`);
        }
        if (current.status !== "answered") {
          throw new Error(
            `Operator decision cannot continue in ${current.status} state`,
          );
        }
        if (
          thread.currentRunId !== continuationRun.id ||
          continuationRun.threadId !== thread.id ||
          continuationRun.status !== "running" ||
          continuationRun.parentRunId !== current.runId
        ) {
          throw new Error(
            "Operator decision continuation Run binding is invalid",
          );
        }
        const payload = createOperatorDecisionContinuedPayload({
          decision: current,
          continuationRunId: continuationRun.id,
        });
        const events = this.host.appendEventsToThread(thread, [
          {
            threadId: thread.id,
            runId: current.runId,
            type: "operator.decision.continued",
            category: "system",
            visibility: "user",
            payload,
          },
        ]);
        await this.host.persistState(events);
        const decision = projectOperatorDecisions([
          ...currentEvents,
          ...events,
        ]).find((candidate) => candidate.id === decisionId);
        if (!decision || decision.status !== "continued") {
          throw new Error("Operator decision continuation receipt is invalid");
        }
        return {
          decision: structuredClone(decision),
          events: structuredClone(events),
        };
      }),
    );
  }

  async cancelOperatorDecision(
    threadId: string,
    decisionId: string,
    reason: OperatorDecisionCancellationReason = "operator_cancelled",
  ): Promise<OperatorDecisionMutation> {
    this.host.assertInitialized();
    this.host.validateResourceId(threadId);
    this.host.validateResourceId(decisionId);
    return this.host.threadQueue(threadId).run(() =>
      this.host.stateQueue.run(async () => {
        const thread = this.host.mutableThread(threadId);
        if (thread.currentRunId) {
          throw new Error(
            "Operator decision cannot be cancelled while the Thread is running",
          );
        }
        const currentEvents = this.host.requireLedger().listEvents(thread.id);
        const current = projectOperatorDecisions(currentEvents).find(
          (decision) => decision.id === decisionId,
        );
        if (!current) {
          throw new Error(`Operator decision not found: ${decisionId}`);
        }
        if (current.status === "cancelled") {
          return { decision: structuredClone(current), events: [] };
        }
        const payload = createOperatorDecisionCancelledPayload({
          decision: current,
          reason,
        });
        const events = this.host.appendEventsToThread(thread, [
          {
            threadId: thread.id,
            runId: current.runId,
            type: "operator.decision.cancelled",
            category: "system",
            visibility: "user",
            payload,
          },
        ]);
        const originRun = this.host.mutableRun(current.runId);
        if (
          thread.status === "waiting" &&
          (originRun.status === "completed" ||
            originRun.status === "interrupted")
        ) {
          thread.status = "idle";
        }
        await this.host.persistState(events);
        const decision = projectOperatorDecisions([
          ...currentEvents,
          ...events,
        ]).find((candidate) => candidate.id === decisionId);
        if (!decision || decision.status !== "cancelled") {
          throw new Error("Operator decision cancellation receipt is invalid");
        }
        return {
          decision: structuredClone(decision),
          events: structuredClone(events),
        };
      }),
    );
  }
}
