import type {
  OsSandboxAdapter,
  SandboxedProcess,
  SandboxCommandRuntime,
  SandboxCommandRuntimeBinding,
  SandboxLaunchRequest,
  SandboxLspRuntimeBinding,
  SandboxNodeDebuggerRuntimeBinding,
  SandboxVerificationRuntimeBinding,
} from "./sandbox-types.js";

export class SwitchableSandboxAdapter implements OsSandboxAdapter {
  private version = 0;

  constructor(private active: OsSandboxAdapter) {}

  get id(): string {
    return this.active.id;
  }

  get readinessVersion(): number {
    return this.version;
  }

  get setupIdentitySha256(): string | undefined {
    return this.active.setupIdentitySha256;
  }

  current(): OsSandboxAdapter {
    return this.active;
  }

  replace(next: OsSandboxAdapter): void {
    this.active = next;
    this.version += 1;
  }

  resolveCommandRuntime(
    runtime: SandboxCommandRuntime,
  ): Promise<SandboxCommandRuntimeBinding> | undefined {
    return this.active.resolveCommandRuntime?.(runtime);
  }

  resolveLspRuntime(): Promise<SandboxLspRuntimeBinding> | undefined {
    return this.active.resolveLspRuntime?.();
  }

  resolveNodeDebuggerRuntime():
    | Promise<SandboxNodeDebuggerRuntimeBinding>
    | undefined {
    return this.active.resolveNodeDebuggerRuntime?.();
  }

  resolveVerificationRuntime():
    | Promise<SandboxVerificationRuntimeBinding>
    | undefined {
    return this.active.resolveVerificationRuntime?.();
  }

  launch(request: SandboxLaunchRequest): Promise<SandboxedProcess> {
    return this.active.launch(request);
  }
}
