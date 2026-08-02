import { canonicalJson, sha256 } from "./ed25519.js";

export interface GitArgumentRepository {
  root: string;
  gitDirectory: string;
}

export type GitArgumentRequest =
  | { action: "status" }
  | {
      action: "diff";
      scope: "working" | "staged";
      path?: string;
      contextLines?: number;
    };

export function gitConfigPolicyArguments(
  repository: GitArgumentRepository,
): string[] {
  return [
    ...commonGitArguments(repository),
    "config",
    "--local",
    "--no-includes",
    "--name-only",
    "--list",
  ];
}

export function gitInspectArguments(
  repository: GitArgumentRepository,
  request: GitArgumentRequest,
): string[] {
  const common = commonGitArguments(repository);
  if (request.action === "status") {
    return [
      ...common,
      "status",
      "--porcelain=v2",
      "--branch",
      "--untracked-files=all",
      "--ignore-submodules=all",
    ];
  }
  return [
    ...common,
    "diff",
    ...(request.scope === "staged" ? ["--cached"] : []),
    "--patch",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--ignore-submodules=all",
    `--unified=${request.contextLines ?? 3}`,
    "--",
    ...(request.path ? [request.path] : []),
  ];
}

export function gitInspectionArgumentsSha256(
  repository: GitArgumentRepository,
  request: GitArgumentRequest,
): string {
  return sha256(
    canonicalJson({
      configPolicy: gitConfigPolicyArguments(repository),
      inspection: gitInspectArguments(repository, request),
    }),
  );
}

export function gitConfigKeysPermitInspection(output: string): boolean {
  return output
    .split("\n")
    .map((key) => key.trim().toLowerCase())
    .filter(Boolean)
    .every(
      (key) =>
        key !== "include.path" &&
        !(key.startsWith("includeif.") && key.endsWith(".path")) &&
        !/^filter\..+\.(?:clean|smudge|process)$/u.test(key) &&
        !/^diff\..+\.(?:command|textconv)$/u.test(key) &&
        key !== "core.attributesfile" &&
        key !== "core.sparsecheckout" &&
        key !== "core.sparsecheckoutcone" &&
        key !== "core.splitindex" &&
        key !== "extensions.worktreeconfig",
    );
}

function commonGitArguments(repository: GitArgumentRepository): string[] {
  return [
    "--no-pager",
    "--no-optional-locks",
    `--git-dir=${repository.gitDirectory}`,
    `--work-tree=${repository.root}`,
    "-c",
    "color.ui=false",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "diff.algorithm=myers",
    "-c",
    "diff.renames=false",
  ];
}
