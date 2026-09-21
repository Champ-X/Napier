import { PythonDebuggerManager } from "./python-debugger.js";
import type { DapOwner, DapProcesses } from "./dap-process-session.js";
import { pythonDebuggerToolchainOptions } from "./toolchain-debugger-provider.js";
import { sha256 } from "./ed25519.js";

type DebuggerInput =
  | (Omit<Parameters<PythonDebuggerManager["launch"]>[0], keyof DapOwner> & {
      action: "launch";
      timeoutMs?: number;
      programPath?: string;
      sourceMapPath?: string;
      pauseOnExceptions?: string;
    })
  | (Omit<Parameters<PythonDebuggerManager["execute"]>[0], keyof DapOwner> & {
      timeoutMs?: number;
    });

export class PythonDebuggerToolRuntime {
  private readonly managers = new Map<string, PythonDebuggerManager>();
  constructor(private readonly processes: DapProcesses) {}

  async execute(owner: DapOwner, input: DebuggerInput, signal?: AbortSignal) {
    const options = pythonDebuggerToolchainOptions();
    const key = JSON.stringify(owner);
    let manager = this.managers.get(key);
    if (!manager) {
      if (input.action !== "launch")
        throw new Error("Python debugger session is not owned by this Run");
      manager = new PythonDebuggerManager(this.processes, options);
      this.managers.set(key, manager);
    }
    if (
      input.action === "launch" &&
      (input.programPath !== undefined ||
        input.sourceMapPath !== undefined ||
        input.pauseOnExceptions !== undefined ||
        input.breakpoints.some((b) => b.column !== undefined))
    )
      throw new Error(
        "Python debugger does not support source maps, breakpoint columns or pauseOnExceptions",
      );
    const result =
      input.action === "launch"
        ? await manager.launch({
            ...owner,
            path: input.path,
            breakpoints: input.breakpoints,
            ...(input.args ? { args: input.args } : {}),
            ...(input.sessionTimeoutMs
              ? { sessionTimeoutMs: input.sessionTimeoutMs }
              : {}),
            ...(input.timeoutMs ? { actionTimeoutMs: input.timeoutMs } : {}),
            ...(signal ? { signal } : {}),
          })
        : await manager.execute({
            ...owner,
            ...input,
            ...(input.timeoutMs ? { actionTimeoutMs: input.timeoutMs } : {}),
            ...(signal ? { signal } : {}),
          });
    const { data, output, sourcePath, ...details } = result;
    const text = JSON.stringify({ ...result, untrustedLiveData: true });
    if (Buffer.byteLength(text, "utf8") > 32 * 1024) {
      await manager.cancelRun(owner);
      throw new Error("Python debugger tool output exceeds 32768 UTF-8 bytes");
    }
    return {
      content: [{ type: "text" as const, text }],
      details: {
        ...details,
        sourcePathSha256: sha256(sourcePath),
      },
    };
  }

  async cancelRun(owner: DapOwner): Promise<void> {
    const key = JSON.stringify(owner);
    await this.managers.get(key)?.cancelRun(owner);
    this.managers.delete(key);
  }
}
