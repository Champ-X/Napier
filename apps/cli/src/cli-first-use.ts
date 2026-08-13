import { executeCapabilities } from "./capability-cli.js";
import { executeBrowserRuntimeSetup } from "./browser-runtime-setup-cli.js";
import { executeBrowserUseLocalSetup } from "./browser-use-local-setup-cli.js";
import { parseCapabilityOptions } from "./cli-capability-options.js";
import { parseDoctorOptions } from "./cli-doctor-options.js";
import { parseSetupOptions } from "./cli-setup-options.js";
import { executeDoctor } from "./doctor-cli.js";
import type { CliFirstUseAction } from "./cli-first-use-model.js";
import { executeSetup } from "./setup-cli.js";
import { executeSandboxRuntimeSetup } from "./sandbox-runtime-setup-cli.js";
import type { CliIo, RunCliDependencies } from "./cli-runtime.js";

export function isFirstUseCliAction(action: {
  kind: string;
}): action is CliFirstUseAction {
  return (
    action.kind === "doctor" ||
    action.kind === "capabilities" ||
    action.kind === "setup"
  );
}

export function parseFirstUseCliAction(
  command: string,
  values: Map<string, string>,
  flags: ReadonlySet<string>,
  jsonl: boolean,
): CliFirstUseAction | undefined {
  if (command === "doctor") return parseDoctorOptions(values, flags, jsonl);
  if (command === "capabilities") {
    return parseCapabilityOptions(values, flags, jsonl);
  }
  if (command === "setup") return parseSetupOptions(values, flags, jsonl);
  return undefined;
}

export async function executeFirstUseCliAction(
  action: CliFirstUseAction,
  io: CliIo,
  dependencies: RunCliDependencies,
  signal?: AbortSignal,
): Promise<number> {
  if (action.kind === "doctor") {
    return executeDoctor(action.options, io, dependencies.doctor, signal);
  }
  if (action.kind === "setup") {
    if (action.options.component === "browser-use-local") {
      return executeBrowserUseLocalSetup(
        action.options,
        io,
        dependencies.browserUseLocalSetup,
        signal,
      );
    }
    if (action.options.component === "browser") {
      return executeBrowserRuntimeSetup(
        action.options,
        io,
        dependencies.browserSetup,
        signal,
      );
    }
    if (action.options.component === "sandbox") {
      return executeSandboxRuntimeSetup(
        action.options,
        io,
        dependencies.sandboxSetup,
        signal,
      );
    }
    return executeSetup(action.options, io, dependencies, signal);
  }
  return executeCapabilities(action.options, io, dependencies, signal);
}
