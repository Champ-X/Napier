import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

/** macOS maintenance wakes can run a dispatcher briefly before suspending its
 * Run lease and network socket. Admit paid work only after a full wake. */
export function hostAwakeEvidence(platform, powerLog, observedAt = Date.now()) {
  const transitions =
    platform === "darwin"
      ? [
          ...powerLog.matchAll(
            /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{4})[ \t]+(Sleep|Wake|DarkWake)[ \t]{2,}(.*)$/gm,
          ),
        ].map((match) => ({
          at: match[1],
          state: match[2],
          detail: match[3].trim(),
        }))
      : [];
  const lastTransition = transitions.at(-1) ?? null;
  const eligible = platform !== "darwin" || lastTransition?.state === "Wake";
  const content = {
    kind: "napier.harness-host-awake",
    schemaVersion: 1,
    platform,
    observedAt,
    lastTransition,
    eligible,
    reason:
      platform !== "darwin"
        ? "not_applicable"
        : eligible
          ? "full_wake"
          : lastTransition
            ? "host_sleep_or_maintenance_wake"
            : "power_state_unknown",
  };
  return {
    ...content,
    contentSha256: createHash("sha256")
      .update(JSON.stringify(content))
      .digest("hex"),
  };
}

export function readHostAwakeEvidence() {
  if (process.platform !== "darwin")
    return hostAwakeEvidence(process.platform, "");
  const result = spawnSync("/usr/bin/pmset", ["-g", "log"], {
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return hostAwakeEvidence(
    "darwin",
    result.status === 0 && !result.error ? result.stdout : "",
  );
}

export function requireHostAwake(evidence) {
  if (!evidence.eligible)
    throw new Error(
      `Paid Harness preflight refused: ${evidence.reason}; wake the host fully before resuming. No provider request was sent.`,
    );
}

/** Scoped to this dispatcher; does not change pmset preferences or wake a
 * sleeping/closed machine. Explicit lid sleep remains under the user's control. */
export async function holdHarnessHostAwake(evidence) {
  requireHostAwake(evidence);
  if (evidence.platform !== "darwin") return { release() {} };
  const child = spawn(
    "/usr/bin/caffeinate",
    ["-i", "-s", "-w", String(process.pid)],
    { stdio: "ignore" },
  );
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  const release = () => {
    if (child.exitCode === null) child.kill();
  };
  process.once("exit", release);
  return {
    release() {
      process.removeListener("exit", release);
      release();
    },
  };
}
