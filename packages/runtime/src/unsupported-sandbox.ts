import type { OsSandboxAdapter, SandboxedProcess } from "./sandbox-types.js";
import {
  sandboxCleanup,
  sandboxLaunchFailure,
} from "./sandbox-execution-evidence.js";

export class UnsupportedSandboxAdapter implements OsSandboxAdapter {
  readonly id = "unsupported";

  constructor(private readonly platform: string) {}

  async launch(): Promise<SandboxedProcess> {
    throw sandboxLaunchFailure(
      new Error(
        `No OS sandbox adapter is available for platform: ${this.platform}`,
      ),
      sandboxCleanup("not_started", "sandbox_unavailable"),
    );
  }
}
