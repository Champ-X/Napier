import { useMemo, useState } from "react";
import { Cable, Check, ShieldCheck, TerminalSquare, X } from "lucide-react";

import type {
  CreateMcpExtensionRequest,
  ExtensionCapability,
  ExtensionPackageDeploymentPreview,
  ExtensionPackageRolloutChannel,
  ExtensionPackageRolloutPreview,
  ExtensionPackageUpdatePreview,
  ExtensionPackageVerificationStatus,
  ExtensionPublisherTrustAnchor,
  ExtensionRecord,
} from "@napier/contracts";

import { extensionCopy as copy } from "./extension-copy";
import ExtensionPackageDesk from "./ExtensionPackageDesk";
import type {
  ExtensionPackageDeploymentConfirmation,
  ExtensionPackageReceipt,
  ExtensionPackageSignDraft,
  ExtensionPackageUpdateConfirmation,
  ExtensionPublisherDraft,
} from "./extension-package-types";

type Proposal = Omit<CreateMcpExtensionRequest, "threadId">;

export interface ExtensionPanelProps {
  extensions: ExtensionRecord[];
  publisherAnchors: ExtensionPublisherTrustAnchor[];
  agentId: string;
  busyId: string | undefined;
  packageReceipt: ExtensionPackageReceipt | undefined;
  packageDeploymentPreview: ExtensionPackageDeploymentPreview | undefined;
  packageRolloutPreview: ExtensionPackageRolloutPreview | undefined;
  packageRolloutChannels: ExtensionPackageRolloutChannel[];
  packageUpdatePreview: ExtensionPackageUpdatePreview | undefined;
  onPropose: (request: Proposal) => Promise<void>;
  onReview: (extensionId: string, action: "approve" | "reject") => void;
  onConnect: (extensionId: string) => void;
  onDisconnect: (extensionId: string) => void;
  onToolReview: (
    extensionId: string,
    toolName: string,
    action: "approve" | "reject",
    effect?: "read" | "write",
    routingHint?: string,
  ) => void;
  onToggle: (extensionId: string, enabled: boolean) => void;
  onCreatePublisher: (draft: ExtensionPublisherDraft) => Promise<void>;
  onRevokePublisher: (anchorId: string) => Promise<void>;
  onSignPackage: (
    extensionId: string,
    draft: ExtensionPackageSignDraft,
  ) => Promise<void>;
  onVerifyPackage: (file: File) => Promise<void>;
  onImportPackage: (file: File) => Promise<void>;
  onExportPackageLockfile: () => Promise<void>;
  onDownloadPackageChannelIndex: (
    trustAnchorId: string,
    publisher: string,
  ) => Promise<void>;
  onPublishPackageRollout: (name: string) => Promise<void>;
  onPreviewPackageRollout: (channelId: string) => Promise<void>;
  onPreviewPackageUpdate: (extensionId: string, file: File) => Promise<void>;
  onApplyPackageUpdate: (
    confirmation: ExtensionPackageUpdateConfirmation,
  ) => Promise<void>;
  onCancelPackageUpdate: () => void;
  onPreviewPackageDeployment: (files: File[]) => Promise<void>;
  onApplyPackageDeployment: (
    confirmation: ExtensionPackageDeploymentConfirmation,
  ) => Promise<void>;
  onCancelPackageDeployment: () => void;
}

export default function ExtensionPanel({
  extensions,
  publisherAnchors,
  agentId,
  busyId,
  packageReceipt,
  packageDeploymentPreview,
  packageRolloutPreview,
  packageRolloutChannels,
  packageUpdatePreview,
  onPropose,
  onReview,
  onConnect,
  onDisconnect,
  onToolReview,
  onToggle,
  onCreatePublisher,
  onRevokePublisher,
  onSignPackage,
  onVerifyPackage,
  onImportPackage,
  onExportPackageLockfile,
  onDownloadPackageChannelIndex,
  onPublishPackageRollout,
  onPreviewPackageRollout,
  onPreviewPackageUpdate,
  onApplyPackageUpdate,
  onCancelPackageUpdate,
  onPreviewPackageDeployment,
  onApplyPackageDeployment,
  onCancelPackageDeployment,
}: ExtensionPanelProps) {
  const [name, setName] = useState("");
  const [transportType, setTransportType] = useState<
    "streamable_http" | "stdio"
  >("streamable_http");
  const [url, setUrl] = useState("");
  const [headerName, setHeaderName] = useState("");
  const [headerEnv, setHeaderEnv] = useState("");
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState("");
  const [cwd, setCwd] = useState("");
  const [envTarget, setEnvTarget] = useState("");
  const [envSource, setEnvSource] = useState("");
  const [externalRead, setExternalRead] = useState(true);
  const [externalWrite, setExternalWrite] = useState(false);
  const [network, setNetwork] = useState(false);
  const [workspaceRead, setWorkspaceRead] = useState(false);
  const [workspaceWrite, setWorkspaceWrite] = useState(false);
  const [error, setError] = useState<string>();

  const activeTools = extensions.reduce(
    (count, extension) =>
      count +
      extension.tools.filter((tool) => tool.reviewStatus === "approved").length,
    0,
  );
  const formBusy = busyId === "new";
  const canSubmit =
    name.trim().length > 0 &&
    (transportType === "streamable_http"
      ? url.trim().length > 0
      : command.trim().length > 0);
  const derivedCapabilities = useMemo(() => {
    const capabilities = [
      transportType === "streamable_http" ? "network.connect" : "process.spawn",
    ];
    if (
      (transportType === "streamable_http" && headerName && headerEnv) ||
      (transportType === "stdio" && envTarget && envSource)
    ) {
      capabilities.push("secrets.env");
    }
    if (transportType === "stdio" && cwd.trim()) {
      capabilities.push("workspace.read");
    }
    return capabilities;
  }, [cwd, envSource, envTarget, headerEnv, headerName, transportType]);

  const submit = async (): Promise<void> => {
    if (!canSubmit || formBusy) return;
    setError(undefined);
    if (!externalRead && !externalWrite) {
      setError(copy.errors.capability);
      return;
    }
    const capabilities: ExtensionCapability[] = [
      ...(externalRead ? (["external.read"] as const) : []),
      ...(externalWrite ? (["external.write"] as const) : []),
    ];
    let transport: CreateMcpExtensionRequest["transport"];
    if (transportType === "streamable_http") {
      const normalizedHeader = headerName.trim();
      const normalizedEnv = headerEnv.trim();
      if (Boolean(normalizedHeader) !== Boolean(normalizedEnv)) {
        setError(copy.errors.headerPair);
        return;
      }
      transport = {
        type: "streamable_http",
        url: url.trim(),
        ...(normalizedHeader && normalizedEnv
          ? { headerEnv: { [normalizedHeader]: normalizedEnv } }
          : {}),
      };
    } else {
      const normalizedCommand = command.trim();
      const normalizedTarget = envTarget.trim();
      const normalizedSource = envSource.trim();
      if (!normalizedCommand.startsWith("/")) {
        setError(copy.errors.command);
        return;
      }
      if (Boolean(normalizedTarget) !== Boolean(normalizedSource)) {
        setError(copy.errors.envPair);
        return;
      }
      const args = argsText
        .split(/\r?\n/)
        .map((argument) => argument.trim())
        .filter(Boolean);
      transport = {
        type: "stdio",
        command: normalizedCommand,
        ...(args.length > 0 ? { args } : {}),
        ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
        ...(normalizedTarget && normalizedSource
          ? { env: { [normalizedTarget]: normalizedSource } }
          : {}),
      };
      if (network) capabilities.push("network.connect");
      if (workspaceRead || workspaceWrite || cwd.trim()) {
        capabilities.push("workspace.read");
      }
      if (workspaceWrite) capabilities.push("workspace.write");
    }

    try {
      await onPropose({
        name: name.trim(),
        transport,
        requestedCapabilities: capabilities,
      });
      resetForm();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const resetForm = (): void => {
    setName("");
    setUrl("");
    setHeaderName("");
    setHeaderEnv("");
    setCommand("");
    setArgsText("");
    setCwd("");
    setEnvTarget("");
    setEnvSource("");
    setExternalRead(true);
    setExternalWrite(false);
    setNetwork(false);
    setWorkspaceRead(false);
    setWorkspaceWrite(false);
  };

  return (
    <section
      className="panel-section extensions-panel"
      aria-labelledby="extensions-title"
    >
      <div className="panel-heading">
        <div>
          <span>{copy.eyebrow}</span>
          <h2 id="extensions-title">{copy.title}</h2>
        </div>
        <span className="extension-count">
          {activeTools} {copy.activeTools}
        </span>
      </div>

      {error ? (
        <div className="extension-form-error" role="alert">
          {error}
        </div>
      ) : null}

      <ExtensionPackageDesk
        anchors={publisherAnchors}
        extensions={extensions}
        busyId={busyId}
        receipt={packageReceipt}
        deploymentPreview={packageDeploymentPreview}
        rolloutPreview={packageRolloutPreview}
        rolloutChannels={packageRolloutChannels}
        updatePreview={packageUpdatePreview}
        onCreatePublisher={onCreatePublisher}
        onRevokePublisher={onRevokePublisher}
        onSign={onSignPackage}
        onVerify={onVerifyPackage}
        onImport={onImportPackage}
        onExportLockfile={onExportPackageLockfile}
        onDownloadChannelIndex={onDownloadPackageChannelIndex}
        onPublishRollout={onPublishPackageRollout}
        onPreviewRollout={onPreviewPackageRollout}
        onPreviewUpdate={onPreviewPackageUpdate}
        onApplyUpdate={onApplyPackageUpdate}
        onCancelUpdate={onCancelPackageUpdate}
        onPreviewDeployment={onPreviewPackageDeployment}
        onApplyDeployment={onApplyPackageDeployment}
        onCancelDeployment={onCancelPackageDeployment}
      />

      <form
        className="extension-compose"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label>
          <span>{copy.name}</span>
          <input
            required
            value={name}
            placeholder={copy.namePlaceholder}
            disabled={formBusy}
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <fieldset className="extension-transport-picker">
          <legend>{copy.transport}</legend>
          <label>
            <input
              type="radio"
              name="mcp-transport"
              value="streamable_http"
              checked={transportType === "streamable_http"}
              disabled={formBusy}
              onChange={() => setTransportType("streamable_http")}
            />
            <Cable size={10} aria-hidden="true" />
            {copy.http}
          </label>
          <label>
            <input
              type="radio"
              name="mcp-transport"
              value="stdio"
              checked={transportType === "stdio"}
              disabled={formBusy}
              onChange={() => setTransportType("stdio")}
            />
            <TerminalSquare size={10} aria-hidden="true" />
            {copy.stdio}
          </label>
        </fieldset>

        {transportType === "streamable_http" ? (
          <HttpTransportFields
            url={url}
            headerName={headerName}
            headerEnv={headerEnv}
            disabled={formBusy}
            onUrl={setUrl}
            onHeaderName={setHeaderName}
            onHeaderEnv={setHeaderEnv}
          />
        ) : (
          <StdioTransportFields
            command={command}
            argsText={argsText}
            cwd={cwd}
            envTarget={envTarget}
            envSource={envSource}
            network={network}
            workspaceRead={workspaceRead}
            workspaceWrite={workspaceWrite}
            disabled={formBusy}
            onCommand={setCommand}
            onArgs={setArgsText}
            onCwd={setCwd}
            onEnvTarget={setEnvTarget}
            onEnvSource={setEnvSource}
            onNetwork={setNetwork}
            onWorkspaceRead={(enabled) => {
              setWorkspaceRead(enabled);
              if (!enabled) setWorkspaceWrite(false);
            }}
            onWorkspaceWrite={(enabled) => {
              setWorkspaceWrite(enabled);
              if (enabled) setWorkspaceRead(true);
            }}
          />
        )}

        <fieldset>
          <legend>{copy.requestedAccess}</legend>
          <label>
            <input
              type="checkbox"
              checked={externalRead}
              disabled={formBusy}
              onChange={(event) => setExternalRead(event.target.checked)}
            />
            {copy.read}
          </label>
          <label>
            <input
              type="checkbox"
              checked={externalWrite}
              disabled={formBusy}
              onChange={(event) => setExternalWrite(event.target.checked)}
            />
            {copy.write}
          </label>
        </fieldset>

        <div
          className="extension-derived-access"
          aria-label={copy.derivedAccess}
        >
          <span>{copy.derivedAccess}</span>
          <div>
            {derivedCapabilities.map((capability) => (
              <code key={capability}>{capability}</code>
            ))}
          </div>
        </div>

        <button
          className="primary-wide"
          type="submit"
          disabled={formBusy || !canSubmit}
        >
          {transportType === "stdio" ? (
            <TerminalSquare size={14} aria-hidden="true" />
          ) : (
            <Cable size={14} aria-hidden="true" />
          )}
          {copy.propose}
        </button>
      </form>

      {extensions.length === 0 ? (
        <p className="empty-panel">{copy.empty}</p>
      ) : null}
      <div className="extension-list">
        {extensions.map((extension) => (
          <ExtensionCard
            key={extension.id}
            extension={extension}
            publisherAnchors={publisherAnchors}
            agentId={agentId}
            busy={busyId === extension.id}
            onReview={onReview}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
            onToolReview={onToolReview}
            onToggle={onToggle}
          />
        ))}
      </div>
      <p className="guardrail-note">
        <ShieldCheck size={13} aria-hidden="true" />
        {copy.safety}
      </p>
    </section>
  );
}

function HttpTransportFields({
  url,
  headerName,
  headerEnv,
  disabled,
  onUrl,
  onHeaderName,
  onHeaderEnv,
}: {
  url: string;
  headerName: string;
  headerEnv: string;
  disabled: boolean;
  onUrl: (value: string) => void;
  onHeaderName: (value: string) => void;
  onHeaderEnv: (value: string) => void;
}) {
  return (
    <>
      <label>
        <span>{copy.url}</span>
        <input
          required
          value={url}
          inputMode="url"
          placeholder={copy.urlPlaceholder}
          disabled={disabled}
          onChange={(event) => onUrl(event.target.value)}
        />
      </label>
      <div className="extension-credential-grid">
        <label>
          <span>{copy.headerName}</span>
          <input
            value={headerName}
            placeholder={copy.headerNamePlaceholder}
            disabled={disabled}
            onChange={(event) => onHeaderName(event.target.value)}
          />
        </label>
        <label>
          <span>{copy.headerEnv}</span>
          <input
            value={headerEnv}
            placeholder={copy.headerEnvPlaceholder}
            disabled={disabled}
            onChange={(event) => onHeaderEnv(event.target.value)}
          />
        </label>
      </div>
    </>
  );
}

function StdioTransportFields({
  command,
  argsText,
  cwd,
  envTarget,
  envSource,
  network,
  workspaceRead,
  workspaceWrite,
  disabled,
  onCommand,
  onArgs,
  onCwd,
  onEnvTarget,
  onEnvSource,
  onNetwork,
  onWorkspaceRead,
  onWorkspaceWrite,
}: {
  command: string;
  argsText: string;
  cwd: string;
  envTarget: string;
  envSource: string;
  network: boolean;
  workspaceRead: boolean;
  workspaceWrite: boolean;
  disabled: boolean;
  onCommand: (value: string) => void;
  onArgs: (value: string) => void;
  onCwd: (value: string) => void;
  onEnvTarget: (value: string) => void;
  onEnvSource: (value: string) => void;
  onNetwork: (value: boolean) => void;
  onWorkspaceRead: (value: boolean) => void;
  onWorkspaceWrite: (value: boolean) => void;
}) {
  return (
    <div className="extension-stdio-fields">
      <label>
        <span>{copy.command}</span>
        <input
          required
          value={command}
          placeholder={copy.commandPlaceholder}
          disabled={disabled}
          spellCheck={false}
          onChange={(event) => onCommand(event.target.value)}
        />
      </label>
      <label>
        <span>{copy.args}</span>
        <textarea
          rows={3}
          value={argsText}
          placeholder={copy.argsPlaceholder}
          disabled={disabled}
          spellCheck={false}
          onChange={(event) => onArgs(event.target.value)}
        />
      </label>
      <label>
        <span>{copy.cwd}</span>
        <input
          value={cwd}
          placeholder={copy.cwdPlaceholder}
          disabled={disabled}
          spellCheck={false}
          onChange={(event) => onCwd(event.target.value)}
        />
      </label>
      <div className="extension-credential-grid">
        <label>
          <span>{copy.envTarget}</span>
          <input
            value={envTarget}
            placeholder={copy.envTargetPlaceholder}
            disabled={disabled}
            spellCheck={false}
            onChange={(event) => onEnvTarget(event.target.value)}
          />
        </label>
        <label>
          <span>{copy.envSource}</span>
          <input
            value={envSource}
            placeholder={copy.envSourcePlaceholder}
            disabled={disabled}
            spellCheck={false}
            onChange={(event) => onEnvSource(event.target.value)}
          />
        </label>
      </div>
      <fieldset className="extension-sandbox-access">
        <legend>{copy.sandboxAccess}</legend>
        <label>
          <input
            type="checkbox"
            checked={network}
            disabled={disabled}
            onChange={(event) => onNetwork(event.target.checked)}
          />
          {copy.network}
        </label>
        <label>
          <input
            type="checkbox"
            checked={workspaceRead}
            disabled={disabled}
            onChange={(event) => onWorkspaceRead(event.target.checked)}
          />
          {copy.workspaceRead}
        </label>
        <label>
          <input
            type="checkbox"
            checked={workspaceWrite}
            disabled={disabled}
            onChange={(event) => onWorkspaceWrite(event.target.checked)}
          />
          {copy.workspaceWrite}
        </label>
      </fieldset>
      <p className="extension-stdio-note">
        <ShieldCheck size={11} aria-hidden="true" />
        {copy.stdioSafety}
      </p>
    </div>
  );
}

function ExtensionCard({
  extension,
  publisherAnchors,
  agentId,
  busy,
  onReview,
  onConnect,
  onDisconnect,
  onToolReview,
  onToggle,
}: {
  extension: ExtensionRecord;
  publisherAnchors: ExtensionPublisherTrustAnchor[];
  agentId: string;
  busy: boolean;
  onReview: (extensionId: string, action: "approve" | "reject") => void;
  onConnect: (extensionId: string) => void;
  onDisconnect: (extensionId: string) => void;
  onToolReview: (
    extensionId: string,
    toolName: string,
    action: "approve" | "reject",
    effect?: "read" | "write",
    routingHint?: string,
  ) => void;
  onToggle: (extensionId: string, enabled: boolean) => void;
}) {
  const [routingHints, setRoutingHints] = useState<Record<string, string>>({});
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
  const packageEnvelope = extension.packageBinding?.envelope;
  const packageAnchor = packageEnvelope
    ? publisherAnchors.find(
        (anchor) => anchor.keyId === packageEnvelope.signature.keyId,
      )
    : undefined;
  const packageStatus: ExtensionPackageVerificationStatus | undefined =
    !packageEnvelope
      ? undefined
      : !packageAnchor
        ? "unknown_key"
        : packageAnchor.status === "revoked"
          ? "revoked"
          : packageEnvelope.manifest.expiresAt &&
              Date.parse(packageEnvelope.manifest.expiresAt) <= Date.now()
            ? "expired"
            : "trusted";
  const packageTrusted =
    packageStatus === undefined || packageStatus === "trusted";
  return (
    <article className={`extension-card extension-${extension.trustStatus}`}>
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
      {extension.packageBinding ? (
        <div className="extension-package-binding">
          <ShieldCheck size={12} aria-hidden="true" />
          <dl>
            <div>
              <dt>{copy.packages.packageTrust}</dt>
              <dd>
                {packageStatus
                  ? copy.packages.verificationStatuses[packageStatus]
                  : ""}
              </dd>
            </div>
            <div>
              <dt>{copy.packages.publisher}</dt>
              <dd>{extension.packageBinding.envelope.manifest.publisher}</dd>
            </div>
            <div>
              <dt>{copy.packages.packageRevision}</dt>
              <dd>{(extension.packageHistory?.length ?? 0) + 1}</dd>
            </div>
            <div>
              <dt>{copy.packages.packageHistory}</dt>
              <dd>{extension.packageHistory?.length ?? 0}</dd>
            </div>
            <div>
              <dt>{copy.packages.dependencies}</dt>
              <dd>
                {extension.packageBinding.envelope.manifest.dependencies
                  ?.length ?? 0}
              </dd>
            </div>
            <div>
              <dt>{copy.packages.publisherKey}</dt>
              <dd>
                <code title={extension.packageBinding.envelope.signature.keyId}>
                  {extension.packageBinding.envelope.signature.keyId.slice(
                    0,
                    12,
                  )}
                </code>
              </dd>
            </div>
            <div>
              <dt>{copy.packages.manifest}</dt>
              <dd>
                <code
                  title={
                    extension.packageBinding.envelope.manifest.contentSha256
                  }
                >
                  {extension.packageBinding.envelope.manifest.contentSha256.slice(
                    0,
                    12,
                  )}
                </code>
              </dd>
            </div>
            {extension.packageBinding.envelope.manifest.executable ? (
              <div>
                <dt>{copy.packages.executable}</dt>
                <dd>
                  <code
                    title={
                      extension.packageBinding.envelope.manifest.executable
                        .sha256
                    }
                  >
                    {extension.packageBinding.envelope.manifest.executable.sha256.slice(
                      0,
                      12,
                    )}
                  </code>
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : null}
      {packageStatus && packageStatus !== "trusted" ? (
        <p className="extension-package-warning" role="status">
          <ShieldCheck size={11} aria-hidden="true" />
          {copy.packages.verificationStatuses[packageStatus]}
        </p>
      ) : null}
      {extension.transport.type === "stdio" ? (
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
      ) : null}
      {extension.connection.error ? (
        <p className="extension-error" role="alert">
          {extension.connection.error}
        </p>
      ) : null}

      <div className="extension-actions">
        {extension.trustStatus !== "approved" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onReview(extension.id, "approve")}
          >
            <Check size={11} aria-hidden="true" />
            {copy.approve}
          </button>
        ) : null}
        {extension.trustStatus === "pending" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onReview(extension.id, "reject")}
          >
            <X size={11} aria-hidden="true" />
            {copy.reject}
          </button>
        ) : null}
        {extension.trustStatus === "approved" &&
        extension.connection.status !== "ready" &&
        packageTrusted ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onConnect(extension.id)}
          >
            <Cable size={11} aria-hidden="true" />
            {copy.connect}
          </button>
        ) : null}
        {extension.trustStatus === "approved" &&
        extension.connection.status === "ready" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onDisconnect(extension.id)}
          >
            {copy.disconnect}
          </button>
        ) : null}
        {extension.trustStatus === "approved" &&
        approvedTools > 0 &&
        packageTrusted ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onToggle(extension.id, !enabled)}
          >
            {enabled ? copy.disable : copy.enable}
          </button>
        ) : null}
      </div>

      {extension.tools.length > 0 ? (
        <section className="extension-tools" aria-label={copy.tools}>
          <header>
            <h3>{copy.tools}</h3>
            <span>{String(extension.tools.length).padStart(2, "0")}</span>
          </header>
          {extension.tools.map((tool) => (
            <article className="extension-tool" key={tool.name}>
              <header>
                <div>
                  <strong>{tool.name}</strong>
                  <code>{tool.directName}</code>
                </div>
                <span>{copy.statuses[tool.reviewStatus]}</span>
              </header>
              {tool.description ? <p>{tool.description}</p> : null}
              <label className="extension-routing-hint">
                <span>{copy.routingHint}</span>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={routingHints[tool.name] ?? tool.routingHint ?? ""}
                  placeholder={copy.routingHintPlaceholder}
                  disabled={busy}
                  onChange={(event) =>
                    setRoutingHints((current) => ({
                      ...current,
                      [tool.name]: event.target.value,
                    }))
                  }
                />
              </label>
              <div className="extension-tool-meta">
                <span>
                  {copy.effect}:{" "}
                  {tool.effect === "unknown"
                    ? copy.unknown
                    : tool.effect === "read"
                      ? copy.read
                      : copy.write}
                </span>
                <span>
                  {copy.schema} {tool.schemaSha256.slice(0, 8)}
                </span>
              </div>
              <footer>
                {tool.reviewStatus === "approved" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      onToolReview(extension.id, tool.name, "reject")
                    }
                  >
                    {copy.revoke}
                  </button>
                ) : (
                  <>
                    {extension.approvedCapabilities.includes(
                      "external.read",
                    ) ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          onToolReview(
                            extension.id,
                            tool.name,
                            "approve",
                            "read",
                            routingHints[tool.name] ?? tool.routingHint ?? "",
                          )
                        }
                      >
                        {copy.approveRead}
                      </button>
                    ) : null}
                    {extension.approvedCapabilities.includes(
                      "external.write",
                    ) ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          onToolReview(
                            extension.id,
                            tool.name,
                            "approve",
                            "write",
                            routingHints[tool.name] ?? tool.routingHint ?? "",
                          )
                        }
                      >
                        {copy.approveWrite}
                      </button>
                    ) : null}
                    {tool.reviewStatus === "pending" ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          onToolReview(extension.id, tool.name, "reject")
                        }
                      >
                        {copy.reject}
                      </button>
                    ) : null}
                  </>
                )}
              </footer>
            </article>
          ))}
        </section>
      ) : extension.trustStatus === "approved" ? (
        <p className="extension-no-tools">{copy.noTools}</p>
      ) : null}
    </article>
  );
}
