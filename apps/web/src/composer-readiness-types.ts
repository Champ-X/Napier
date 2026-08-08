export type ComposerReadinessState =
  | "ready"
  | "warn"
  | "blocked"
  | "inactive";

export interface ComposerReadinessItem {
  id: "network" | "sandbox" | "browser" | "permission";
  label: string;
  value: string;
  state: ComposerReadinessState;
  detail: string;
}

export interface ComposerRunReadiness {
  canRun: boolean;
  level: "ready" | "warn" | "blocked";
  message: string;
  items: ComposerReadinessItem[];
}

export function initialComposerRunReadiness(): ComposerRunReadiness {
  return {
    canRun: false,
    level: "blocked",
    message:
      "Checking effective Network, Sandbox, Browser, and permission readiness before sending.",
    items: [
      pendingItem("network", "Network"),
      pendingItem("sandbox", "Sandbox"),
      pendingItem("browser", "Browser"),
      pendingItem("permission", "Permission"),
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
    value: "Checking",
    state: "blocked",
    detail: "Effective capability readiness has not loaded.",
  };
}
