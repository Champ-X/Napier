import type {
  RunEvent,
  WorkspaceProcessLocalService,
  WorkspaceProcessSession,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { EventSink } from "./event-sink.js";
import type { RunEventStorePort } from "./run-event-store-port.js";
import { SerialQueue } from "./serial-queue.js";

type RunLocalServiceLeaseStore = RunEventStorePort;

export type LocalServiceLeaseRevocationReason =
  | "process_settled"
  | "run_finished"
  | "runtime_shutdown"
  | "start_failed";

export interface RunLocalServiceLease {
  threadId: string;
  runId: string;
  processId: string;
  origin: string;
  originSha256: string;
  identitySha256: string;
  expiresAt: string;
  contentSha256: string;
}

export class RunLocalServiceLeaseRegistry {
  private readonly leases = new Map<string, RunLocalServiceLease>();
  private readonly mutations = new SerialQueue();

  constructor(
    private readonly store: RunLocalServiceLeaseStore,
    private readonly onEvent?: EventSink,
  ) {}

  async grant(session: WorkspaceProcessSession): Promise<RunLocalServiceLease> {
    return this.mutations.run(async () => {
      const service = readyService(session);
      const origin = serviceOrigin(service);
      const content = {
        threadId: session.threadId,
        runId: session.runId,
        processId: session.id,
        origin,
        originSha256: sha256(origin),
        identitySha256: service.identitySha256,
        expiresAt: new Date(
          Date.parse(session.startedAt) + session.timeoutMs,
        ).toISOString(),
      };
      const lease = {
        ...content,
        contentSha256: sha256(canonicalJson(content)),
      };
      await this.record(
        session.threadId,
        session.runId,
        "workspace.process.local_service_lease.granted",
        {
          kind: "napier.run-local-service-lease",
          schemaVersion: 1,
          status: "active",
          processId: session.id,
          originSha256: lease.originSha256,
          identitySha256: lease.identitySha256,
          expiresAt: lease.expiresAt,
          leaseSha256: lease.contentSha256,
        },
      );
      // The in-memory capability is published only after its durable grant
      // passes Run admission. A concurrent terminal Run therefore cannot use
      // a lease whose authority event was rejected.
      this.leases.set(
        leaseKey(session.threadId, session.runId, session.id),
        lease,
      );
      return structuredClone(lease);
    });
  }

  authorize(
    owner: { threadId: string; runId: string },
    value: string,
    nowMs = Date.now(),
  ): RunLocalServiceLease | undefined {
    const url = localHttpUrl(value);
    if (!url) return undefined;
    const candidate = [...this.leases.values()].find(
      (lease) =>
        lease.threadId === owner.threadId &&
        lease.runId === owner.runId &&
        lease.origin === url.origin &&
        Date.parse(lease.expiresAt) > nowMs,
    );
    return candidate ? structuredClone(candidate) : undefined;
  }

  async revokeProcess(
    session: Pick<WorkspaceProcessSession, "threadId" | "runId" | "id">,
    reason: LocalServiceLeaseRevocationReason,
  ): Promise<void> {
    await this.mutations.run(async () => {
      const key = leaseKey(session.threadId, session.runId, session.id);
      const lease = this.leases.get(key);
      this.leases.delete(key);
      if (lease) await this.recordRevocation(lease, reason);
    });
  }

  async revokeRun(
    owner: { threadId: string; runId: string },
    reason: LocalServiceLeaseRevocationReason = "run_finished",
  ): Promise<void> {
    await this.mutations.run(async () => {
      const leases = [...this.leases.entries()].filter(
        ([, lease]) =>
          lease.threadId === owner.threadId && lease.runId === owner.runId,
      );
      for (const [key] of leases) this.leases.delete(key);
      await Promise.all(
        leases.map(([, lease]) => this.recordRevocation(lease, reason)),
      );
    });
  }

  async revokeAll(
    reason: LocalServiceLeaseRevocationReason = "runtime_shutdown",
  ): Promise<void> {
    await this.mutations.run(async () => {
      const leases = [...this.leases.values()];
      this.leases.clear();
      await Promise.all(
        leases.map((lease) => this.recordRevocation(lease, reason)),
      );
    });
  }

  private recordRevocation(
    lease: RunLocalServiceLease,
    reason: LocalServiceLeaseRevocationReason,
  ): Promise<void> {
    return this.record(
      lease.threadId,
      lease.runId,
      "workspace.process.local_service_lease.revoked",
      {
        kind: "napier.run-local-service-lease",
        schemaVersion: 1,
        status: "revoked",
        reason,
        processId: lease.processId,
        originSha256: lease.originSha256,
        identitySha256: lease.identitySha256,
        leaseSha256: lease.contentSha256,
      },
    );
  }

  private async record(
    threadId: string,
    runId: string,
    type:
      | "workspace.process.local_service_lease.granted"
      | "workspace.process.local_service_lease.revoked",
    payload: Record<string, string | number>,
  ): Promise<void> {
    const contentSha256 = sha256(canonicalJson(payload));
    const event = await this.store.appendEvent({
      threadId,
      runId,
      type,
      category: "lifecycle",
      visibility: "debug",
      payload: { ...payload, contentSha256 },
    });
    await emit(this.onEvent, event);
  }
}

export function localServiceUrl(
  registry: RunLocalServiceLeaseRegistry | undefined,
  owner: { threadId: string; runId: string },
  value: string,
): { url: URL; lease: RunLocalServiceLease } | undefined {
  const lease = registry?.authorize(owner, value);
  const url = lease ? localHttpUrl(value) : undefined;
  return lease && url ? { url, lease } : undefined;
}

function readyService(
  session: WorkspaceProcessSession,
): WorkspaceProcessLocalService {
  const service = session.localService;
  if (
    session.status !== "running" ||
    session.schemaVersion !== 8 ||
    !service ||
    service.status !== "ready"
  ) {
    throw new Error("Run local-service lease requires a ready Process service");
  }
  return service;
}

function serviceOrigin(service: WorkspaceProcessLocalService): string {
  const url = localHttpUrl(service.url);
  if (
    !url ||
    url.hostname !== service.host ||
    Number(url.port) !== service.hostPort ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Run local-service lease binding is invalid");
  }
  return url.origin;
}

function localHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      url.port !== "" &&
      !url.username &&
      !url.password
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

function leaseKey(threadId: string, runId: string, processId: string): string {
  return `${threadId}\u0000${runId}\u0000${processId}`;
}

async function emit(
  sink: EventSink | undefined,
  event: RunEvent,
): Promise<void> {
  if (!sink) return;
  try {
    await sink(event);
  } catch {
    // Durable local-service lease evidence survives a disconnected stream.
  }
}
