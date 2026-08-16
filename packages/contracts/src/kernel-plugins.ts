export interface KernelPluginInspection {
  id: string;
  version: string;
  displayName: string;
  description: string;
  status: "disabled" | "enabled";
  trust: "first_party";
  dependencies: Array<{ id: string; versionRange: string }>;
  capabilities: string[];
  permissions: string[];
  hostEntry: string;
  clientEntry?: string;
  contributions: {
    tools: string[];
    providers: string[];
    prompts: string[];
    projections: string[];
    uiSlots: string[];
  };
  contentSha256: string;
}
