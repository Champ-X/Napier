import { ShieldCheck } from "lucide-react";

import { extensionCopy as copy } from "./extension-copy";

export function HttpTransportFields({
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

export function StdioTransportFields({
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
