import type { FormEvent } from "react";
import { useState } from "react";
import { Play, RotateCcw } from "lucide-react";

import type { BrowserTaskBackend } from "./browser-task-api";
import { browserTaskCopy } from "./browser-task-copy";
import { browserTaskFormValue } from "./browser-task-form-value";
import type { BrowserTaskFormDefaults } from "./browser-task-form-types";
import { BrowserTaskActiveControls } from "./BrowserTaskActiveControls";
import { BrowserTaskDisclosure } from "./BrowserTaskDisclosure";
import {
  BrowserTaskModelFields,
  browserTaskModelFieldsKey,
} from "./BrowserTaskModelFields";
import { BrowserTaskScopeFields } from "./BrowserTaskScopeFields";
import type { BrowserTaskRunner } from "./use-browser-task-runner";

export interface BrowserTaskFormProps {
  runner: BrowserTaskRunner;
  defaults: BrowserTaskFormDefaults;
}

export function BrowserTaskForm({ runner, defaults }: BrowserTaskFormProps) {
  const [backend, setBackend] =
    useState<BrowserTaskBackend>("browser_use_local");
  const copy = browserTaskCopy.form;
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void runner.start(browserTaskFormValue(new FormData(event.currentTarget)));
  }
  return (
    <form
      className="browser-task-form"
      aria-busy={runner.busy}
      onSubmit={submit}
    >
      <label className="browser-task-wide">
        <span>{copy.backend}</span>
        <select
          name="backend"
          value={backend}
          disabled={runner.busy}
          onChange={(event) =>
            setBackend(event.currentTarget.value as BrowserTaskBackend)
          }
        >
          <option value="browser_use_local">
            {copy.backends.browser_use_local}
          </option>
          <option value="browser_use_cloud">
            {copy.backends.browser_use_cloud}
          </option>
        </select>
      </label>
      <BrowserTaskDisclosure backend={backend} />
      <BrowserTaskScopeFields busy={runner.busy} />
      <BrowserTaskModelFields
        key={browserTaskModelFieldsKey(backend, defaults)}
        busy={runner.busy}
        backend={backend}
        defaults={defaults}
      />
      <div className="browser-task-actions browser-task-wide">
        {runner.busy ? (
          <BrowserTaskActiveControls runner={runner} />
        ) : (
          <>
            {runner.canRetry ? (
              <button type="button" onClick={() => void runner.retry()}>
                <RotateCcw size={12} aria-hidden="true" />
                {copy.retry}
              </button>
            ) : null}
            <button type="submit">
              <Play size={12} fill="currentColor" aria-hidden="true" />
              {backend === "browser_use_cloud"
                ? copy.startCloud
                : copy.startLocal}
            </button>
          </>
        )}
        <span role="status">{browserTaskRunnerSummary(runner)}</span>
      </div>
    </form>
  );
}

function browserTaskRunnerSummary(runner: BrowserTaskRunner): string {
  const copy = browserTaskCopy.form;
  const record = runner.created ?? runner.snapshot;
  if (!record) {
    return runner.status === "restoring" ? copy.checking : copy.nativeDefault;
  }
  const continuity = runner.snapshot
    ? `${copy.restoredHistory} · `
    : runner.recovered
      ? `${copy.reconnected} · `
      : "";
  return `${copy.backends[record.backend]} · ${continuity}${copy.statuses[runner.status]}`;
}
