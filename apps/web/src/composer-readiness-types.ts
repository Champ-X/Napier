import { composerCopy } from "./composer-copy";

export type ComposerReadinessState = "ready" | "warn" | "blocked" | "inactive";

export interface ComposerReadinessItem {
  id: "network" | "sandbox" | "browser" | "permission";
  label: string;
  value: string;
  state: ComposerReadinessState;
  detail: string;
  /**
   * Marks the item as an unresolved placeholder while effective readiness is
   * still loading. Pending detection reads this flag instead of matching the
   * localized `value`, so the "checking" state survives translation.
   */
  pending?: boolean;
}

export interface ComposerRunReadiness {
  canRun: boolean;
  level: "ready" | "warn" | "blocked";
  message: string;
  items: ComposerReadinessItem[];
}

export function initialComposerRunReadiness(): ComposerRunReadiness {
  const { labels } = composerCopy;
  return {
    canRun: false,
    level: "blocked",
    message: composerCopy.messages.checking,
    items: [
      pendingItem("network", labels.network),
      pendingItem("sandbox", labels.sandbox),
      pendingItem("browser", labels.browser),
      pendingItem("permission", labels.permission),
    ],
  };
}

function pendingItem(
  id: ComposerReadinessItem["id"],
  label: string,
): ComposerReadinessItem {
  return {
    id,
    label,
    value: composerCopy.values.checking,
    state: "blocked",
    detail: composerCopy.details.pending,
    pending: true,
  };
}
