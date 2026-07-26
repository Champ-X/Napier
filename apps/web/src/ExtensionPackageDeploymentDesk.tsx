import { useEffect, useState } from "react";
import { Boxes, GitMerge, ShieldAlert, Upload, X } from "lucide-react";

import type { ExtensionPackageDeploymentPreview } from "@napier/contracts";

import { extensionCopy as copy } from "./extension-copy";
import type { ExtensionPackageDeploymentConfirmation } from "./extension-package-types";

export default function ExtensionPackageDeploymentDesk({
  busyId,
  preview,
  onPreview,
  onApply,
  onCancel,
}: {
  busyId: string | undefined;
  preview: ExtensionPackageDeploymentPreview | undefined;
  onPreview: (files: File[]) => Promise<void>;
  onApply: (
    confirmation: ExtensionPackageDeploymentConfirmation,
  ) => Promise<void>;
  onCancel: () => void;
}) {
  const packageCopy = copy.packages;
  const [publisherChanges, setPublisherChanges] = useState(false);
  const [versionOverrides, setVersionOverrides] = useState(false);

  useEffect(() => {
    setPublisherChanges(false);
    setVersionOverrides(false);
  }, [preview?.contentSha256]);

  const canApply =
    Boolean(preview) &&
    !preview?.noChanges &&
    (!preview?.requiresPublisherConfirmation || publisherChanges) &&
    (!preview?.requiresVersionOverride || versionOverrides) &&
    !busyId;

  return (
    <section
      className="extension-package-deployment"
      aria-labelledby="extension-package-deployment-title"
    >
      <header>
        <div>
          <strong id="extension-package-deployment-title">
            {packageCopy.deploymentTitle}
          </strong>
          <small>{packageCopy.deploymentBody}</small>
        </div>
        <Boxes size={13} aria-hidden="true" />
      </header>

      <label
        className="extension-package-file-action"
        aria-disabled={Boolean(busyId)}
      >
        <Upload size={11} aria-hidden="true" />
        <span>
          {busyId === "package:deployment-preview"
            ? packageCopy.previewingDeployment
            : packageCopy.previewDeployment}
        </span>
        <input
          type="file"
          accept="application/json,.json"
          multiple
          disabled={Boolean(busyId)}
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            if (files.length > 0) void onPreview(files);
          }}
        />
      </label>

      {preview ? (
        <article className="extension-package-deployment-ticket">
          <header>
            <div>
              <span>{packageCopy.deploymentCandidates}</span>
              <strong>{preview.candidateCount}</strong>
            </div>
            <div>
              <span>{packageCopy.deploymentInstalls}</span>
              <strong>{preview.installCount}</strong>
            </div>
            <div>
              <span>{packageCopy.deploymentUpdates}</span>
              <strong>{preview.updateCount}</strong>
            </div>
            <code title={preview.contentSha256}>
              plan {preview.contentSha256.slice(0, 10)}
            </code>
          </header>

          <ol className="extension-package-deployment-items">
            {preview.items.map((item) => (
              <li key={item.next.envelopeSha256}>
                <span className={`deployment-action action-${item.action}`}>
                  {packageCopy.deploymentActions[item.action]}
                </span>
                <span>
                  <strong>{item.normalizedName}</strong>
                  <small>
                    {item.current ? `${item.current.version} → ` : ""}
                    {item.next.version}
                  </small>
                </span>
                <code title={item.next.envelopeSha256}>
                  {item.next.envelopeSha256.slice(0, 10)}
                </code>
                {item.dependencies.length > 0 ? (
                  <dl>
                    {item.dependencies.map((dependency) => (
                      <div key={dependency.normalizedName}>
                        <dt>{dependency.normalizedName}</dt>
                        <dd>{dependency.versionRange}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </li>
            ))}
          </ol>

          <section className="extension-package-deployment-order">
            <strong>
              <GitMerge size={10} aria-hidden="true" />
              {packageCopy.deploymentOrder}
            </strong>
            <ol>
              {preview.applyOrder.map((name, index) => (
                <li key={name}>
                  <code>{String(index + 1).padStart(2, "0")}</code>
                  <span>{name}</span>
                </li>
              ))}
            </ol>
          </section>

          {preview.resolutions.length > 0 ? (
            <section className="extension-package-deployment-resolutions">
              <strong>{packageCopy.dependencyResolution}</strong>
              <dl>
                {preview.resolutions.map((resolution) => (
                  <div
                    key={`${resolution.dependentName}:${resolution.dependencyName}`}
                  >
                    <dt>
                      {resolution.dependentName} → {resolution.dependencyName}
                    </dt>
                    <dd>
                      {resolution.versionRange} = {resolution.resolvedVersion}
                      <span>
                        {packageCopy.resolutionSources[resolution.source]}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          <p className="extension-package-update-warning">
            <ShieldAlert size={11} aria-hidden="true" />
            {packageCopy.deploymentReviewReset}
          </p>

          {preview.requiresPublisherConfirmation ? (
            <label className="extension-package-update-confirm">
              <input
                type="checkbox"
                checked={publisherChanges}
                onChange={(event) => setPublisherChanges(event.target.checked)}
              />
              <span>{packageCopy.confirmDeploymentPublishers}</span>
            </label>
          ) : null}
          {preview.requiresVersionOverride ? (
            <label className="extension-package-update-confirm">
              <input
                type="checkbox"
                checked={versionOverrides}
                onChange={(event) => setVersionOverrides(event.target.checked)}
              />
              <span>{packageCopy.confirmDeploymentVersions}</span>
            </label>
          ) : null}

          <footer>
            <button
              type="button"
              disabled={!canApply}
              onClick={() =>
                void onApply({ publisherChanges, versionOverrides })
              }
            >
              <Boxes size={10} aria-hidden="true" />
              {busyId === "package:deployment"
                ? packageCopy.applyingDeployment
                : packageCopy.applyDeployment}
            </button>
            <button
              type="button"
              aria-label={packageCopy.cancelDeployment}
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
