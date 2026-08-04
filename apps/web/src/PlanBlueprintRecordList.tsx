import type {
  ExecutionPlanBlueprintRecord,
  ExecutionPlanBlueprintRecordOutcomeReview,
} from "@napier/contracts";

import type { PlanBlueprintLibraryBusyAction } from "./plan-blueprint-library-panel-types";
import { planCopy } from "./plan-copy";

export function PlanBlueprintRecordList({
  records,
  loaded,
  canCreateRecord,
  busyAction,
  latestOutcomeReview,
  selectedModelConfigured,
  modelReviewWarningId,
  onArchive,
  onRestore,
  onQualify,
  onPreview,
  onHistory,
  onOutcomes,
  onPromoteOutcomeBaseline,
  onPromoteReviewedOutcomeBaseline,
  onQualifyOutcomes,
  onReviewOutcomes,
  onCreate,
}: {
  records: ExecutionPlanBlueprintRecord[];
  loaded: boolean;
  canCreateRecord: boolean;
  busyAction: PlanBlueprintLibraryBusyAction | undefined;
  latestOutcomeReview: ExecutionPlanBlueprintRecordOutcomeReview | undefined;
  selectedModelConfigured: boolean;
  modelReviewWarningId: string;
  onArchive: (record: ExecutionPlanBlueprintRecord) => void;
  onRestore: (record: ExecutionPlanBlueprintRecord) => void;
  onQualify: (record: ExecutionPlanBlueprintRecord) => void;
  onPreview: (record: ExecutionPlanBlueprintRecord) => void;
  onHistory: (record: ExecutionPlanBlueprintRecord) => void;
  onOutcomes: (record: ExecutionPlanBlueprintRecord) => void;
  onPromoteOutcomeBaseline: (record: ExecutionPlanBlueprintRecord) => void;
  onPromoteReviewedOutcomeBaseline: (
    record: ExecutionPlanBlueprintRecord,
  ) => void;
  onQualifyOutcomes: (record: ExecutionPlanBlueprintRecord) => void;
  onReviewOutcomes: (record: ExecutionPlanBlueprintRecord) => void;
  onCreate: (record: ExecutionPlanBlueprintRecord) => void;
}) {
  const busy = Boolean(busyAction);
  return (
    <>
      {loaded && records.length === 0 ? (
        <p className="blueprint-library-empty">
          {planCopy.blueprint.library.empty}
        </p>
      ) : null}
      {records.length > 0 ? (
        <div className="blueprint-record-list">
          {records.map((record) => (
            <article
              key={record.id}
              className={`blueprint-record blueprint-record-${record.status}`}
            >
              <header>
                <div>
                  <strong>{record.name}</strong>
                  <span>
                    {planCopy.blueprint.library.statuses[record.status]}
                  </span>
                </div>
                <code>{record.blueprintSha256.slice(0, 16)}</code>
              </header>
              {record.description ? <p>{record.description}</p> : null}
              <dl>
                <div>
                  <dt>{planCopy.blueprint.library.source}</dt>
                  <dd>
                    {shortId(record.sourcePlanId)} r{record.sourcePlanRevision}
                  </dd>
                </div>
                <div>
                  <dt>{planCopy.blueprint.library.shape}</dt>
                  <dd>
                    {record.blueprint.stepCount.toLocaleString()}{" "}
                    {planCopy.blueprint.steps}
                    {" / "}
                    {record.blueprint.artifactCount.toLocaleString()}{" "}
                    {planCopy.blueprint.artifacts}
                  </dd>
                </div>
                <div>
                  <dt>{planCopy.blueprint.library.updated}</dt>
                  <dd>{new Date(record.updatedAt).toLocaleDateString()}</dd>
                </div>
              </dl>
              <div className="blueprint-record-actions">
                <button
                  type="button"
                  disabled={
                    busy || !canCreateRecord || record.status !== "active"
                  }
                  onClick={() => onCreate(record)}
                >
                  {busyAction === "create"
                    ? planCopy.blueprint.library.creating
                    : planCopy.blueprint.library.create}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onQualify(record)}
                >
                  {busyAction === "qualify"
                    ? planCopy.blueprint.library.qualifying
                    : planCopy.blueprint.library.qualify}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onPreview(record)}
                >
                  {busyAction === "preview"
                    ? planCopy.blueprint.library.previewing
                    : planCopy.blueprint.library.preview}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onHistory(record)}
                >
                  {busyAction === "history"
                    ? planCopy.blueprint.library.loadingHistory
                    : planCopy.blueprint.library.history}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onOutcomes(record)}
                >
                  {busyAction === "outcomes"
                    ? planCopy.blueprint.library.loadingOutcomes
                    : planCopy.blueprint.library.outcomes}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onPromoteOutcomeBaseline(record)}
                >
                  {busyAction === "promoteOutcomeBaseline"
                    ? planCopy.blueprint.library.promotingOutcomeBaseline
                    : planCopy.blueprint.library.promoteOutcomeBaseline}
                </button>
                {latestOutcomeReview?.recordId === record.id ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onPromoteReviewedOutcomeBaseline(record)}
                  >
                    {busyAction === "promoteReviewedOutcomeBaseline"
                      ? planCopy.blueprint.library
                          .promotingReviewedOutcomeBaseline
                      : planCopy.blueprint.library
                          .promoteReviewedOutcomeBaseline}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onQualifyOutcomes(record)}
                >
                  {busyAction === "qualifyOutcomes"
                    ? planCopy.blueprint.library.qualifyingOutcomes
                    : planCopy.blueprint.library.qualifyOutcomes}
                </button>
                <button
                  type="button"
                  disabled={busy || !selectedModelConfigured}
                  aria-describedby={
                    !selectedModelConfigured ? modelReviewWarningId : undefined
                  }
                  onClick={() => onReviewOutcomes(record)}
                >
                  {busyAction === "reviewOutcomes"
                    ? planCopy.blueprint.library.reviewingOutcomes
                    : planCopy.blueprint.library.reviewOutcomes}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    record.status === "active"
                      ? onArchive(record)
                      : onRestore(record)
                  }
                >
                  {statusActionLabel(record.status, busyAction)}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
      {!canCreateRecord ? (
        <small className="blueprint-library-hint">
          {planCopy.blueprint.library.locked}
        </small>
      ) : null}
    </>
  );
}

function statusActionLabel(
  status: ExecutionPlanBlueprintRecord["status"],
  busyAction: PlanBlueprintLibraryBusyAction | undefined,
): string {
  if (status === "active") {
    return busyAction === "status"
      ? planCopy.blueprint.library.archiving
      : planCopy.blueprint.library.archive;
  }
  return busyAction === "status"
    ? planCopy.blueprint.library.restoring
    : planCopy.blueprint.library.restore;
}

function shortId(value: string): string {
  return value.length > 15
    ? `${value.slice(0, 7)}...${value.slice(-5)}`
    : value;
}
