import { mkdirSync } from "node:fs";
import { PassThrough } from "node:stream";

import { AgentRuntime } from "../src/agent-runtime.js";
import type { McpExtensionManager } from "../src/mcp.js";
import type { ModelRegistry } from "../src/models.js";
import type {
  OsSandboxAdapter,
  SandboxedProcess,
  SandboxLaunchRequest,
} from "../src/sandbox.js";
import type { LocalStore } from "../src/store.js";

export function processReadyAgentRuntime(
  store: LocalStore,
  registry: ModelRegistry,
  extensionManager?: McpExtensionManager,
): AgentRuntime {
  mkdirSync(store.workspaceRoot, { recursive: true });
  return new AgentRuntime(
    store,
    registry,
    extensionManager,
    processReadySandbox("agent-runtime-test"),
  );
}

export function processReadySandbox(
  id: string,
  launchOther?: (request: SandboxLaunchRequest) => Promise<SandboxedProcess>,
): OsSandboxAdapter {
  return {
    id,
    launch(request) {
      return isProcessReadinessProbe(request)
        ? Promise.resolve(settledProcess("napier_shell_probe_v1"))
        : launchOther
          ? launchOther(request)
          : Promise.reject(
              new Error("Fixture does not execute non-readiness commands"),
            );
    },
  };
}

export function isProcessReadinessProbe(
  request: Pick<SandboxLaunchRequest, "args">,
): boolean {
  return request.args.some((argument) =>
    argument.includes("napier_shell_probe_v1"),
  );
}

export function settledProcess(stdoutText: string): SandboxedProcess {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  void Promise.resolve().then(() => {
    stdout.end(stdoutText);
    stderr.end();
  });
  return {
    stdin,
    stdout,
    stderr,
    exit: Promise.resolve({ code: 0, signal: null }),
    terminate: async () => undefined,
  };
}
