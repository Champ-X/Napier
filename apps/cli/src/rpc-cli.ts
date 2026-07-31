import path from "node:path";
import type { Readable, Writable } from "node:stream";

import {
  streamRunErrorFrame,
  type LocalAgentRuntimeOptions,
  type LocalAgentRuntimeServices,
} from "@napier/runtime";

import { CLI_VERSION, type CliRpcOptions } from "./cli-options.js";
import { writeLine } from "./cli-output.js";
import { runNapierRpcServer } from "./rpc-server.js";
import { canonicalWorkspace } from "./workspace-path.js";

export interface RpcCliIo {
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
  stdin?: Readable;
  stdout: Writable;
  stderr: Writable;
}

export interface RpcCliDependencies {
  createRuntime(
    options: LocalAgentRuntimeOptions,
  ): Promise<LocalAgentRuntimeServices>;
}

export async function executeRpc(
  options: CliRpcOptions,
  io: RpcCliIo,
  dependencies: RpcCliDependencies,
  parentSignal?: AbortSignal,
): Promise<number> {
  let services: LocalAgentRuntimeServices | undefined;
  try {
    if (!io.stdin) throw new Error("RPC stdin is unavailable");
    parentSignal?.throwIfAborted();
    const workspaceRoot = await canonicalWorkspace(options.workspace, io.cwd);
    const dataRoot = path.resolve(
      io.cwd,
      options.dataRoot ?? path.join(workspaceRoot, ".napier"),
    );
    services = await dependencies.createRuntime({
      workspaceRoot,
      dataRoot,
      env: io.env,
    });
    return await runNapierRpcServer({
      agents: services.embeddedAgents,
      workflows: services.embeddedWorkflows,
      experiments: services.workflowExperiments,
      input: io.stdin,
      output: io.stdout,
      serverVersion: CLI_VERSION,
      ...(parentSignal ? { signal: parentSignal } : {}),
    });
  } catch (error) {
    const frame = streamRunErrorFrame("thread_cli_rpc_bootstrap", error);
    await writeLine(
      io.stderr,
      `Napier RPC failed: ${frame.message} (${frame.diagnosticSha256.slice(0, 12)})`,
    );
    return 1;
  } finally {
    await services?.shutdown().catch(() => undefined);
  }
}
