import { randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";

import type { BrowserRuntimeBinding } from "./browser-session-model.js";
import { sha256File } from "./command-execution.js";
import { canonicalJson, sha256 } from "./ed25519.js";

const MARKER_FILE = ".napier-browser-runtime.json";
const MAX_MARKER_BYTES = 4 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;

interface PinnedBrowserRuntimeVerification {
  kind: "napier.pinned-browser-runtime";
  schemaVersion: 1;
  packageName: "playwright-core";
  packageVersion: string;
  browserName: "chromium";
  browserRevision: string;
  browserVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  runtimeLocationSha256: string;
  executableSha256: string;
  contentSha256: string;
}

interface PinnedBrowserRuntimeTarget {
  packageName: "playwright-core";
  packageVersion: string;
  browserName: "chromium";
  browserRevision: string;
  browserVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  runtimeLocationSha256: string;
}

export async function markPinnedBrowserRuntimeVerified(input: {
  target: PinnedBrowserRuntimeTarget;
  runtime: BrowserRuntimeBinding;
}): Promise<void> {
  const executablePath = await realpath(input.runtime.executablePath);
  const info = await lstat(executablePath);
  if (!info.isFile() || executablePath !== input.runtime.executablePath) {
    throw new Error("Pinned Browser runtime executable is invalid");
  }
  const executableSha256 = await sha256File(executablePath);
  if (
    executableSha256 !== input.runtime.executableSha256 ||
    sha256(executablePath) !== input.target.runtimeLocationSha256
  ) {
    throw new Error(
      "Pinned Browser runtime identity changed after verification",
    );
  }
  const markerPath = await verificationMarkerPath(
    executablePath,
    input.target.browserRevision,
  );
  const withoutHash = {
    kind: "napier.pinned-browser-runtime" as const,
    schemaVersion: 1 as const,
    packageName: input.target.packageName,
    packageVersion: input.target.packageVersion,
    browserName: input.target.browserName,
    browserRevision: input.target.browserRevision,
    browserVersion: input.target.browserVersion,
    platform: input.target.platform,
    arch: input.target.arch,
    runtimeLocationSha256: input.target.runtimeLocationSha256,
    executableSha256,
  };
  const marker: PinnedBrowserRuntimeVerification = {
    ...withoutHash,
    contentSha256: sha256(canonicalJson(withoutHash)),
  };
  await writeMarker(markerPath, `${canonicalJson(marker)}\n`);
}

export async function verifiedPinnedBrowserRuntimeCandidate(
  executablePath: string,
): Promise<string | undefined> {
  try {
    const canonicalPath = await realpath(executablePath);
    const markerPath = await verificationMarkerPath(canonicalPath);
    const markerInfo = await lstat(markerPath);
    if (
      !markerInfo.isFile() ||
      markerInfo.size <= 0 ||
      markerInfo.size > MAX_MARKER_BYTES
    ) {
      return undefined;
    }
    const marker = validateMarker(
      JSON.parse(await readFile(markerPath, "utf8")) as unknown,
    );
    if (
      marker.platform !== process.platform ||
      marker.arch !== process.arch ||
      marker.runtimeLocationSha256 !== sha256(canonicalPath) ||
      marker.executableSha256 !== (await sha256File(canonicalPath))
    ) {
      return undefined;
    }
    await verificationMarkerPath(canonicalPath, marker.browserRevision);
    return canonicalPath;
  } catch {
    return undefined;
  }
}

async function verificationMarkerPath(
  executablePath: string,
  expectedRevision?: string,
): Promise<string> {
  let current = path.dirname(path.resolve(executablePath));
  for (;;) {
    const match = /^chromium-([0-9]{1,12})$/u.exec(path.basename(current));
    if (match) {
      if (expectedRevision && match[1] !== expectedRevision) {
        throw new Error("Pinned Browser runtime revision path mismatch");
      }
      const info = await lstat(current);
      if (!info.isDirectory()) {
        throw new Error("Pinned Browser runtime directory is invalid");
      }
      return path.join(current, MARKER_FILE);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error("Pinned Browser runtime directory is unavailable");
}

async function writeMarker(markerPath: string, content: string): Promise<void> {
  const temporaryPath = `${markerPath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, markerPath);
    await chmod(markerPath, 0o600);
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function validateMarker(value: unknown): PinnedBrowserRuntimeVerification {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pinned Browser runtime marker is invalid");
  }
  const marker = value as Record<string, unknown>;
  const keys = [
    "arch",
    "browserName",
    "browserRevision",
    "browserVersion",
    "contentSha256",
    "executableSha256",
    "kind",
    "packageName",
    "packageVersion",
    "platform",
    "runtimeLocationSha256",
    "schemaVersion",
  ].sort();
  if (canonicalJson(Object.keys(marker).sort()) !== canonicalJson(keys)) {
    throw new Error("Pinned Browser runtime marker shape is invalid");
  }
  if (
    marker["kind"] !== "napier.pinned-browser-runtime" ||
    marker["schemaVersion"] !== 1 ||
    marker["packageName"] !== "playwright-core" ||
    marker["browserName"] !== "chromium" ||
    !version(marker["packageVersion"]) ||
    !digits(marker["browserRevision"]) ||
    !version(marker["browserVersion"]) ||
    typeof marker["platform"] !== "string" ||
    typeof marker["arch"] !== "string" ||
    !SHA256.test(String(marker["runtimeLocationSha256"])) ||
    !SHA256.test(String(marker["executableSha256"])) ||
    !SHA256.test(String(marker["contentSha256"]))
  ) {
    throw new Error("Pinned Browser runtime marker content is invalid");
  }
  const { contentSha256, ...withoutHash } = marker;
  if (contentSha256 !== sha256(canonicalJson(withoutHash))) {
    throw new Error("Pinned Browser runtime marker hash mismatch");
  }
  return marker as unknown as PinnedBrowserRuntimeVerification;
}

function digits(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{1,12}$/u.test(value);
}

function version(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9]+(?:\.[0-9]+){1,3}(?:[-+][A-Za-z0-9.-]+)?$/u.test(value)
  );
}
