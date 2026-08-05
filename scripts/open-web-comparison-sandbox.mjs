import { access, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

export async function createOmpComparisonSandbox(input) {
  if (process.platform !== "darwin") {
    throw new Error("OMP open-web comparison requires macOS sandbox-exec");
  }
  for (const required of [SANDBOX_EXEC, input.bunExecutable, input.ompEntry]) {
    await access(required);
  }
  const profilePath = path.join(input.trialRoot, "omp-comparison.sb");
  const profile = buildOmpComparisonSandboxProfile(input);
  await writeFile(profilePath, `${profile}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return {
    command: SANDBOX_EXEC,
    args: [
      "-f",
      profilePath,
      "--",
      input.bunExecutable,
      input.ompEntry,
      ...input.ompArgs,
    ],
    profileSha256Input: profile,
    sandboxId: "macos-sandbox-exec-guarded",
  };
}

export function buildOmpComparisonSandboxProfile(input) {
  assertWithin(input.trialRoot, input.workspaceRoot);
  assertWithin(input.trialRoot, input.homeRoot);
  const userHome = path.resolve(homedir());
  const trialRootAlias = privateVarAlias(input.trialRoot);
  return [
    "(version 1)",
    "(allow default)",
    `(deny file-read-data (require-all (subpath ${literal(userHome)}) (require-not (literal ${literal(input.bunExecutable)}))))`,
    `(deny file-read-data (subpath ${literal("/Volumes")}))`,
    `(deny file-write* (require-not (require-any (subpath ${literal(input.trialRoot)}) (subpath ${literal(trialRootAlias)}))))`,
    `(deny process-exec (require-not (literal ${literal(input.bunExecutable)})))`,
    `(deny network-outbound (require-not (require-any ${loopbackRemoteFilters([
      input.modelProxyPort,
      input.publicProxyPort,
      input.cdpPort,
    ]).join(" ")})))`,
    "(deny network-bind)",
    "(deny network-inbound)",
  ].join("\n");
}

function loopbackRemoteFilters(ports) {
  if (
    ports.some(
      (port) =>
        !Number.isSafeInteger(port) ||
        Number(port) < 1 ||
        Number(port) > 65_535,
    )
  ) {
    throw new Error("Comparison sandbox network port is invalid");
  }
  return ports.map((port) => `(remote ip "localhost:${String(port)}")`);
}

function assertWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (
    relative === "" ||
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Comparison sandbox path escapes the trial root");
  }
}

function literal(value) {
  return JSON.stringify(path.resolve(value));
}

function privateVarAlias(value) {
  const resolved = path.resolve(value);
  return resolved.startsWith("/private/var/")
    ? resolved.slice("/private".length)
    : resolved;
}
