import type { VerificationKind } from "./verification-types.js";

const TYPESCRIPT_BUILD_INFO_PATH = "/tmp/napier-verification.tsbuildinfo";

export function verificationArgs(
  kind: VerificationKind,
  cli: string,
  target: string | undefined,
): string[] {
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
