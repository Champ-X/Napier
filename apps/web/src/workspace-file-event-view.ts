import type { RunEvent } from "@napier/contracts";

const SHA256 = /^[a-f0-9]{64}$/u;
const OPERATION = /^(create_directory|move|trash|restore)$/u;
const POSTCONDITION = /^(verified|drifted|indeterminate)$/u;

export function workspaceFileEventTraceSummary(
  event: RunEvent,
): string | undefined {
  if (
    event.type !== "workspace.file.mutated" &&
    event.type !== "workspace.file.recovered"
  ) {
    return undefined;
  }
  if (
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return "workspace file mutation";
  }
  const operation = stringMatch(event.payload["operation"], OPERATION);
  const postcondition = stringMatch(
    event.payload["postcondition"],
    POSTCONDITION,
  );
  const sourcePathSha256 = stringMatch(
    event.payload["sourcePathSha256"],
    SHA256,
  );
  const destinationPathSha256 = stringMatch(
    event.payload["destinationPathSha256"],
    SHA256,
  );
  const beforeSha256 = stringMatch(event.payload["beforeSha256"], SHA256);
  const afterSha256 = stringMatch(event.payload["afterSha256"], SHA256);
  const fileCount = integer(event.payload["fileCount"]);
  const directoryCount = integer(event.payload["directoryCount"]);
  const bytes = integer(event.payload["bytes"]);
  return [
    event.type === "workspace.file.recovered"
      ? "workspace file recovery"
      : "workspace file mutation",
    ...(operation ? [operation] : []),
    ...(event.payload["initiatedBy"] === "agent" ||
    event.payload["initiatedBy"] === "operator"
      ? [`by ${event.payload["initiatedBy"]}`]
      : []),
    ...(fileCount !== undefined ? [`files ${fileCount}`] : []),
    ...(directoryCount !== undefined ? [`directories ${directoryCount}`] : []),
    ...(bytes !== undefined ? [`bytes ${bytes}`] : []),
    ...(sourcePathSha256 ? [`source ${sourcePathSha256.slice(0, 12)}`] : []),
    ...(destinationPathSha256
      ? [`destination ${destinationPathSha256.slice(0, 12)}`]
      : []),
    ...(beforeSha256 ? [`before ${beforeSha256.slice(0, 12)}`] : []),
    ...(afterSha256 ? [`after ${afterSha256.slice(0, 12)}`] : []),
    ...(postcondition ? [`postcondition ${postcondition}`] : []),
    ...(event.payload["reversible"] === true ? ["reversible"] : []),
  ].join(" / ");
}

function stringMatch(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}
