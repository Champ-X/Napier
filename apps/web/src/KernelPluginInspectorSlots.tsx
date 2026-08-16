import type { KernelPluginInspection } from "@napier/contracts/kernel-plugins";
import { lazy, Suspense } from "react";

import type { BrowserInspectorPanelProps } from "./BrowserInspectorPanel";
import { browserKernelInspectorSlot } from "./kernel-browser-inspector-slot";
import type { InspectorTab } from "./use-workspace-view-model";

const LazyBrowserInspectorPanel = lazy(browserKernelInspectorSlot.load);

const INSPECTOR_SLOT_CATALOG = [browserKernelInspectorSlot] as const;

export function resolveKernelInspectorSlots(
  plugins: readonly KernelPluginInspection[],
) {
  return INSPECTOR_SLOT_CATALOG.filter((entry) =>
    plugins.some(
      (plugin) =>
        plugin.id === entry.pluginId &&
        plugin.version === entry.version &&
        plugin.contentSha256 === entry.contentSha256 &&
        plugin.status === "enabled" &&
        plugin.clientEntry === entry.clientEntry &&
        plugin.capabilities.includes("ui_slot") &&
        plugin.contributions.uiSlots.includes(entry.slot),
    ),
  );
}

export function KernelPluginInspectorSlots({
  plugins = [],
  activeTab,
  browser,
}: {
  plugins?: readonly KernelPluginInspection[] | undefined;
  activeTab: InspectorTab;
  browser: Omit<BrowserInspectorPanelProps, "activeTab">;
}) {
  return resolveKernelInspectorSlots(plugins).map((entry) =>
    entry.tab === activeTab ? (
      <Suspense fallback={null} key={entry.pluginId}>
        <LazyBrowserInspectorPanel activeTab={activeTab} {...browser} />
      </Suspense>
    ) : null,
  );
}
