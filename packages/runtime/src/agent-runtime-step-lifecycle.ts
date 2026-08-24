import type { AgentTool, StreamFn } from "@earendil-works/pi-agent-core";
import type {
  Api,
  Context,
  Message,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type {
  AgentProfile,
  DelegationLedgerProjection,
  RunRecord,
} from "@napier/contracts";

import { createEffectiveCapabilitiesPromptBuilder } from "./effective-capabilities-prompt-builder.js";
import { runAgentStepLifecycleStream } from "./agent-step-lifecycle-stream.js";
import type { AgentMilestoneContextProjection } from "./agent-milestones.js";
import type { AgentTurnPipeline } from "./agent-turn-pipeline.js";
import type { AgentModelStreamLifecycleInput } from "./agent-model-stream-lifecycle.js";
import { modelAdapterReceipt } from "./model-adapters.js";
import type { CompiledPromptArtifact } from "./prompt-compiler.js";
import type { ActiveToolLoopGuard } from "./tool-loop-guard.js";
import { createAgentStepCapabilityView } from "./lifecycle-extension-pipeline.js";
import type { AgentLifecyclePipelineHost } from "./lifecycle-extension-pipeline.js";
import { modernRunConfiguration } from "./effective-run-profile.js";
import { formatEditDialectGuidance } from "./edit-dialect-adapter.js";
import type { ModelHarnessExperimentProfile } from "./model-harness-experiment-profile.js";

export function wrapAgentToolsWithLifecycle(input: {
  tools: readonly AgentTool[];
  lifecycles: AgentLifecyclePipelineHost;
  run: Pick<RunRecord, "id" | "threadId">;
  stepIndex: () => number;
}): AgentTool[] {
  return input.tools.map((tool) => ({
    ...tool,
    execute: (toolCallId, args, toolSignal, onUpdate) =>
      input.lifecycles.tool.execute(
        {
          kind: "tool",
          runId: input.run.id,
          threadId: input.run.threadId,
          stepIndex: input.stepIndex(),
          toolCall: Object.freeze({ id: toolCallId, name: tool.name }),
          input: structuredClone(args),
          ...(toolSignal ? { signal: toolSignal } : {}),
        },
        () => tool.execute(toolCallId, args as never, toolSignal, onUpdate),
      ),
  }));
}

export function createLifecycleAgentStepStream(input: {
  delegate: StreamFn;
  lifecycles: AgentLifecyclePipelineHost;
  run: Pick<RunRecord, "id" | "threadId">;
  toolSetSha256: string;
  onStep(index: number, activeToolNames: Set<string>): void;
}): StreamFn {
  let stepIndex = 0;
  return (model, context, options) => {
    stepIndex += 1;
    const capabilityView = createAgentStepCapabilityView({
      toolNames: (context.tools ?? []).map((tool) => tool.name),
      schemaVersion: input.toolSetSha256,
    });
    return runAgentStepLifecycleStream({
      model,
      context: {
        kind: "step",
        runId: input.run.id,
        threadId: input.run.threadId,
        stepIndex,
        model: { provider: model.provider, id: model.id },
        capabilityView,
        ...(options?.signal ? { signal: options.signal } : {}),
      },
      pipeline: input.lifecycles.step,
      invoke: () => {
        const activeToolNames = new Set(capabilityView.activeToolNames());
        input.onStep(stepIndex, activeToolNames);
        const activeTools = context.tools?.filter((tool) =>
          activeToolNames.has(tool.name),
        );
        return input.delegate(
          model,
          { ...context, ...(activeTools ? { tools: activeTools } : {}) },
          options,
        );
      },
    });
  };
}

export function createRuntimeCompiledPromptBuilder(input: {
  turnPipeline: AgentTurnPipeline;
  profile: AgentProfile;
  run: RunRecord;
  sandboxId: string;
  restrictedReadOnlyExecution: boolean;
  environmentDegradedExecution: boolean;
  advisorCorrection: boolean;
  browserInteractionConfirmationAvailable: boolean;
  resolvedSystemPrompt: string;
  skillCatalog: string;
  workspaceToolGuidance: string;
  planToolGuidance: string;
  sourceContinuityGuidance: string;
  importedLedgerBoundary: string;
  checkpoint: string;
  memory: string;
  delegation(): DelegationLedgerProjection;
  milestones(): AgentMilestoneContextProjection;
  toolLoopGuard(): ActiveToolLoopGuard | undefined;
  harnessExperimentProfile?: ModelHarnessExperimentProfile | undefined;
}): AgentModelStreamLifecycleInput["buildCompiledPrompt"] {
  return (
    requestModel: Model<Api>,
    requestOptions: SimpleStreamOptions | undefined,
    requestContext: Context,
  ): CompiledPromptArtifact => {
    const adapter = modelAdapterReceipt(requestModel, requestOptions);
    const activeToolNames = (requestContext.tools ?? []).map(
      (tool) => tool.name,
    );
    const effectiveCapabilities = createEffectiveCapabilitiesPromptBuilder({
      requestedTools: input.profile.enabledTools,
      toolPolicy: input.profile.toolPolicy,
      sandboxId: input.sandboxId,
      restrictedReadOnlyExecution: input.restrictedReadOnlyExecution,
      executionMode: runExecutionMode(input.run),
      advisorCorrection: input.advisorCorrection,
      browserInteractionConfirmationAvailable:
        input.browserInteractionConfirmationAvailable &&
        !input.environmentDegradedExecution,
      model: requestModel,
      messages: requestContext.messages as readonly Message[],
      ...(input.harnessExperimentProfile
        ? { harnessExperimentProfile: input.harnessExperimentProfile }
        : {}),
    })(activeToolNames, adapter, requestContext.messages);
    return input.turnPipeline.createPromptBuilder({
      resolvedSystemPrompt: input.resolvedSystemPrompt,
      skillCatalog: input.skillCatalog,
      effectiveCapabilities,
      workspaceToolGuidance: [
        input.workspaceToolGuidance,
        formatEditDialectGuidance({
          model: requestModel,
          availableToolNames: activeToolNames,
        }),
      ]
        .filter(Boolean)
        .join("\n\n"),
      planToolGuidance: input.planToolGuidance,
      sourceContinuityGuidance: input.sourceContinuityGuidance,
      importedLedgerBoundary: input.importedLedgerBoundary,
      checkpoint: input.checkpoint,
      memory: input.memory,
    })(adapter, input.delegation(), input.milestones(), input.toolLoopGuard());
  };
}

function runExecutionMode(run: RunRecord) {
  return modernRunConfiguration(run.configuration)
    ? run.configuration.executionMode
    : "standard";
}
