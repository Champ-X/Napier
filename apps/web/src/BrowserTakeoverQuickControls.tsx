import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Clock,
  Keyboard,
} from "lucide-react";

import { BROWSER_TAKEOVER_KEYS } from "@napier/contracts/browser-takeover";

import { browserLiveCopy } from "./browser-live-copy";
import type {
  BrowserTakeoverBinding,
  BrowserTakeoverExecute,
  BrowserTakeoverFormState,
} from "./browser-takeover-view";

export interface BrowserTakeoverQuickControlsProps {
  form: BrowserTakeoverFormState;
  binding: BrowserTakeoverBinding | undefined;
  busy: boolean;
  onChange: (patch: Partial<BrowserTakeoverFormState>) => void;
  execute: BrowserTakeoverExecute;
}

export function BrowserTakeoverQuickControls({
  form,
  binding,
  busy,
  onChange,
  execute,
}: BrowserTakeoverQuickControlsProps) {
  const copy = browserLiveCopy.takeover;
  const crossOrigin = form.allowCrossOrigin
    ? { allowCrossOrigin: true as const }
    : {};
  const disabled = busy || !binding;
  return (
    <div className="browser-takeover-quick">
      <label className="browser-takeover-key">
        {copy.navigationKey}
        <select
          value={form.selectedKey}
          onChange={(event) =>
            onChange({
              selectedKey: event.target.value as typeof form.selectedKey,
            })
          }
        >
          {BROWSER_TAKEOVER_KEYS.map((key) => (
            <option value={key} key={key}>
              {key}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          binding &&
          void execute({
            ...binding,
            action: "keypress",
            key: form.selectedKey,
            ...crossOrigin,
          })
        }
      >
        <Keyboard size={12} aria-hidden="true" />
        {copy.pressKey}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          binding &&
          void execute({
            ...binding,
            action: "scroll",
            direction: "up",
            pixels: 720,
          })
        }
      >
        <ArrowUp size={12} aria-hidden="true" />
        {copy.scrollUp}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          binding &&
          void execute({
            ...binding,
            action: "scroll",
            direction: "down",
            pixels: 720,
          })
        }
      >
        <ArrowDown size={12} aria-hidden="true" />
        {copy.scrollDown}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          binding &&
          void execute({ ...binding, action: "back", ...crossOrigin })
        }
      >
        <ArrowLeft size={12} aria-hidden="true" />
        {copy.back}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          binding &&
          void execute({ ...binding, action: "forward", ...crossOrigin })
        }
      >
        <ArrowRight size={12} aria-hidden="true" />
        {copy.forward}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          binding &&
          void execute({ ...binding, action: "wait", durationMs: 1_000 })
        }
      >
        <Clock size={12} aria-hidden="true" />
        {copy.wait}
      </button>
    </div>
  );
}
