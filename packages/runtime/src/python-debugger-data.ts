function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function boundPythonDebugData(data: unknown) {
  let truncated = false;
  function visit(value: unknown, depth = 0): unknown {
    if (typeof value === "string") {
      if (value.length > 512) truncated = true;
      return value.slice(0, 512);
    }
    if (depth > 4) {
      truncated = true;
      return null;
    }
    if (Array.isArray(value)) {
      if (value.length > 32) truncated = true;
      return value.slice(0, 32).map((v) => visit(v, depth + 1));
    }
    if (record(value)) {
      const entries = Object.entries(value);
      if (entries.length > 32) truncated = true;
      return Object.fromEntries(
        entries.slice(0, 32).map(([k, v]) => [k, visit(v, depth + 1)]),
      );
    }
    return value;
  }
  return { value: visit(data), truncated };
}
