export function parseCliOptions(
  argv: string[],
  allowedValues: ReadonlySet<string>,
  allowedFlags: ReadonlySet<string> = new Set(),
): {
  values: Map<string, string>;
  flags: Set<string>;
  jsonl: boolean;
} {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  let jsonl = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (flag === "--jsonl") {
      if (jsonl) throw new Error("Duplicate option: --jsonl");
      jsonl = true;
      continue;
    }
    if (allowedFlags.has(flag)) {
      if (flags.has(flag)) throw new Error(`Duplicate option: ${flag}`);
      flags.add(flag);
      continue;
    }
    if (!allowedValues.has(flag)) throw new Error("Unknown option");
    if (values.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    values.set(flag, value);
    index += 1;
  }
  return { values, flags, jsonl };
}

export function parsePositiveInteger(value: string, flag: string): number {
  if (!/^[0-9]+$/u.test(value)) throw new Error(`${flag} is invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

export function parseNonNegativeInteger(value: string, flag: string): number {
  if (!/^[0-9]+$/u.test(value)) throw new Error(`${flag} is invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return parsed;
}
