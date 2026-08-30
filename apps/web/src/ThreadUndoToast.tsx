import { ArchiveRestore } from "lucide-react";

export function ThreadUndoToast({
  title,
  busy,
  labels,
  onRestore,
}: {
  title: string | undefined;
  busy: boolean;
  labels: { trashed: string; undo: string; restoring: string };
  onRestore(): void;
}) {
  if (!title) return null;
  return (
    <div className="thread-undo" role="status" aria-live="polite">
      <ArchiveRestore size={18} aria-hidden="true" />
      <div>
        <span>{labels.trashed}</span>
        <strong>{title}</strong>
      </div>
      <button type="button" disabled={busy} onClick={onRestore}>
        {busy ? labels.restoring : labels.undo}
      </button>
    </div>
  );
}
