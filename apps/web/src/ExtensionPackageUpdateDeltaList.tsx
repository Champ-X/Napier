import type { ExtensionPackageUpdatePreview } from "@napier/contracts";

import { extensionCopy as copy } from "./extension-copy";

export interface ExtensionPackageUpdateDeltaListProps {
  preview: ExtensionPackageUpdatePreview;
}

export function ExtensionPackageUpdateDeltaList({
  preview,
}: ExtensionPackageUpdateDeltaListProps) {
  const packageCopy = copy.packages;
  const rows = [
    preview.capabilitiesAdded.length
      ? {
          label: `${packageCopy.added} · ${copy.capabilities}`,
          values: preview.capabilitiesAdded,
        }
      : undefined,
    preview.capabilitiesRemoved.length
      ? {
          label: `${packageCopy.removed} · ${copy.capabilities}`,
          values: preview.capabilitiesRemoved,
        }
      : undefined,
    preview.tools.added.length
      ? {
          label: `${packageCopy.added} · ${copy.tools}`,
          values: preview.tools.added,
        }
      : undefined,
    preview.tools.removed.length
      ? {
          label: `${packageCopy.removed} · ${copy.tools}`,
          values: preview.tools.removed,
        }
      : undefined,
    preview.tools.schemaChanged.length
      ? {
          label: packageCopy.schemaChanged,
          values: preview.tools.schemaChanged,
        }
      : undefined,
    preview.tools.descriptionChanged.length
      ? {
          label: packageCopy.descriptionChanged,
          values: preview.tools.descriptionChanged,
        }
      : undefined,
    preview.tools.effectChanged.length
      ? {
          label: packageCopy.effectChanged,
          values: preview.tools.effectChanged,
        }
      : undefined,
    preview.tools.routingHintChanged.length
      ? {
          label: packageCopy.routingHintChanged,
          values: preview.tools.routingHintChanged,
        }
      : undefined,
    preview.dependencies.added.length
      ? {
          label: `${packageCopy.added} · ${packageCopy.dependencies}`,
          values: preview.dependencies.added.map(
            (dependency) =>
              `${dependency.normalizedName} ${dependency.versionRange}`,
          ),
        }
      : undefined,
    preview.dependencies.removed.length
      ? {
          label: `${packageCopy.removed} · ${packageCopy.dependencies}`,
          values: preview.dependencies.removed.map(
            (dependency) =>
              `${dependency.normalizedName} ${dependency.versionRange}`,
          ),
        }
      : undefined,
    preview.dependencies.changed.length
      ? {
          label: packageCopy.dependencyChanged,
          values: preview.dependencies.changed.map(
            (dependency) =>
              `${dependency.normalizedName} ${dependency.currentVersionRange} → ${dependency.nextVersionRange}`,
          ),
        }
      : undefined,
  ].filter(
    (
      row,
    ): row is {
      label: string;
      values: string[];
    } => row !== undefined,
  );
  return rows.length ? (
    <dl className="extension-package-update-deltas">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.values.join(", ")}</dd>
        </div>
      ))}
    </dl>
  ) : null;
}
