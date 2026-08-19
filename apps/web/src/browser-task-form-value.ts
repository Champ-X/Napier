import type {
  BrowserTaskBackend,
  BrowserTaskModelProvider,
} from "./browser-task-api";
import { browserTaskCopy } from "./browser-task-copy";
import type { BrowserTaskFormValue } from "./use-browser-task-runner";

export function browserTaskFormValue(data: FormData): BrowserTaskFormValue {
  const backend = field(data, "backend") as BrowserTaskBackend;
  if (backend === "browser_use_cloud" && !data.has("cloudConsent")) {
    throw new Error(browserTaskCopy.form.cloudDisclosure.consentRequired);
  }
  return {
    backend,
    task: field(data, "task"),
    startUrl: field(data, "startUrl"),
    allowedDomains: field(data, "allowedDomains"),
    provider: field(data, "provider") as BrowserTaskModelProvider,
    modelId: field(data, "modelId"),
    credentialEnv: field(data, "credentialEnv"),
    maxSteps: Number(field(data, "maxSteps")),
    maxCostUsd:
      backend === "browser_use_cloud" ? Number(field(data, "maxCostUsd")) : 1,
  };
}

function field(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}
