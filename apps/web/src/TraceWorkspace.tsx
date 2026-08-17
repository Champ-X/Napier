import { lazy, Suspense } from "react";

import { copy } from "./copy";
import type { useWorkspaceViewModel } from "./use-workspace-view-model";

const LazyTracePanel = lazy(() => import("./TracePanel"));
type WorkspaceViewModel = ReturnType<typeof useWorkspaceViewModel>;

export function TraceWorkspace({
  vm,
  activeModel,
}: {
  vm: WorkspaceViewModel;
  activeModel: WorkspaceViewModel["selectedModel"];
}) {
  return (
    <section
      id="workspace-panel-trace"
      className="workspace-view-panel trace-workspace-view"
      role="tabpanel"
      aria-labelledby="workspace-view-trace"
    >
      <Suspense
        fallback={
          <div className="context-loading" role="status">
            {copy.trace.title}
          </div>
        }
      >
        <LazyTracePanel
          events={vm.visibleTrace}
          subagents={vm.detail?.subagents ?? []}
          runs={vm.detail?.runs ?? []}
          running={vm.isRunning}
          exportBusy={vm.traceExportBusy}
          exportReceipt={vm.traceExportReceipt}
          verifyBusy={vm.traceVerifyBusy}
          verificationReceipt={vm.traceVerificationReceipt}
          reviewerModel={{
            provider: activeModel.provider,
            id: activeModel.id,
          }}
          reviewerModelConfigured={activeModel.configured}
          onExport={(runId) => void vm.exportOpenTelemetryTrace(runId)}
          onVerify={(file) =>
            void vm.verifyOpenTelemetryTraceArtifactFile(file)
          }
        />
      </Suspense>
    </section>
  );
}
