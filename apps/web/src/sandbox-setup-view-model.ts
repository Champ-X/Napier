import type { SandboxSetupPreview } from "@napier/contracts/sandbox-setup";

import { environmentSetupCopy } from "./environment-setup-copy";

export interface SandboxSetupCopy {
  title: string;
  detail: string;
  action: string;
  actionable: boolean;
}

export function sandboxSetupCopy(
  preview: SandboxSetupPreview,
): SandboxSetupCopy {
  return environmentSetupCopy.sandbox.statuses[preview.status];
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
