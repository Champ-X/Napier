import { Globe2 } from "lucide-react";

import type { CredentialReference, ModelSummary } from "@napier/contracts";

import { BrowserTaskEvidence } from "./BrowserTaskEvidence";
import { BrowserTaskForm } from "./BrowserTaskForm";
import { BrowserTaskTerminal } from "./BrowserTaskTerminal";
import { useBrowserTaskRunner } from "./use-browser-task-runner";
import type { SelectedModelAvailability } from "./model-selection-view-model";
import type { BrowserTaskModelProvider } from "./browser-task-api";
import { browserTaskCopy } from "./browser-task-copy";
import "./browser-task.css";
import "./browser-task-boundaries.css";

export interface BrowserUseLocalTaskPanelProps {
  defaultModelId?: string;
  defaultCredentialEnv?: string;
  defaultMaxSteps?: number;
  models?: readonly ModelSummary[];
  credentials?: readonly CredentialReference[];
  selectedModel?: SelectedModelAvailability;
}

export function BrowserUseLocalTaskPanel({
  defaultModelId = "gpt-4.1-mini",
  defaultCredentialEnv = "OPENAI_API_KEY",
  defaultMaxSteps = 12,
  models = [],
  credentials = [],
  selectedModel,
}: BrowserUseLocalTaskPanelProps) {
  const runner = useBrowserTaskRunner();
  const defaultModel = browserTaskDefaultModel(selectedModel, models, {
    provider: "openai",
    id: defaultModelId,
  });
  return (
    <div className="browser-task-card">
      <div className="browser-task-heading">
        <Globe2 size={16} aria-hidden="true" />
        <div>
          <strong>{browserTaskCopy.panel.title}</strong>
          <p>{browserTaskCopy.panel.description}</p>
        </div>
      </div>
      <BrowserTaskForm
        runner={runner}
        defaults={{
          defaultModel,
          defaultCredentialEnv,
          defaultMaxSteps,
          models,
          credentials,
        }}
      />
      {runner.error ? (
        <p className="browser-task-error" role="alert">
          {runner.error}
        </p>
      ) : null}
      <BrowserTaskEvidence events={runner.events} />
      {runner.events.findLast(isTerminal) ? (
        <BrowserTaskTerminal event={runner.events.findLast(isTerminal)!} />
      ) : null}
    </div>
  );
}

const BROWSER_TASK_PROVIDERS = new Set<BrowserTaskModelProvider>([
  "openai",
  "anthropic",
  "google",
  "browser-use",
  "deepseek",
  "openrouter",
]);

export function browserTaskDefaultModel(
  selectedModel: SelectedModelAvailability | undefined,
  models: readonly ModelSummary[],
  fallback: { provider: BrowserTaskModelProvider; id: string },
): { provider: BrowserTaskModelProvider; id: string } {
  if (
    selectedModel?.configured &&
    BROWSER_TASK_PROVIDERS.has(
      selectedModel.provider as BrowserTaskModelProvider,
    )
  ) {
    return {
      provider: selectedModel.provider as BrowserTaskModelProvider,
      id: selectedModel.id,
    };
  }
  const configured = models.find(
    (model) =>
      model.configured &&
      BROWSER_TASK_PROVIDERS.has(model.provider as BrowserTaskModelProvider),
  );
  return configured
    ? {
        provider: configured.provider as BrowserTaskModelProvider,
        id: configured.id,
      }
    : fallback;
}

function isTerminal(
  event: import("./browser-task-api").BrowserTaskApiEvent,
): event is Extract<
  import("./browser-task-api").BrowserTaskApiEvent,
  { type: "completed" | "error" }
> {
  return event.type === "completed" || event.type === "error";
}
