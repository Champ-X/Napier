import type { PlanArtifactDataProfile } from "./artifact-file-api";
import { structuredDataFormatLabel } from "./structured-data-format-view";

type ArtifactDataCell =
  | PlanArtifactDataProfile["sampleRows"][number][string]
  | undefined;

export interface ArtifactDataProfileTableColumn {
  id: string;
  label: string;
}

export interface ArtifactDataProfileTableCell {
  id: string;
  value: string;
}

export interface ArtifactDataProfileTableRow {
  id: string;
  cells: ArtifactDataProfileTableCell[];
}

export interface ArtifactDataProfileView {
  formatLabel: string;
  columnSetShortSha256: string;
  sampleShortSha256: string;
  hasColumns: boolean;
  hasSampleRows: boolean;
  columns: ArtifactDataProfileTableColumn[];
  rows: ArtifactDataProfileTableRow[];
}

export function projectArtifactDataProfileView(
  profile: PlanArtifactDataProfile,
): ArtifactDataProfileView {
  const columns = profile.columns.map((column, index) => ({
    id: `${index}:${column}`,
    label: column,
  }));
  return {
    formatLabel: structuredDataFormatLabel(profile.format),
    columnSetShortSha256: profile.columnSetSha256.slice(0, 16),
    sampleShortSha256: profile.sampleSha256.slice(0, 16),
    hasColumns: columns.length > 0,
    hasSampleRows: profile.sampleRows.length > 0,
    columns,
    rows: profile.sampleRows.map((row, rowIndex) => ({
      id: `${profile.artifactId}:${rowIndex}`,
      cells: columns.map((column, columnIndex) => ({
        id: `${rowIndex}:${columnIndex}`,
        value: formatArtifactDataCell(row[column.label]),
      })),
    })),
  };
}

export function artifactDataProfileFilename(
  profile: PlanArtifactDataProfile,
): string {
  const safeArtifactId = safeFilenameSegment(profile.artifactId, "artifact");
  return `napier-artifact-data-profile-${safeArtifactId}-${profile.sha256.slice(0, 12)}-${profile.sampleSha256.slice(0, 12)}.json`;
}

function formatArtifactDataCell(value: ArtifactDataCell): string {
  if (value === undefined) return "";
  if (value === null) return "null";
  return String(value);
}

function safeFilenameSegment(value: string, fallback: string): string {
  const safe = value.replace(/[^A-Za-z0-9._-]/g, "_");
  return safe.length > 0 && safe !== "." && safe !== ".." ? safe : fallback;
}
