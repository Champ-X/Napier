import type { ArtifactManifestEntry } from "@napier/contracts";

export type ArtifactActionId =
  | "open"
  | "preview"
  | "diff"
  | "reveal"
  | "copy_path"
  | "restore"
  | "apply";

export interface ArtifactActionAvailability {
  primary?: ArtifactActionId;
  actions: ArtifactActionId[];
}

export type ArtifactActionCapabilities = Partial<
  Record<"reveal" | "restore" | "apply", boolean>
>;

export function artifactActionAvailability(
  artifact: Pick<ArtifactManifestEntry, "kind" | "path" | "status">,
  capabilities: ArtifactActionCapabilities = {},
): ArtifactActionAvailability {
  if (artifact.status === "superseded") return { actions: ["copy_path"] };
  const available =
    artifact.status === "produced" || artifact.status === "verified";
  const safeUrl =
    available && artifact.kind === "url" && /^https?:\/\//u.test(artifact.path);
  const previewable = available && artifact.kind === "file";
  const actions: ArtifactActionId[] = [
    ...(safeUrl || previewable ? (["open"] as const) : []),
    ...(previewable ? (["preview", "diff"] as const) : []),
    ...(capabilities.reveal ? (["reveal"] as const) : []),
    "copy_path",
    ...(capabilities.restore ? (["restore"] as const) : []),
    ...(capabilities.apply ? (["apply"] as const) : []),
  ];
  return {
    ...(actions.includes("open") ? { primary: "open" as const } : {}),
    actions,
  };
}

export function workspaceTrashActionAvailability(
  capabilities: Pick<ArtifactActionCapabilities, "restore"> = {},
): ArtifactActionAvailability {
  const actions: ArtifactActionId[] = [
    "copy_path",
    ...(capabilities.restore ? (["restore"] as const) : []),
  ];
  return {
    ...(capabilities.restore ? { primary: "restore" as const } : {}),
    actions,
  };
}
