import { preserveRunLeaseOnStartup } from "./ids.js";

export type LostRunLeaseDisposition =
  | "run_lease_expired"
  | "run_owner_unavailable"
  | "run_lease_missing";

export function lostRunLeaseDisposition(
  lease: { ownerId: string; expiresAt: string } | undefined,
  hasToken: boolean,
  timestampMs: number,
  interruptActiveLeases: boolean,
): LostRunLeaseDisposition | undefined {
  if (!lease || !hasToken || !Number.isFinite(Date.parse(lease.expiresAt))) {
    return "run_lease_missing";
  }
  if (Date.parse(lease.expiresAt) <= timestampMs) return "run_lease_expired";
  if (
    !preserveRunLeaseOnStartup(
      lease,
      hasToken,
      timestampMs,
      interruptActiveLeases,
    )
  ) {
    return "run_owner_unavailable";
  }
  return undefined;
}
