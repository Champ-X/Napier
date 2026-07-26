import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";

import type {
  ExtensionPackageUpdatePreview,
  ExtensionRecord,
} from "@napier/contracts";

import { extensionCopy as copy } from "./extension-copy";
import type { ExtensionPackageUpdateConfirmation } from "./extension-package-types";

export default function ExtensionPackageUpdateDesk({
  extensions,
  busyId,
  preview,
  onPreview,
  onApply,
  onCancel,
}: {
  extensions: ExtensionRecord[];
  busyId: string | undefined;
  preview: ExtensionPackageUpdatePreview | undefined;
  onPreview: (extensionId: string, file: File) => Promise<void>;
  onApply: (confirmation: ExtensionPackageUpdateConfirmation) => Promise<void>;
  onCancel: () => void;
}) {
  const packageCopy = copy.packages;
  const installed = useMemo(
    () => extensions.filter((extension) => Boolean(extension.packageBinding)),
    [extensions],
  );
  const [extensionId, setExtensionId] = useState("");
  const [publisherChange, setPublisherChange] = useState(false);
  const [versionOverride, setVersionOverride] = useState(false);

  useEffect(() => {
    if (!installed.some((extension) => extension.id === extensionId)) {
      setExtensionId(installed[0]?.id ?? "");
      onCancel();
    }
  }, [extensionId, installed, onCancel]);

  useEffect(() => {
    setPublisherChange(false);
    setVersionOverride(false);
  }, [preview?.contentSha256]);

  const canApply =
    Boolean(preview) &&
    !preview?.noChanges &&
    (!preview?.requiresPublisherConfirmation || publisherChange) &&
    (!preview?.requiresVersionOverride || versionOverride) &&
    !busyId;

  return (
    <section
      className="extension-package-update"
      aria-labelledby="extension-package-update-title"
    >
      <header>
        <div>
          <strong id="extension-package-update-title">
            {packageCopy.updateTitle}
          </strong>
          <small>{packageCopy.updateBody}</small>
        </div>
        <RefreshCw size={13} aria-hidden="true" />
      </header>

      <label className="extension-package-update-target">
        <span>{packageCopy.updateTarget}</span>
        <select
          value={extensionId}
          disabled={Boolean(busyId) || installed.length === 0}
          onChange={(event) => {
            setExtensionId(event.target.value);
            onCancel();
          }}
        >
          {installed.length === 0 ? (
            <option value="">{packageCopy.chooseUpdateTarget}</option>
          ) : null}
          {installed.map((extension) => (
            <option value={extension.id} key={extension.id}>
              {extension.name} · {extension.version}
            </option>
          ))}
        </select>
      </label>

      <label
        className="extension-package-file-action"
        aria-disabled={Boolean(busyId) || !extensionId}
      >
        <Upload size={11} aria-hidden="true" />
        <span>
          {busyId === "package:update-preview"
            ? packageCopy.previewingUpdate
            : packageCopy.previewUpdate}
        </span>
        <input
          type="file"
          accept="application/json,.json"
          disabled={Boolean(busyId) || !extensionId}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void onPreview(extensionId, file);
          }}
        />
      </label>

      {preview ? (
        <article className="extension-package-update-ticket">
          <header>
            <div>
              <span>{packageCopy.currentPackage}</span>
              <strong>{preview.current.version}</strong>
              <code title={preview.current.envelopeSha256}>
                {preview.current.envelopeSha256.slice(0, 10)}
              </code>
            </div>
            <ArrowRight size={13} aria-hidden="true" />
            <div>
              <span>{packageCopy.nextPackage}</span>
              <strong>{preview.next.version}</strong>
              <code title={preview.next.envelopeSha256}>
                {preview.next.envelopeSha256.slice(0, 10)}
              </code>
            </div>
            <span
              className={`extension-package-version direction-${preview.versionDirection}`}
            >
              {packageCopy.versionDirections[preview.versionDirection]}
            </span>
          </header>

          {preview.noChanges ? (
            <p className="extension-package-update-noop">
              <ShieldCheck size={11} aria-hidden="true" />
              {packageCopy.noUpdateChanges}
            </p>
          ) : (
            <>
              <section aria-label={packageCopy.updateChanges}>
                <strong>{packageCopy.updateChanges}</strong>
                <div className="extension-package-change-tags">
                  {preview.changes.map((change) => (
                    <span key={change}>{packageCopy.changeLabels[change]}</span>
                  ))}
                </div>
              </section>

              <UpdateDeltaList preview={preview} />

              <p className="extension-package-update-warning">
                <ShieldAlert size={11} aria-hidden="true" />
                {packageCopy.reviewReset}
              </p>

              {preview.requiresPublisherConfirmation ? (
                <label className="extension-package-update-confirm">
                  <input
                    type="checkbox"
                    checked={publisherChange}
                    onChange={(event) =>
                      setPublisherChange(event.target.checked)
                    }
                  />
                  <span>{packageCopy.confirmPublisherChange}</span>
                </label>
              ) : null}
              {preview.requiresVersionOverride ? (
                <label className="extension-package-update-confirm">
                  <input
                    type="checkbox"
                    checked={versionOverride}
                    onChange={(event) =>
                      setVersionOverride(event.target.checked)
                    }
                  />
                  <span>{packageCopy.confirmVersionOverride}</span>
                </label>
              ) : null}
            </>
          )}

          <footer>
            <span>
              <code title={preview.expectedPackageBindingSha256}>
                binding {preview.expectedPackageBindingSha256.slice(0, 10)}
              </code>
              <code title={preview.contentSha256}>
                preview {preview.contentSha256.slice(0, 10)}
              </code>
            </span>
            <button
              type="button"
              disabled={!canApply}
              onClick={() => void onApply({ publisherChange, versionOverride })}
            >
              <RefreshCw size={10} aria-hidden="true" />
              {busyId === "package:update"
                ? packageCopy.applyingUpdate
                : packageCopy.applyUpdate}
            </button>
            <button
              type="button"
              aria-label={packageCopy.cancelUpdate}
              disabled={Boolean(busyId)}
              onClick={onCancel}
            >
              <X size={10} aria-hidden="true" />
            </button>
          </footer>
        </article>
      ) : null}
    </section>
  );
}

function UpdateDeltaList({
  preview,
}: {
  preview: ExtensionPackageUpdatePreview;
}) {
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
