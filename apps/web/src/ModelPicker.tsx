import type { ModelSummary } from "@napier/contracts";
import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { copy } from "./copy";
import {
  modelPickerGroups,
  selectedModelAvailability,
} from "./model-selection-view-model";
import {
  ModelPickerProviderSetup,
  type ModelPickerSetupConfig,
} from "./ModelPickerProviderSetup";
import "./model-picker.css";

export interface ModelPickerProps {
  models: readonly ModelSummary[];
  value: string;
  label: string;
  disabled?: boolean;
  variant?: "compact" | "full";
  recommendedModelKeys?: readonly string[] | undefined;
  recentModelKeys?: readonly string[] | undefined;
  setup?: ModelPickerSetupConfig | undefined;
  onChange(value: string): void;
}

export function ModelPicker({
  models,
  value,
  label,
  disabled = false,
  variant = "full",
  recommendedModelKeys = [],
  recentModelKeys = [],
  setup,
  onChange,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const pickerId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = selectedModelAvailability(models, value);
  const selectedSummary = models.find(
    (model) => `${model.provider}/${model.id}` === value,
  );
  const hasConfiguredLiveModel = models.some(
    (model) => model.provider !== "napier" && model.configured,
  );
  const groups = useMemo(
    () =>
      modelPickerGroups(models, {
        query,
        showUnavailable,
        recommendedModelKeys,
        recentModelKeys,
      }),
    [models, query, recommendedModelKeys, recentModelKeys, showUnavailable],
  );
  const options = groups.flatMap((group) => group.options);
  const activeOptionId = options[activeIndex]
    ? `${pickerId}-option-${String(activeIndex)}`
    : undefined;

  const closeAndRestoreFocus = () => {
    setOpen(false);
    setQuery("");
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (event.target && !rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      window.clearTimeout(focusTimer);
    };
  }, [open]);

  useEffect(() => setActiveIndex(0), [query, showUnavailable]);
  useEffect(() => {
    setActiveIndex((current) =>
      Math.min(current, Math.max(options.length - 1, 0)),
    );
  }, [options.length]);

  const choose = (key: string, configured: boolean) => {
    if (!configured) return;
    onChange(key);
    closeAndRestoreFocus();
  };

  return (
    <div
      ref={rootRef}
      className={`model-picker is-${variant}${open ? " is-open" : ""}`}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`model-picker-trigger${variant === "compact" ? " model-chip" : ""}${selected.configured ? "" : " is-unavailable"}`}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="model-glyph" aria-hidden="true">
          {selected.provider === "napier"
            ? "D"
            : selected.provider.slice(0, 1).toUpperCase()}
        </span>
        <span className="model-chip-copy">
          <small>
            {selected.configured
              ? (selectedSummary?.providerName ?? selected.provider)
              : copy.modelPicker.unavailable}
          </small>
          <strong>{selectedSummary?.name ?? selected.id}</strong>
        </span>
        <ChevronDown
          className="model-chip-chevron"
          size={12}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div
          className="model-picker-popover"
          role="dialog"
          aria-label={copy.modelPicker.title}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              closeAndRestoreFocus();
            } else if (event.key === "ArrowDown" && options.length > 0) {
              event.preventDefault();
              setActiveIndex((current) => (current + 1) % options.length);
            } else if (event.key === "ArrowUp" && options.length > 0) {
              event.preventDefault();
              setActiveIndex(
                (current) => (current - 1 + options.length) % options.length,
              );
            } else if (event.key === "Home" && options.length > 0) {
              event.preventDefault();
              setActiveIndex(0);
            } else if (event.key === "End" && options.length > 0) {
              event.preventDefault();
              setActiveIndex(options.length - 1);
            } else if (event.key === "Enter") {
              const option = options[activeIndex];
              if (option) {
                event.preventDefault();
                choose(option.key, option.configured);
              }
            }
          }}
        >
          <label className="model-picker-search">
            <Search size={14} aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              role="combobox"
              value={query}
              aria-label={copy.modelPicker.searchLabel}
              aria-expanded="true"
              aria-controls={`${pickerId}-results`}
              aria-activedescendant={activeOptionId}
              aria-autocomplete="list"
              placeholder={copy.modelPicker.searchPlaceholder}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="model-picker-unavailable-toggle">
            <input
              type="checkbox"
              checked={showUnavailable}
              onChange={(event) => setShowUnavailable(event.target.checked)}
            />
            <span>{copy.modelPicker.showUnavailable}</span>
          </label>
          {setup && !hasConfiguredLiveModel ? (
            <ModelPickerProviderSetup
              config={setup}
              labels={copy.modelPicker}
              onEnabled={(modelKey) => {
                onChange(modelKey);
                closeAndRestoreFocus();
              }}
            />
          ) : null}
          <div
            id={`${pickerId}-results`}
            className="model-picker-results"
            role="listbox"
            aria-label={label}
          >
            {groups.map((group, groupIndex) => (
              <section
                className="model-picker-group"
                role="group"
                aria-labelledby={`${pickerId}-group-${String(groupIndex)}`}
                key={group.id}
              >
                <h3 id={`${pickerId}-group-${String(groupIndex)}`}>
                  {groupLabel(group.id, group.label)}
                </h3>
                {group.options.map((option) => {
                  const index = options.findIndex(
                    (item) => item.key === option.key,
                  );
                  return (
                    <button
                      id={`${pickerId}-option-${String(index)}`}
                      type="button"
                      role="option"
                      tabIndex={-1}
                      aria-selected={option.key === value}
                      aria-disabled={!option.configured}
                      className={index === activeIndex ? "is-active" : ""}
                      key={option.key}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => choose(option.key, option.configured)}
                    >
                      <span className="model-picker-option-main">
                        <strong>{option.name}</strong>
                        <code>
                          {option.provider}/{option.id}
                        </code>
                      </span>
                      <span className="model-picker-option-meta">
                        <i className={option.configured ? "is-ready" : ""}>
                          {option.configured
                            ? copy.modelPicker.configured
                            : copy.modelPicker.unavailable}
                        </i>
                        <span>{formatContextWindow(option.contextWindow)}</span>
                        {option.reasoning ? (
                          <span>{copy.modelPicker.reasoning}</span>
                        ) : null}
                        {option.vision ? (
                          <span>{copy.modelPicker.vision}</span>
                        ) : null}
                      </span>
                      {option.key === value ? (
                        <Check size={14} aria-hidden="true" />
                      ) : null}
                    </button>
                  );
                })}
              </section>
            ))}
            {options.length === 0 ? (
              <p className="model-picker-empty">{copy.modelPicker.empty}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function groupLabel(id: string, fallback: string): string {
  if (id === "recommended") return copy.modelPicker.recommended;
  if (id === "recent") return copy.modelPicker.recent;
  return fallback;
}

function formatContextWindow(tokens: number): string {
  const value =
    tokens >= 1_000 ? `${Math.round(tokens / 1_000)}k` : String(tokens);
  return `${value} ${copy.modelPicker.context}`;
}
