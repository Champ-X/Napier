import { Cable, TerminalSquare } from "lucide-react";

import type {
  ExtensionPackageVerificationStatus,
  ExtensionPublisherTrustAnchor,
  ExtensionRecord,
} from "@napier/contracts";

import { extensionCopy as copy } from "./extension-copy";
import { ExtensionCardActions } from "./ExtensionCardActions";
import { ExtensionPackageBindingSummary } from "./ExtensionPackageBindingSummary";
import { ExtensionToolList } from "./ExtensionToolList";

export interface ExtensionCardProps {
  extension: ExtensionRecord;
  publisherAnchors: ExtensionPublisherTrustAnchor[];
  agentId: string;
  busy: boolean;
  onReview(extensionId: string, action: "approve" | "reject"): void;
  onConnect(extensionId: string): void;
  onDisconnect(extensionId: string): void;
  onToolReview(
    extensionId: string,
    toolName: string,
    action: "approve" | "reject",
    effect?: "read" | "write",
    routingHint?: string,
  ): void;
  onToggle(extensionId: string, enabled: boolean): void;
}

export function ExtensionCard({
  extension,
  publisherAnchors,
  agentId,
  busy,
  onReview,
  onConnect,
  onDisconnect,
  onToolReview,
  onToggle,
}: ExtensionCardProps) {
  const enabled = extension.enabledAgentIds.includes(agentId);
  const approvedTools = extension.tools.filter(
    (tool) => tool.reviewStatus === "approved",
  ).length;
  const locator =
    extension.transport.type === "streamable_http"
      ? extension.transport.url
      : extension.transport.command;
  const mappingCount =
    extension.transport.type === "streamable_http"
      ? Object.keys(extension.transport.headerEnv ?? {}).length
      : Object.keys(extension.transport.env ?? {}).length;
  const packageStatus = resolvePackageStatus(extension, publisherAnchors);
  const packageTrusted =
    packageStatus === undefined || packageStatus === "trusted";
  return (
    <article className={`extension-card extension-${extension.trustStatus}`}>
      <ExtensionCardSummary extension={extension} locator={locator} />
      {packageStatus ? (
        <ExtensionPackageBindingSummary
          extension={extension}
          status={packageStatus}
        />
      ) : null}
      <ExtensionTransportDetail
        extension={extension}
        mappingCount={mappingCount}
      />
      {extension.connection.error ? (
        <p className="extension-error" role="alert">
          {extension.connection.error}
        </p>
      ) : null}

      <ExtensionCardActions
        extension={extension}
        enabled={enabled}
        approvedToolCount={approvedTools}
        packageTrusted={packageTrusted}
        busy={busy}
        onReview={onReview}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
        onToggle={onToggle}
      />

      <ExtensionToolList
        extension={extension}
        busy={busy}
        onToolReview={onToolReview}
      />
    </article>
  );
}

export interface ExtensionCardSummaryProps {
  extension: ExtensionRecord;
  locator: string;
}

function ExtensionCardSummary({
  extension,
  locator,
}: ExtensionCardSummaryProps) {
  return (
    <>
      <header>
        <div>
          <span className="extension-glyph" aria-hidden="true">
            {extension.transport.type === "stdio" ? (
              <TerminalSquare size={13} />
            ) : (
              <Cable size={13} />
            )}
          </span>
          <div>
            <strong>{extension.name}</strong>
            <code>{locator}</code>
          </div>
        </div>
        <span className="extension-state">
          {copy.statuses[extension.trustStatus]}
        </span>
      </header>
      <div className="extension-tags">
        <span>
          {extension.transport.type === "stdio" ? copy.stdio : copy.http}
        </span>
        {extension.packageBinding ? (
          <span>{copy.packages.packageBadge}</span>
        ) : null}
        {extension.requestedCapabilities.map((capability) => (
          <span key={capability}>{capability}</span>
        ))}
      </div>
      <dl className="extension-facts">
        <div>
          <dt>{copy.connection}</dt>
          <dd>{copy.statuses[extension.connection.status]}</dd>
        </div>
        <div>
          <dt>{copy.provenance}</dt>
          <dd>
            <code>{extension.provenance.digestSha256.slice(0, 10)}</code>
          </dd>
        </div>
      </dl>
    </>
  );
}

export interface ExtensionTransportDetailProps {
  extension: ExtensionRecord;
  mappingCount: number;
}

function ExtensionTransportDetail({
  extension,
  mappingCount,
}: ExtensionTransportDetailProps) {
  if (extension.transport.type !== "stdio") return null;
  return (
    <div className="extension-transport-detail">
      {extension.transport.args?.length ? (
        <code>{extension.transport.args.join(" ")}</code>
      ) : null}
      {extension.transport.cwd ? (
        <span>
          cwd <code>{extension.transport.cwd}</code>
        </span>
      ) : null}
      {mappingCount > 0 ? (
        <span>
          {mappingCount} {copy.mappingCount}
        </span>
      ) : null}
    </div>
  );
}

function resolvePackageStatus(
  extension: ExtensionRecord,
  publisherAnchors: ExtensionPublisherTrustAnchor[],
): ExtensionPackageVerificationStatus | undefined {
  const envelope = extension.packageBinding?.envelope;
  if (!envelope) return undefined;
  const anchor = publisherAnchors.find(
    (candidate) => candidate.keyId === envelope.signature.keyId,
  );
  if (!anchor) return "unknown_key";
  if (anchor.status === "revoked") return "revoked";
  if (
    envelope.manifest.expiresAt &&
    Date.parse(envelope.manifest.expiresAt) <= Date.now()
  ) {
    return "expired";
  }
  return "trusted";
}
