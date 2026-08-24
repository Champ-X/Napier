export function assertSubagentFailureContext(
  task: Record<string, unknown>,
  label: string,
): void {
  const value = task["failureContextSha256"];
  if (
    value !== undefined &&
    (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
  ) {
    throw new Error(`Thread replay bundle ${label}.failureContextSha256 is invalid`);
  }
}
