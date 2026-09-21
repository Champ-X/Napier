import type { VerificationKind } from "./verification-types.js";

const TYPESCRIPT_BUILD_INFO_PATH = "/tmp/napier-verification.tsbuildinfo";

export function verificationArgs(
  kind: VerificationKind,
  cli: string,
  target: string | undefined,
  nativeTargets?: string[],
): string[] {
  if (kind === "test" && nativeTargets)
    return [
      "--test",
      "--test-concurrency=2",
      "--test-reporter=tap",
      "--",
      ...nativeTargets,
    ];
  if (kind === "typecheck") {
    if (!target) throw new Error("typecheck requires a tsconfig target");
    return [
      cli,
      "-p",
      target,
      "--noEmit",
      "--pretty",
      "false",
      "--tsBuildInfoFile",
      TYPESCRIPT_BUILD_INFO_PATH,
    ];
  }
  if (kind === "test") {
    return [
      cli,
      "run",
      "--pool=threads",
      "--maxWorkers=2",
      ...(target ? [target] : []),
    ];
  }
  return [cli, "--check", target ?? "."];
}
