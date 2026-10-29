import { createHash } from "node:crypto";
import type { SwitchableSandboxAdapter } from "@napier/runtime/sandbox-switchable";
import type {
  BrowserTaskBackend,
  BrowserTaskErrorEvent,
} from "./browser-task-types.js";

export type BrowserTaskResourceAdmission = NonNullable<
  ConstructorParameters<typeof SwitchableSandboxAdapter>[1]
>;
export type BrowserTaskResourceLease = ReturnType<
  BrowserTaskResourceAdmission["reserve"]
>;
type Cleanup = Parameters<BrowserTaskResourceLease["settle"]>[0];

/** Keep missing/failed backend evidence observable after its UI task ends. The
 * backend receives a tracked lease rather than the raw durable coordinator. */
export class BrowserTaskResource {
  readonly lease: BrowserTaskResourceLease;
  private dispatched = false;
  private entered = false;
  private proof: Cleanup | undefined;
  private failure: { error: unknown } | undefined;

  constructor(
    admission: BrowserTaskResourceAdmission,
    backend: BrowserTaskBackend,
  ) {
    const lease = admission.reserve({ kind: "browser_task", backend });
    this.lease = {
      id: lease.id,
      dispatched: () => {
        if (this.dispatched) return;
        lease.dispatched();
        this.dispatched = true;
      },
      bind: (identity) => lease.bind(identity),
      settle: (evidence) => {
        // A later observer failure cannot undo already affirmed physical cleanup.
        if (this.released) return;
        try {
          if (!validCleanup(evidence)) {
            const invalid = new Error(
              "Browser task cleanup evidence is invalid",
            );
            try {
              // Notify the durable drain even when the rejected proof never
              // reaches its validator. Invalid evidence cannot release a slot.
              lease.settle({
                status: "unknown",
                scope: "browser_task",
                reason: "browser_task_cleanup_evidence_invalid",
              });
            } catch (error) {
              throw new AggregateError(
                [invalid, error],
                "Browser task invalid cleanup could not be recorded",
              );
            }
            throw invalid;
          }
          lease.settle(evidence);
          this.proof = { ...evidence };
        } catch (error) {
          this.failure = { error };
          throw error;
        }
      },
    };
  }

  get released(): boolean {
    return (
      this.proof !== undefined &&
      this.proof.status !== "unknown" &&
      this.failure === undefined
    );
  }

  enterBackend(): void {
    // Also covers injected runners that do not implement lifecycle hooks.
    this.lease.dispatched();
    this.entered = true;
  }

  finish(): void {
    if (this.failure !== undefined) throw this.failure.error;
    if (!this.proof)
      this.lease.settle({
        status: this.entered ? "unknown" : "not_started",
        scope: "browser_task",
        reason: this.entered
          ? "browser_task_cleanup_evidence_missing"
          : "browser_task_preparation_failed",
      });
    if (!this.released)
      throw new Error("Browser task resource cleanup is unconfirmed");
  }
}

function validCleanup(evidence: Cleanup): boolean {
  return (
    typeof evidence === "object" &&
    evidence !== null &&
    evidence.scope === "browser_task" &&
    ["not_started", "released", "unknown"].includes(evidence.status) &&
    typeof evidence.reason === "string" &&
    /^[a-zA-Z0-9_.:-]{1,100}$/u.test(evidence.reason)
  );
}

export function browserTaskResourceFailure(
  backend: BrowserTaskBackend,
): BrowserTaskErrorEvent {
  return {
    type: "error",
    backend,
    code: "resource_cleanup_unconfirmed",
    message: "Browser task ended, but resource cleanup could not be confirmed",
    diagnosticSha256: createHash("sha256")
      .update(`${backend}:resource_cleanup_unconfirmed`)
      .digest("hex"),
    recovery:
      "Inspect the task's resource state before retrying; its capacity remains reserved",
  };
}
