/** Only ESRCH proves a local process owner dead. Unknown formats/errors stay unknown. */
export function localProcessOwnerStatus(
  ownerId: string,
): "alive" | "dead" | "unknown" {
  const match = /^process:([1-9][0-9]*):[a-z][a-z0-9_]+$/u.exec(ownerId);
  const pid = Number(match?.[1]);
  if (!match || !Number.isSafeInteger(pid)) return "unknown";
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ESRCH"
      ? "dead"
      : "unknown";
  }
}
