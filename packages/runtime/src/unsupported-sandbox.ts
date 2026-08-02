import type { OsSandboxAdapter, SandboxedProcess } from "./sandbox-types.js";

export class UnsupportedSandboxAdapter implements OsSandboxAdapter {
  readonly id = "unsupported";

  constructor(private readonly platform: string) {}

  async launch(): Promise<SandboxedProcess> {
    throw new Error(
      `No OS sandbox adapter is available for platform: ${this.platform}`,
    );
  }
}
