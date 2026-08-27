import type { ThreadDetail } from "@napier/contracts";
import type { AgentKernel } from "@napier/runtime/agent";
import type { SubagentHubControlService } from "@napier/runtime/subagents";

export type KernelThreadProjectionServices = {
  conversationActivityCandidates: Pick<
    AgentKernel["conversationActivityCandidates"],
    "project"
  >;
  activePlans: Pick<AgentKernel["activePlans"], "project">;
  conversationActivityEvents: Pick<
    AgentKernel["conversationActivityEvents"],
    "project"
  >;
  conversationArtifacts: Pick<AgentKernel["conversationArtifacts"], "project">;
  conversationCitations: Pick<AgentKernel["conversationCitations"], "project">;
  conversationMessages: Pick<AgentKernel["conversationMessages"], "project">;
  conversationPlans: Pick<AgentKernel["conversationPlans"], "project">;
  conversationRecoveries: Pick<
    AgentKernel["conversationRecoveries"],
    "project"
  >;
  conversationSubagents: Pick<
    AgentKernel["conversationSubagents"],
    "project" | "projectHub"
  >;
  operatorDecisions: Pick<AgentKernel["operatorDecisions"], "project">;
  taskNarratives: Pick<AgentKernel["taskNarratives"], "project">;
};

export async function projectKernelThreadProjections(
  threadId: string,
  kernel: KernelThreadProjectionServices,
  subagentHubControls?: Pick<SubagentHubControlService, "availability">,
) {
  const [
    taskNarrative,
    activePlan,
    messages,
    artifacts,
    activityEvents,
    activityCandidates,
    plans,
    citations,
    recoveries,
    subagents,
    subagentHub,
    operatorDecisions,
  ] = await Promise.all([
    kernel.taskNarratives.project(threadId),
    kernel.activePlans.project(threadId),
    kernel.conversationMessages.project(threadId),
    kernel.conversationArtifacts.project(threadId),
    kernel.conversationActivityEvents.project(threadId),
    kernel.conversationActivityCandidates.project(threadId),
    kernel.conversationPlans.project(threadId),
    kernel.conversationCitations.project(threadId),
    kernel.conversationRecoveries.project(threadId),
    kernel.conversationSubagents.project(threadId),
    kernel.conversationSubagents.projectHub(
      threadId,
      subagentHubControls
        ? (task) => subagentHubControls.availability(task)
        : undefined,
    ),
    kernel.operatorDecisions.project(threadId),
  ]);
  return {
    taskNarrative: taskNarrative.view,
    messages: messages.view,
    artifacts: artifacts.view,
    activityEvents: activityEvents.view,
    activityCandidates: activityCandidates.view,
    conversationPlans: plans.view,
    citations: citations.view,
    recoveries: recoveries.view,
    subagentCards: subagents.view,
    subagentHub: subagentHub.view,
    operatorDecisions: operatorDecisions.view,
    ...(activePlan.view ? { activePlan: activePlan.view } : {}),
  };
}

export async function attachKernelThreadProjections(
  detail: ThreadDetail,
  kernel: KernelThreadProjectionServices,
  subagentHubControls?: Pick<SubagentHubControlService, "availability">,
): Promise<ThreadDetail> {
  const projections = await projectKernelThreadProjections(
    detail.thread.id,
    kernel,
    subagentHubControls,
  );
  detail.taskNarrative = projections.taskNarrative;
  detail.messages = projections.messages;
  detail.artifacts = projections.artifacts;
  detail.activityEvents = projections.activityEvents;
  detail.activityCandidates = projections.activityCandidates;
  detail.conversationPlans = projections.conversationPlans;
  detail.citations = projections.citations;
  detail.recoveries = projections.recoveries;
  detail.subagentCards = projections.subagentCards;
  detail.subagentHub = projections.subagentHub;
  detail.subagents = detail.subagents.map(({ writePaths: _writePaths, ...task }) =>
    task,
  );
  detail.operatorDecisions = projections.operatorDecisions;
  if (projections.activePlan) detail.activePlan = projections.activePlan;
  else delete detail.activePlan;
  return detail;
}
