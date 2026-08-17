import { useState } from "react";
import { FolderTree } from "lucide-react";

import { rebindWorkspaceRoot } from "./api";
import { formatApiErrorMessage } from "./api-error";
import { copy } from "./copy";

export function WorkspaceRootPanel({
  root,
  dataRoot,
}: {
  root: string;
  dataRoot: string;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const c = copy.workspaceSurface;

  const submit = async () => {
    const next = value.trim();
    if (!next || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await rebindWorkspaceRoot(next);
      // The rebind swaps to a different ledger, so the current ?thread no longer
      // exists there. Navigate to the bare path to load the new workspace's own
      // default thread instead of reloading onto a stale thread id.
      window.location.assign(window.location.pathname);
    } catch (rebindError) {
      setError(formatApiErrorMessage(rebindError));
      setBusy(false);
    }
  };

  return (
    <div className="workspace-root-panel">
      <dl className="workspace-root-facts">
        <div>
          <dt>{c.currentRoot}</dt>
          <dd>
            <code>{root}</code>
          </dd>
        </div>
        <div>
          <dt>{c.dataRoot}</dt>
          <dd>
            <code>{dataRoot}</code>
          </dd>
        </div>
      </dl>
      <p className="workspace-root-warning">{c.warning}</p>
      <form
        className="workspace-root-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="workspace-root-input">{c.inputLabel}</label>
        <input
          id="workspace-root-input"
          type="text"
          spellCheck={false}
          autoComplete="off"
          placeholder={c.placeholder}
          value={value}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
        />
        <button type="submit" disabled={busy || !value.trim()}>
          <FolderTree size={14} aria-hidden="true" />
          {busy ? c.switching : c.submit}
        </button>
      </form>
      {error ? (
        <p className="workspace-root-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default WorkspaceRootPanel;
