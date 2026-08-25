import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const DEFAULT_LEDGER_PATH = "docs/compatibility-ledger.json";
const REQUIRED_ENTRY_IDS = [
  "contracts-v1",
  "conversation-surface-legacy",
  "store-json-jsonl-projections",
  "agent-capability-legacy-binding",
  "project-legacy-skill-root",
  "workflow-terminal-without-plan-revision",
  "compiled-prompt-model-receipts",
  "inbound-auth-legacy-bearer",
];
const REQUIRED_FIELDS = [
  "id",
  "compatibilityMode",
  "owner",
  "introducedVersion",
  "lastWriteVersion",
  "minimumReadableVersion",
  "readHitMetric",
  "sourceReaders",
  "migrationCommand",
  "fixtures",
  "plannedRemovalVersion",
  "zeroHitReleaseWindows",
  "rollbackPlan",
];

export async function auditCompatibilityLedger(repoRoot = defaultRepoRoot) {
  const errors = [];
  const ledger = await readJson(
    path.join(repoRoot, DEFAULT_LEDGER_PATH),
    "Compatibility Ledger",
    errors,
  );
  if (!record(ledger)) {
    return { ok: false, errors, entryCount: 0, metricCount: 0 };
  }
  if (ledger.kind !== "napier.compatibility-ledger") {
    errors.push("Compatibility Ledger kind is invalid");
  }
  if (ledger.schemaVersion !== 1) {
    errors.push("Compatibility Ledger schemaVersion is invalid");
  }
  const policy = record(ledger.policy) ? ledger.policy : {};
  if (policy.zeroHitReleaseWindowsRequired !== 2) {
    errors.push(
      "Compatibility Ledger must require two zero-hit release windows",
    );
  }
  if (policy.telemetryPrivacy !== "fixed_id_count_only") {
    errors.push("Compatibility Ledger telemetry privacy policy is invalid");
  }
  const entries = Array.isArray(ledger.entries) ? ledger.entries : [];
  if (entries.length !== REQUIRED_ENTRY_IDS.length) {
    errors.push(
      "Compatibility Ledger must contain " +
        String(REQUIRED_ENTRY_IDS.length) +
        " entries",
    );
  }
  const ids = new Set();
  const metrics = new Set();
  for (const raw of entries) {
    if (!record(raw)) {
      errors.push("Compatibility Ledger entry must be an object");
      continue;
    }
    const label = typeof raw.id === "string" ? raw.id : "<unknown>";
    for (const field of REQUIRED_FIELDS) {
      if (!(field in raw)) errors.push(label + " is missing " + field);
    }
    if (ids.has(label)) errors.push(label + " is duplicated");
    ids.add(label);
    if (typeof raw.owner !== "string" || raw.owner.trim() === "") {
      errors.push(label + " has no owner");
    }
    if (
      typeof raw.migrationCommand !== "string" ||
      raw.migrationCommand.trim() === ""
    ) {
      errors.push(label + " has no migration command");
    }
    if (
      typeof raw.rollbackPlan !== "string" ||
      raw.rollbackPlan.trim() === ""
    ) {
      errors.push(label + " has no rollback plan");
    }
    if (
      typeof raw.plannedRemovalVersion !== "string" ||
      raw.plannedRemovalVersion.trim() === ""
    ) {
      errors.push(label + " has no planned removal version");
    }
    if (!Array.isArray(raw.zeroHitReleaseWindows)) {
      errors.push(label + " has no zero-hit release window list");
    }
    await validatePaths(
      repoRoot,
      label,
      "source reader",
      raw.sourceReaders,
      errors,
    );
    await validatePaths(repoRoot, label, "fixture", raw.fixtures, errors);
    const readHitMetric = record(raw.readHitMetric) ? raw.readHitMetric : {};
    if (readHitMetric.mode === "counter") {
      if (
        typeof readHitMetric.metricId !== "string" ||
        !/^compat\.[a-z0-9_.]+$/u.test(readHitMetric.metricId)
      ) {
        errors.push(label + " has an invalid read-hit metric");
      } else {
        metrics.add(readHitMetric.metricId);
      }
    } else if (
      readHitMetric.mode !== "not_applicable_active_format" ||
      readHitMetric.metricId !== null ||
      raw.compatibilityMode !== "active_format"
    ) {
      errors.push(label + " has an invalid active-format metric exemption");
    }
    if (typeof raw.writeHitMetric === "string") {
      metrics.add(raw.writeHitMetric);
    }
  }
  for (const id of REQUIRED_ENTRY_IDS) {
    if (!ids.has(id)) errors.push("Compatibility Ledger is missing " + id);
  }
  await validateTelemetryIds(repoRoot, metrics, errors);
  await validateFixtureManifest(repoRoot, errors);
  return {
    ok: errors.length === 0,
    errors,
    entryCount: entries.length,
    metricCount: metrics.size,
  };
}

async function validatePaths(repoRoot, label, kind, values, errors) {
  if (!Array.isArray(values) || values.length === 0) {
    errors.push(label + " has no " + kind + " paths");
    return;
  }
  for (const value of values) {
    if (
      typeof value !== "string" ||
      path.isAbsolute(value) ||
      value.includes("..")
    ) {
      errors.push(label + " has an invalid " + kind + " path");
      continue;
    }
    await readFile(path.join(repoRoot, value)).catch(() => {
      errors.push(label + " " + kind + " does not exist: " + value);
    });
  }
}

async function validateTelemetryIds(repoRoot, expected, errors) {
  const source = await readFile(
    path.join(repoRoot, "packages/runtime/src/compatibility-telemetry.ts"),
    "utf8",
  );
  const declared = new Set(
    [...source.matchAll(/^  "(compat\.[a-z0-9_.]+)",$/gmu)].map(
      (match) => match[1],
    ),
  );
  for (const id of expected) {
    if (!declared.has(id)) errors.push("Telemetry id is not declared: " + id);
  }
  for (const id of declared) {
    if (!expected.has(id))
      errors.push("Telemetry id is not ledger-owned: " + id);
  }
  const productionRoots = ["packages/runtime/src", "apps/server/src"];
  for (const id of expected) {
    let occurrences = 0;
    for (const root of productionRoots) {
      occurrences += await treeOccurrences(path.join(repoRoot, root), id);
    }
    if (occurrences < 2) {
      errors.push("Telemetry id has no production hit site: " + id);
    }
  }
}

async function treeOccurrences(root, text) {
  let occurrences = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      occurrences += await treeOccurrences(target, text);
    } else if (entry.isFile() && /\.(?:ts|tsx)$/u.test(entry.name)) {
      occurrences += (await readFile(target, "utf8")).split(text).length - 1;
    }
  }
  return occurrences;
}

async function validateFixtureManifest(repoRoot, errors) {
  const root = path.join(
    repoRoot,
    "packages/runtime/test/fixtures/compatibility-v1",
  );
  const manifest = await readJson(
    path.join(root, "manifest.json"),
    "compatibility fixture manifest",
    errors,
  );
  if (!record(manifest) || !Array.isArray(manifest.fixtures)) return;
  for (const fixture of manifest.fixtures) {
    if (!record(fixture) || typeof fixture.path !== "string") {
      errors.push("Compatibility fixture manifest contains an invalid entry");
      continue;
    }
    const target = path.resolve(root, fixture.path);
    if (!target.startsWith(path.dirname(root) + path.sep)) {
      errors.push(
        "Compatibility fixture escapes the fixture root: " + fixture.path,
      );
      continue;
    }
    const content = await readFile(target).catch(() => undefined);
    if (!content) {
      errors.push("Compatibility fixture does not exist: " + fixture.path);
      continue;
    }
    if (
      typeof fixture.sha256 === "string" &&
      sha256(content) !== fixture.sha256
    ) {
      errors.push("Compatibility fixture hash mismatch: " + fixture.path);
    }
    if (!/^[a-f0-9]{40}$/u.test(String(fixture.sourceCommit))) {
      errors.push(
        "Compatibility fixture has no source commit: " + fixture.path,
      );
    }
  }
}

async function readJson(filePath, label, errors) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    errors.push(label + " is not valid JSON");
    return undefined;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function main() {
  const result = await auditCompatibilityLedger();
  if (!result.ok) {
    console.error(
      "Compatibility Ledger audit failed:\n- " + result.errors.join("\n- "),
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    "Compatibility Ledger audit passed: " +
      String(result.entryCount) +
      " entries, " +
      String(result.metricCount) +
      " fixed metrics",
  );
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) await main();
