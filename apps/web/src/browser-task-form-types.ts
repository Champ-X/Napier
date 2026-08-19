import type { CredentialReference, ModelSummary } from "@napier/contracts";

import type { BrowserTaskModelProvider } from "./browser-task-api";

export interface BrowserTaskFormDefaults {
  defaultModel: { provider: BrowserTaskModelProvider; id: string };
  defaultCredentialEnv: string;
  defaultMaxSteps: number;
  models: readonly ModelSummary[];
  credentials: readonly CredentialReference[];
}
