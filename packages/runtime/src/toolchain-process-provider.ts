import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type TSchema } from "typebox";
import { preserveAgentToolIdentity } from "./agent-tool-metadata.js";
import { withProcessToolchainEnvironment } from "./toolchain-process-options.js";
import { withToolchainProcessProgress } from "./toolchain-process-progress.js";

/** Keep the admitted tool and its complete control/write lifecycle. Only Python
 * start/preview selects a workspace environment; subsequent actions use the
 * original process/preview identity, including cancellation and recovery. */
export function withToolchainProcessProvider(tool: AgentTool): AgentTool {
  if (tool.name !== "workspace_process") return tool;
  const parameters = structuredClone(tool.parameters);
  extendPythonRuntime(parameters);
  return withToolchainProcessProgress(
    preserveAgentToolIdentity(tool, {
      ...tool,
      parameters,
      execute: (id, input, signal, onUpdate) =>
        withProcessToolchainEnvironment(() =>
          tool.execute(id, input, signal, onUpdate),
        ),
      description:
        "Node/Python argv; POSIX shell. Python: cwd .venv or pinned runtime. Redacted; read-only starts. Writes: preview_write (1-8 scopes), start_write, Delta. OCI: healthy port, outbound denied. Host-direct: no isolation or services.",
    }),
  );
}

function extendPythonRuntime(schema: TSchema): void {
  const node = schema as TSchema & {
    properties?: Record<string, TSchema>;
    anyOf?: TSchema[];
    oneOf?: TSchema[];
  };
  const properties = node.properties;
  if (properties?.["runtime"]) {
    properties["runtime"] = Type.Union([
      Type.Literal("node"),
      Type.Literal("shell"),
      Type.Literal("python"),
    ]);
  }
  for (const key of ["anyOf", "oneOf"] as const)
    for (const child of node[key] ?? []) extendPythonRuntime(child);
}
