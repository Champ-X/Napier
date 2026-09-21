import type { AgentTool } from "@earendil-works/pi-agent-core";
import { AsyncLocalStorage } from "node:async_hooks";
import { Type, type TSchema } from "typebox";
import { preserveAgentToolIdentity } from "./agent-tool-metadata.js";
import type { ToolchainOptions } from "./python-toolchain.js";

const scope = new AsyncLocalStorage<ToolchainOptions>();

export function pythonDebuggerToolchainOptions(): ToolchainOptions {
  const options = scope.getStore();
  if (!options)
    throw new Error("Python debugger requires the workspace toolchain policy");
  return options;
}

/** Extend only the admitted debugger; execute still crosses its original guards. */
export function withToolchainDebuggerProvider(
  tool: AgentTool,
  options: ToolchainOptions,
): AgentTool {
  const parameters = structuredClone(tool.parameters) as TSchema & {
    anyOf?: Array<TSchema & { properties: Record<string, TSchema> }>;
  };
  for (const variant of parameters.anyOf ?? []) {
    variant.properties.runtime = Type.Optional(
      Type.Union([Type.Literal("node"), Type.Literal("python")]),
    );
  }
  return preserveAgentToolIdentity(tool, {
    ...tool,
    parameters,
    description:
      "Run-owned DAP debugging: launch, stack_trace, scopes, variables, evaluate, continue/next/step_in/step_out/cancel. Paths are workspace-relative; retain processId and observed frame/reference IDs. runtime=node is default (offline sandbox, throwOnSideEffect; paired programPath/sourceMapPath supports compiled TS). runtime=python requires debugpy: OCI uses its image Python in an offline container; host-direct uses .venv/pinned Python with NO isolation. Omit source maps, columns and pauseOnExceptions for Python; inspection/evaluation can execute code. Use runtime=python on EVERY Python action. timeoutMs bounds actions. Paths, values and output are live-only.",
    execute: (id, input, signal, onUpdate) =>
      scope.run(options, () => tool.execute(id, input, signal, onUpdate)),
  });
}
