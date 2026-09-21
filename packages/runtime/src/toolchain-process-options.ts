import {
  pythonToolchainOptions,
  type ToolchainOptions,
  type ToolchainCommandRequest,
} from "./python-toolchain.js";
import { AsyncLocalStorage } from "node:async_hooks";

const workspaceEnvironment = new AsyncLocalStorage<boolean>();

export function withProcessToolchainEnvironment<T>(operation: () => T): T {
  return workspaceEnvironment.run(true, operation);
}

/** The scope is established by the policy decorator, never model arguments. */
export function workspaceToolchainEnvironment(runtime: string): {
  toolchainEnvironment?: "workspace";
} {
  if (runtime !== "python") return {};
  if (!workspaceEnvironment.getStore())
    throw new Error("Python process requires the workspace toolchain policy");
  return { toolchainEnvironment: "workspace" };
}

/** An environment selector, never an executable path supplied by the model.
 * Kernel/private protocol callers without this selector keep their pinned runtime. */
export async function processToolchainOptions(
  options: ToolchainOptions,
  request: {
    command: Pick<ToolchainCommandRequest, "runtime" | "cwd">;
    toolchainEnvironment?: "workspace";
  },
): Promise<ToolchainOptions> {
  if (request.toolchainEnvironment === undefined) return options;
  if (
    request.toolchainEnvironment !== "workspace" ||
    request.command.runtime !== "python"
  )
    throw new Error("Workspace toolchain environment requires Python");
  return pythonToolchainOptions(options, request.command.cwd);
}
