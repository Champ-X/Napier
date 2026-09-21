import { canonicalJson, sha256 } from "./ed25519.js";
import { LocalPrivateCapsuleStore } from "./local-private-capsule-store.js";
import {
  excludedRunInputPath,
  RUN_INPUT_LIMITS,
  validRunInputPath,
  type RunInputWorkspace,
} from "./run-input-workspace.js";

export interface RunInputCapsule extends RunInputWorkspace {
  kind: "napier.run-input-capsule";
  schemaVersion: 1;
  threadId: string;
  runId: string;
  workspaceRootSha256: string;
  configurationSha256: string;
  promptSha256: string;
  startedAt: string;
  capturedAt: string;
  contentSha256: string;
}

export function runInputCapsuleStore(
  dataRoot: string,
): LocalPrivateCapsuleStore<RunInputCapsule> {
  return new LocalPrivateCapsuleStore({
    dataRoot,
    directory: "run-inputs",
    label: "Run input",
    maxObjectBytes: 24 * 1024 * 1024,
    maxObjects: 128,
    maxStorageBytes: 128 * 1024 * 1024,
    parse: (text) => validateRunInputCapsule(JSON.parse(text)),
    contentSha256: (value) => value.contentSha256,
  });
}

export function validateRunInputCapsule(input: unknown): RunInputCapsule {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid();
  const value = input as RunInputCapsule;
  validateHeader(value);
  validatePaths(value);
  validateFiles(value);
  return structuredClone(value);
}

const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);

function validateHeader(value: RunInputCapsule): void {
  const { contentSha256, ...content } = value;
  if (
    value.kind !== "napier.run-input-capsule" ||
    value.schemaVersion !== 1 ||
    !/^run_[a-z0-9_-]{8,80}$/u.test(value.runId) ||
    !/^thread_[a-z0-9]{8,80}$/u.test(value.threadId) ||
    ![
      value.workspaceRootSha256,
      value.configurationSha256,
      value.promptSha256,
      contentSha256,
    ].every(hash) ||
    !Number.isFinite(Date.parse(value.startedAt)) ||
    !Number.isFinite(Date.parse(value.capturedAt)) ||
    !Array.isArray(value.files) ||
    !Array.isArray(value.directories) ||
    !Array.isArray(value.omissions) ||
    value.files.length + value.directories.length + value.omissions.length >
      RUN_INPUT_LIMITS.files + 2 ||
    sha256(canonicalJson(content)) !== contentSha256
  )
    invalid();
}

function validatePaths(value: RunInputCapsule): void {
  const paths = new Set<string>();
  for (const relative of [
    ...value.directories.map((directory) => directory.path),
    ...value.files.map((file) => file.path),
  ]) {
    if (
      !validRunInputPath(relative) ||
      excludedRunInputPath(relative) ||
      paths.has(relative)
    )
      invalid();
    paths.add(relative);
  }
  const files = new Set(value.files.map((file) => file.path));
  if (
    value.directories.some(
      (directory) =>
        !Number.isSafeInteger(directory.mode) ||
        directory.mode < 0 ||
        directory.mode > 0o777,
    )
  )
    invalid();
  for (const relative of paths) {
    const parts = relative.split("/");
    while (parts.length > 1) {
      parts.pop();
      if (files.has(parts.join("/"))) invalid();
    }
  }
}

function validateFiles(value: RunInputCapsule): void {
  let bytes = 0;
  for (const file of value.files) {
    if (
      typeof file.data !== "string" ||
      !hash(file.sha256) ||
      !Number.isSafeInteger(file.mode) ||
      file.mode < 0 ||
      file.mode > 0o777
    )
      invalid();
    const data = Buffer.from(file.data, "base64");
    bytes += data.length;
    if (data.toString("base64") !== file.data || sha256(data) !== file.sha256)
      invalid();
  }
  if (
    bytes !== value.bytes ||
    bytes > RUN_INPUT_LIMITS.bytes ||
    value.omissions.some(
      (item) =>
        !hash(item.pathSha256) ||
        ![
          "excluded",
          "unsupported_entry",
          "entry_limit",
          "byte_limit",
          "path_changed",
          "file_changed",
          "workspace_changed_during_capture",
        ].includes(item.reason),
    )
  )
    invalid();
}

function invalid(): never {
  throw new Error("Invalid Run input capsule");
}
