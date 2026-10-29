/** Capacity units are owned executions/sessions/tasks, not an OS process census. */
export type ExecutionResourceKind =
  | "sandbox_execution"
  | "browser_session"
  | "browser_task";

/** Backend-issued identity. A PID alone never proves cleanup or safe recovery. */
export interface ExecutionResourceIdentity {
  resourceId: string;
  identitySha256?: string;
}

/** Evidence is about this declared ownership scope; it makes no claim about
 * unobserved escaped descendants or provider resources outside that scope. */
export interface ExecutionResourceCleanup {
  status: "not_started" | "released" | "unknown";
  scope: ExecutionResourceKind;
  /** A bounded diagnostic code, without command arguments or credentials. */
  reason: string;
}

export interface ExecutionResourceLease {
  readonly id: string;
  /** Must be durably recorded before the first potentially resource-creating call. */
  dispatched(): void;
  /** Record the backend identity as soon as it becomes available. */
  bind(identity: ExecutionResourceIdentity): void;
  /** Unknown cleanup retains capacity. Repeated identical evidence is idempotent. */
  settle(evidence: ExecutionResourceCleanup): void;
}

export interface ExecutionResourceAdmission {
  reserve(request: {
    kind: ExecutionResourceKind;
    backend: string;
  }): ExecutionResourceLease;
  /** Await this workspace's admitted resources after their owners have been
   * asked to close, before closing the workspace event store. */
  drain?(): Promise<void>;
}

/** Only adapters with affirmative evidence may classify a failed launch. Plain
 * errors after dispatch are intentionally treated as unknown by the coordinator. */
export class ExecutionResourceLaunchError extends Error {
  readonly cleanup: Readonly<ExecutionResourceCleanup>;
  readonly resourceIdentity: Readonly<ExecutionResourceIdentity> | undefined;

  constructor(
    message: string,
    cleanup: ExecutionResourceCleanup,
    options?: ErrorOptions & { resourceIdentity?: ExecutionResourceIdentity },
  ) {
    super(message, options);
    this.name = "ExecutionResourceLaunchError";
    this.cleanup = Object.freeze({ ...cleanup });
    this.resourceIdentity = options?.resourceIdentity
      ? Object.freeze({ ...options.resourceIdentity })
      : undefined;
  }
}
