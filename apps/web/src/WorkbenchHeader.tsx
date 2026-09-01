import type { ModelSummary, ThreadStatus } from "@napier/contracts";
import type { ReactNode } from "react";
import { Folder } from "lucide-react";

import { copy } from "./copy";
import { ModelPicker } from "./ModelPicker";
import type { ModelPickerSetupConfig } from "./ModelPickerProviderSetup";
import { workspaceEvidenceCopy as workspaceCopy } from "./workspace-evidence-copy";

type HeaderModel = {
  configured: boolean;
  id: string;
  key: string;
  provider: string;
};

export function WorkbenchHeader({
  isRunning,
  model,
  models,
  status,
  title,
  contextLabel,
  children,
  taskStatus,
  recommendedModelKeys,
  recentModelKeys,
  modelSetup,
  onModel,
  workspaceRailOpen = true,
  onToggleWorkspaceRail,
}: {
  isRunning: boolean;
  model: HeaderModel;
  models: readonly ModelSummary[];
  status: ThreadStatus | undefined;
  title: string;
  contextLabel: string;
  children?: ReactNode;
  taskStatus?: ReactNode;
  recommendedModelKeys?: readonly string[];
  recentModelKeys?: readonly string[];
  modelSetup?: ModelPickerSetupConfig;
  onModel(value: string): void;
  workspaceRailOpen?: boolean;
  onToggleWorkspaceRail?(): void;
}) {
  return (
    <header className="workbench-header">
      <div className="thread-heading">
        {title ? (
          <h1 title={`${contextLabel} · ${title}`}>{title}</h1>
        ) : (
          <span className="thread-heading-idle">
            <strong>{copy.appName}</strong>
            <small>{copy.appDescriptor}</small>
          </span>
        )}
      </div>
      {children}
      <div className="run-meta">
        {taskStatus ?? (
          <div
            className={`run-status ${isRunning ? "is-running" : ""}`}
            role="status"
            aria-live="polite"
          >
            <span />
            {isRunning ? copy.running : statusLabel(status)}
          </div>
        )}
        <ModelPicker
          models={models}
          value={model.key}
          label={copy.settingsSurface.contextSection}
          disabled={isRunning}
          variant="compact"
          recommendedModelKeys={recommendedModelKeys}
          recentModelKeys={recentModelKeys}
          setup={modelSetup}
          onChange={onModel}
        />
        {onToggleWorkspaceRail ? (
          <button
            id="workspace-rail-toggle"
            className="workspace-rail-toggle"
            type="button"
            aria-controls="workspace-evidence-rail"
            aria-label={
              workspaceRailOpen
                ? workspaceCopy.hideRail
                : workspaceCopy.showRail
            }
            aria-pressed={workspaceRailOpen}
            title={
              workspaceRailOpen
                ? workspaceCopy.hideRail
                : workspaceCopy.showRail
            }
            onClick={onToggleWorkspaceRail}
          >
            <Folder size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </header>
  );
}

function statusLabel(status?: ThreadStatus): string {
  if (status === "failed") return copy.failed;
  if (status === "waiting") return copy.waiting;
  return copy.idle;
}
