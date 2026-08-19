import { MousePointerClick, Plus } from "lucide-react";

import { browserLiveCopy } from "./browser-live-copy";
import type {
  BrowserTakeoverBinding,
  BrowserTakeoverFormState,
} from "./browser-takeover-view";

export interface BrowserTakeoverActionControlsProps {
  form: BrowserTakeoverFormState;
  binding: BrowserTakeoverBinding | undefined;
  tabCount: number | undefined;
  busy: boolean;
  onChange: (patch: Partial<BrowserTakeoverFormState>) => void;
  onOpenTab: () => void;
  onSubmit: () => void;
}

export function BrowserTakeoverActionControls({
  form,
  binding,
  tabCount,
  busy,
  onChange,
  onOpenTab,
  onSubmit,
}: BrowserTakeoverActionControlsProps) {
  const copy = browserLiveCopy.takeover;
  return (
    <div className="browser-takeover-controls">
      <div className="browser-takeover-new-tab">
        <label>
          {copy.newPublicUrl}
          <input
            type="url"
            value={form.newTabUrl}
            onChange={(event) => onChange({ newTabUrl: event.target.value })}
            placeholder="https://example.com/"
            maxLength={4_096}
            autoComplete="off"
          />
        </label>
        <button
          type="button"
          disabled={
            busy || !binding || !form.newTabUrl.trim() || tabCount === 4
          }
          onClick={onOpenTab}
        >
          <Plus size={12} aria-hidden="true" />
          {copy.newTab}
        </button>
      </div>
      <div
        className="browser-takeover-mode"
        role="group"
        aria-label={copy.action}
      >
        {(["click", "type", "select"] as const).map((mode) => (
          <button
            type="button"
            className={form.mode === mode ? "is-active" : ""}
            key={mode}
            onClick={() => onChange({ mode })}
          >
            {copy.modes[mode]}
          </button>
        ))}
      </div>
      <label>
        {copy.freshRef}
        <input
          value={form.ref}
          onChange={(event) => onChange({ ref: event.target.value })}
          placeholder="e6"
          maxLength={40}
        />
      </label>
      {form.mode !== "click" ? (
        <label>
          {form.mode === "type" ? copy.text : copy.values}
          {form.mode === "type" ? (
            <input
              type="password"
              value={form.value}
              onChange={(event) => onChange({ value: event.target.value })}
              maxLength={8_000}
              autoComplete="off"
            />
          ) : (
            <textarea
              value={form.value}
              onChange={(event) => onChange({ value: event.target.value })}
              maxLength={10_240}
            />
          )}
        </label>
      ) : (
        <label className="browser-takeover-checkbox">
          <input
            type="checkbox"
            checked={form.allowCrossOrigin}
            onChange={(event) =>
              onChange({ allowCrossOrigin: event.target.checked })
            }
          />
          {copy.allowCrossOrigin}
        </label>
      )}
      <button
        className="browser-takeover-primary"
        type="button"
        disabled={busy || !binding || !form.ref.trim()}
        onClick={onSubmit}
      >
        <MousePointerClick size={12} aria-hidden="true" />
        {copy.executeOnce}
      </button>
    </div>
  );
}
