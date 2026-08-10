import type { WorkspaceProcessCardView } from "./workspace-process-view-model";
import type { WorkspaceProcessSession } from "@napier/contracts";

import { workspaceProcessCopy as copy } from "./workspace-process-copy";

export function WorkspaceProcessLocalServiceRow({
  service,
  label,
}: {
  service: WorkspaceProcessCardView["localService"];
  label: string;
}) {
  if (!service) return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {service.url ? (
          <a href={service.url} target="_blank" rel="noreferrer">
            {service.url}
          </a>
        ) : (
          service.label
        )}
        {` · ${service.identitySha256}`}
      </dd>
    </div>
  );
}

export function WorkspaceProcessFailureRecoveryRow({
  status,
}: {
  status: WorkspaceProcessSession["workspaceCompensationStatus"];
}) {
  return (
    <div>
      <dt>{copy.failureRecovery}</dt>
      <dd>
        {copy.failureRecoveryRestore} · {compensationLabel(status)}
      </dd>
    </div>
  );
}

function compensationLabel(
  status: WorkspaceProcessSession["workspaceCompensationStatus"],
): string {
  if (status === "not_needed") return copy.compensationNotNeeded;
  if (status === "restored") return copy.compensationRestored;
  if (status === "reverted") return copy.compensationReverted;
  if (status === "indeterminate") return copy.compensationIndeterminate;
  if (status === "unavailable") return copy.compensationUnavailable;
  return copy.compensationPending;
}
