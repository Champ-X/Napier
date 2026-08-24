export type ToolConcurrency = "safe" | "serialized" | "exclusive";

export type ToolSideEffect =
  | "none"
  | "reversible"
  | "irreversible"
  | "unknown";

export type ToolJsonSchema = Record<string, unknown>;

export interface ToolDefinitionV2 {
  id: string;
  version: string;
  capabilityUris: string[];
  inputSchema: ToolJsonSchema;
  canonicalOutputSchema: ToolJsonSchema;
  modelVisibleOutputSchema: ToolJsonSchema;
  concurrency: ToolConcurrency;
  sideEffect: ToolSideEffect;
  policyTags: string[];
}

export interface CapabilityDescriptor {
  kind: "napier.capability-descriptor";
  schemaVersion: 1;
  uri: string;
  toolId: string;
  label: string;
  description: string;
  definition: ToolDefinitionV2;
  definitionSha256: string;
}

export type EditDialect =
  | "hashline"
  | "structured_patch"
  | "preview_apply";

export type EditIntent =
  | {
      kind: "content";
      target: string;
      expectedSha256: string | null;
      create?: { content: string; createParentDirectories?: boolean };
      replacements?: Array<{ oldText: string; newText: string }>;
      hashlineReplacements?: Array<{
        line?: number;
        anchorSha256: string;
        newText: string;
      }>;
    }
  | {
      kind: "filesystem";
      operation: "create_directory" | "move" | "trash" | "restore";
      path?: string;
      sourcePath?: string;
      destinationPath?: string;
      trashId?: string;
      createParentDirectories?: boolean;
    };

export interface EditDispatchPlan {
  kind: "napier.edit-dispatch-plan";
  schemaVersion: 1;
  dialect: EditDialect;
  intent: EditIntent;
  toolId: "apply_patch" | "workspace_file_preview";
  input: Record<string, unknown>;
  continuationToolId?: "workspace_file_apply";
  intentSha256: string;
}
