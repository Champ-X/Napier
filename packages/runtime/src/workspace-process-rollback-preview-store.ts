import type { WorkspaceProcessRollbackPreview } from "@napier/contracts";

export class WorkspaceProcessRollbackPreviewStore {
  private readonly previews = new Map<
    string,
    { preview: WorkspaceProcessRollbackPreview; createdAtMs: number }
  >();

  constructor(
    private readonly now: () => Date,
    private readonly maximumPreviews: number,
  ) {}

  set(preview: WorkspaceProcessRollbackPreview): void {
    this.prune();
    this.previews.set(preview.id, {
      preview,
      createdAtMs: Date.parse(preview.createdAt),
    });
    this.prune();
  }

  consume(previewId: string): WorkspaceProcessRollbackPreview | undefined {
    this.prune();
    const stored = this.previews.get(previewId);
    this.previews.delete(previewId);
    return stored?.preview;
  }

  removeProcess(processId: string): void {
    for (const [previewId, stored] of this.previews) {
      if (stored.preview.processId === processId) {
        this.previews.delete(previewId);
      }
    }
  }

  private prune(): void {
    const now = this.now().getTime();
    for (const [previewId, stored] of this.previews) {
      if (Date.parse(stored.preview.expiresAt) <= now) {
        this.previews.delete(previewId);
      }
    }
    const retained = [...this.previews.entries()].sort(
      (left, right) => left[1].createdAtMs - right[1].createdAtMs,
    );
    while (retained.length > this.maximumPreviews) {
      const oldest = retained.shift();
      if (oldest) this.previews.delete(oldest[0]);
    }
  }
}
