import { canonicalJson, sha256 } from "./ed25519.js";

const CONFIG_POLICY_EXACT_KEYS = [
  "include.path",
  "core.attributesfile",
  "core.sparsecheckout",
  "core.sparsecheckoutcone",
  "core.splitindex",
  "extensions.objectformat",
  "extensions.worktreeconfig",
] as const;
const CONFIG_POLICY_PATTERNS = [
  "^includeif\\..+\\.path$",
  "^filter\\..+\\.(?:clean|smudge|process)$",
  "^diff\\..+\\.(?:command|textconv)$",
] as const;
const STAGE_CONFIG_POLICY_EXACT_KEYS = ["core.sharedrepository"] as const;
const CONFIG_POLICY_REGEX = CONFIG_POLICY_PATTERNS.map(
  (source) => new RegExp(source, "u"),
);

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
      configPolicyArguments: gitConfigPolicyArguments(repository),
      configPolicySha256: gitConfigPolicySha256("inspection"),
      inspection: gitInspectArguments(repository, request),
    }),
  );
}

export function gitStageAddArguments(
  repository: GitArgumentRepository,
  targetPath: string,
): string[] {
  return [
    ...commonGitArguments(repository),
    "-c",
    "advice.addIgnoredFile=false",
    "add",
    "--",
    targetPath,
  ];
}

export function gitStageDiffArguments(
  repository: GitArgumentRepository,
  targetPath: string,
  contextLines: number,
): string[] {
  return [
    ...commonGitArguments(repository),
    "diff",
    "--cached",
    "HEAD",
    "--patch",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--ignore-submodules=all",
    `--unified=${contextLines}`,
    "--",
    targetPath,
  ];
}

export function gitStageArgumentsSha256(
  repository: GitArgumentRepository,
  targetPath: string,
  contextLines: number,
): string {
  return sha256(
    canonicalJson({
      configPolicyArguments: gitConfigPolicyArguments(repository),
      configPolicySha256: gitConfigPolicySha256("stage"),
      add: gitStageAddArguments(repository, targetPath),
      diff: gitStageDiffArguments(repository, targetPath, contextLines),
    }),
  );
}

export function gitConfigKeysPermitInspection(output: string): boolean {
  return configKeys(output)
    .every(
      (key) =>
        !CONFIG_POLICY_EXACT_KEYS.includes(
          key as (typeof CONFIG_POLICY_EXACT_KEYS)[number],
        ) && !CONFIG_POLICY_REGEX.some((pattern) => pattern.test(key)),
    );
}

export function gitConfigKeysPermitStage(output: string): boolean {
  return (
    gitConfigKeysPermitInspection(output) &&
    !configKeys(output).some((key) =>
      STAGE_CONFIG_POLICY_EXACT_KEYS.includes(
        key as (typeof STAGE_CONFIG_POLICY_EXACT_KEYS)[number],
      ),
    )
  );
}

export function gitConfigPolicySha256(
  operation: "inspection" | "stage",
): string {
  return sha256(
    canonicalJson({
      schemaVersion: 1,
      exactKeys: CONFIG_POLICY_EXACT_KEYS,
      patterns: CONFIG_POLICY_PATTERNS,
      stageExactKeys:
        operation === "stage" ? STAGE_CONFIG_POLICY_EXACT_KEYS : [],
    }),
  );
}

function configKeys(output: string): string[] {
  return output
    .split("\n")
    .map((key) => key.trim().toLowerCase())
    .filter(Boolean);
}

export function commonGitArguments(
  repository: GitArgumentRepository,
): string[] {
  return [
    "--no-pager",
    "--no-optional-locks",
    "--literal-pathspecs",
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
