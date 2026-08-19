import { Download } from "lucide-react";

import type { RunRecord } from "@napier/contracts";

import { copy } from "./copy";

export function RunPicker({
  side,
  label,
  runs,
  value,
  busy,
  onChange,
  onExport,
}: {
  side: string;
  label: string;
  runs: RunRecord[];
  value: string;
  busy: boolean;
  onChange: (runId: string) => void;
  onExport: (runId: string) => void;
}) {
  return (
    <label className="run-picker">
      <span className="run-side" aria-hidden="true">
        {side}
      </span>
      <span>{label}</span>
      <select
        aria-label={label}
        value={value}
        disabled={busy}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{copy.lab.selectRun}</option>
        {runs.map((run, index) => (
          <option key={run.id} value={run.id}>
            {String(index + 1).padStart(2, "0")} ·{" "}
            {settledRunStatusLabel(run.status)} · {shortId(run.id)}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!value || busy}
        aria-label={`${copy.lab.export}: ${value}`}
        onClick={(event) => {
          event.preventDefault();
          onExport(value);
        }}
      >
        <Download size={11} aria-hidden="true" />
        {copy.lab.export}
      </button>
    </label>
  );
}

export function MetricDelta({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function settledRunStatusLabel(status: RunRecord["status"]): string {
  if (status === "completed") return copy.lab.statuses.completed;
  if (status === "failed") return copy.lab.statuses.failed;
  if (status === "cancelled") return copy.lab.statuses.cancelled;
  if (status === "interrupted") return copy.lab.statuses.interrupted;
  return status;
}

function shortId(value: string): string {
  return value.length > 15
    ? `${value.slice(0, 7)}...${value.slice(-5)}`
    : value;
}
