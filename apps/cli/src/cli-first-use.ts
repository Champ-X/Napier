import type { CliAction } from "./cli-options.js";
import { executeCapabilities } from "./capability-cli.js";
import { executeDoctor } from "./doctor-cli.js";
import type { CliIo, RunCliDependencies } from "./cli-runtime.js";

type CliFirstUseAction = Extract<
  CliAction,
  { kind: "doctor" | "capabilities" }
>;

export async function executeFirstUseCliAction(
  action: CliFirstUseAction,
  io: CliIo,
  dependencies: RunCliDependencies,
  signal?: AbortSignal,
): Promise<number> {
  if (action.kind === "doctor") {
    return executeDoctor(action.options, io, dependencies.doctor, signal);
  }
  return executeCapabilities(action.options, io, dependencies, signal);
}
