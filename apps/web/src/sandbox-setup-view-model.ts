import type {
  SandboxSetupPreview,
  SandboxSetupStatus,
} from "@napier/contracts/sandbox-setup";

export interface SandboxSetupCopy {
  title: string;
  detail: string;
  action: string;
  actionable: boolean;
}

const STATUS_COPY: Record<SandboxSetupStatus, SandboxSetupCopy> = {
  ready: {
    title: "Image found",
    detail:
      "The pinned image is present. Apply the exact preview to verify every production capability and activate it.",
    action: "Verify & activate",
    actionable: true,
  },
  buildable: {
    title: "Build required",
    detail:
      "A local Docker daemon is ready. Napier can build the pinned Node, Shell, Python, Git, LSP, and DAP image.",
    action: "Build & activate",
    actionable: true,
  },
  runtime_unavailable: {
    title: "Docker offline",
    detail:
      "Start a supported local Docker daemon. Remote Docker endpoints are rejected.",
    action: "Docker required",
    actionable: false,
  },
  unsupported: {
    title: "Host unsupported",
    detail: "This host cannot run the pinned OCI Sandbox setup.",
    action: "Unavailable",
    actionable: false,
  },
};

export function sandboxSetupCopy(
  preview: SandboxSetupPreview,
): SandboxSetupCopy {
  return STATUS_COPY[preview.status];
}

export function sandboxSetupReady(
  preview: SandboxSetupPreview | undefined,
): boolean {
  return (
    preview?.active === true &&
    preview.status === "ready" &&
    Boolean(preview.imageId)
  );
}
