import { useMemo, useState } from "react";
import { Cable, TerminalSquare } from "lucide-react";

import type {
  CreateMcpExtensionRequest,
  ExtensionCapability,
} from "@napier/contracts";

import { extensionCopy as copy } from "./extension-copy";
import {
  HttpTransportFields,
  StdioTransportFields,
} from "./ExtensionTransportFields";

type Proposal = Omit<CreateMcpExtensionRequest, "threadId">;

export interface ExtensionProposalFormProps {
  busyId: string | undefined;
  onPropose(request: Proposal): Promise<void>;
}

export function ExtensionProposalForm({
  busyId,
  onPropose,
}: ExtensionProposalFormProps) {
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
    <>
      {error ? (
        <div className="extension-form-error" role="alert">
          {error}
        </div>
      ) : null}
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
    </>
  );
}
