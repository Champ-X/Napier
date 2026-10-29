import {
  ExecutionResourceLaunchError,
  type ExecutionResourceAdmission,
  type ExecutionResourceCleanup,
  type ExecutionResourceLease,
} from "./execution-resource-admission.js";
import type { OsSandboxAdapter, SandboxedProcess, SandboxLaunchRequest } from "./sandbox-types.js";

const unknown = (reason: string): ExecutionResourceCleanup => ({ status: "unknown", scope: "sandbox_execution", reason });

/** Admission survives adapter replacement and follows physical cleanup, not the
 * consumer's Run status or willingness to continue reading stdout. */
export async function launchAdmittedSandbox(
  adapter: OsSandboxAdapter,
  request: SandboxLaunchRequest,
  admission: ExecutionResourceAdmission,
): Promise<SandboxedProcess> {
  request.signal?.throwIfAborted();
  const lease = admission.reserve({ kind: "sandbox_execution", backend: adapter.id });
  try { lease.dispatched(); }
  catch (error) {
    lease.settle({ status: "not_started", scope: "sandbox_execution", reason: "dispatch_record_failed" });
    throw error;
  }
  let child: SandboxedProcess;
  try { child = await adapter.launch(request); }
  catch (error) {
    if (error instanceof ExecutionResourceLaunchError) {
      // Binding failure still must not skip settlement/retain an unobserved launch.
      try { if (error.resourceIdentity) lease.bind(error.resourceIdentity); }
      finally { lease.settle(error.cleanup); }
    } else lease.settle(unknown("unclassified_launch_failure"));
    throw error;
  }
  let released = false;
  const cleanup = observeCleanup(child, lease, () => { released = true; });
  try { if (child.resourceIdentity) lease.bind(child.resourceIdentity); }
  catch (error) {
    await compensateFailedBinding(child, lease, cleanup, error);
    throw error;
  }
  const exit = child.exit.then(async (result) => { await cleanup; return result; }, async (error: unknown) => {
    await cleanup;
    throw error;
  });
  // Some consumers own termination without awaiting exit. Keep rejection observed
  // while retaining the rejecting promise for consumers that do await it.
  void exit.catch(() => undefined);
  return {
    stdin: child.stdin, stdout: child.stdout, stderr: child.stderr, exit, cleanup,
    ...(child.resourceIdentity ? { resourceIdentity: child.resourceIdentity } : {}),
    ...(child.localService ? { localService: child.localService } : {}),
    ...(child.resize ? { resize: (columns: number, rows: number) => child.resize!(columns, rows) } : {}),
    async terminate() {
      try { await child.terminate(); }
      catch (error) {
        if (!released) lease.settle(unknown("termination_failed"));
        throw error;
      }
      await cleanup;
    },
  };
}

function observeCleanup(child: SandboxedProcess, lease: ExecutionResourceLease, released: () => void): Promise<ExecutionResourceCleanup> {
  const proof = child.cleanup ?? child.exit.then(
    () => unknown("cleanup_evidence_missing"),
    () => unknown("exit_and_cleanup_unconfirmed"),
  );
  const cleanup = Promise.all([
    proof.catch(() => unknown("cleanup_failed")),
    child.exit.then(() => undefined, () => undefined),
  ]).then(([evidence]) => {
    lease.settle(evidence);
    if (evidence.status === "unknown") throw new Error(`Sandbox cleanup is unknown: ${evidence.reason}`);
    released();
    return evidence;
  });
  void cleanup.catch(() => undefined);
  return cleanup;
}

async function compensateFailedBinding(
  child: SandboxedProcess,
  lease: ExecutionResourceLease,
  cleanup: Promise<ExecutionResourceCleanup>,
  bindingError: unknown,
): Promise<void> {
  try { await child.terminate(); }
  catch (error) {
    lease.settle(unknown("binding_and_termination_failed"));
    throw new AggregateError([bindingError, error], "Sandbox identity persistence and cleanup failed");
  }
  try { await cleanup; }
  catch (error) { throw new AggregateError([bindingError, error], "Sandbox identity persistence and cleanup settlement failed"); }
}
