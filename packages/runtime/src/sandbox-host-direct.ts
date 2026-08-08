import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { launchSandboxProcess } from "./sandbox-process-lifecycle.js";
import { launchTerminalSandboxWrapper } from "./sandbox-terminal.js";
import type {
  OsSandboxAdapter,
  SandboxedProcess,
  SandboxLaunchRequest,
} from "./sandbox-types.js";

export const HOST_DIRECT_SANDBOX_ENV = "NAPIER_HOST_DIRECT_SANDBOX";

/**
 * Runs commands directly on the host with no OS isolation. This adapter is only
 * selected when the operator explicitly opts in, because it provides none of
 * the workspace, network, or resource boundaries the other adapters enforce. It
 * exists so hosts without a working OS sandbox or container runtime can still
 * execute process tasks under the operator's own authority.
 */
export class HostDirectSandboxAdapter implements OsSandboxAdapter {
  readonly id = "host-direct";

  constructor(private readonly spawnProcess = spawn) {}

  /** Whether the operator has explicitly opted into direct host execution. */
  static enabled(
    value: string | undefined = process.env[HOST_DIRECT_SANDBOX_ENV],
  ): boolean {
    const normalized = value?.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }

  async launch(request: SandboxLaunchRequest): Promise<SandboxedProcess> {
    const sandboxHome = await mkdtemp(
      path.join(tmpdir(), "napier-host-direct-"),
    );
    const target = {
      command: request.command,
      args: [...request.args],
      cwd: request.cwd,
      env: { ...request.env, HOME: sandboxHome, TMPDIR: sandboxHome },
    };
    if (request.terminal) {
      return launchTerminalSandboxWrapper({
        ...target,
        columns: request.terminal.columns,
        rows: request.terminal.rows,
        sandboxHome,
      });
    }
    return launchSandboxProcess({
      ...target,
      sandboxHome,
      parentDeathGuard: request.parentDeathGuard === true,
      spawnProcess: this.spawnProcess,
    });
  }
}
