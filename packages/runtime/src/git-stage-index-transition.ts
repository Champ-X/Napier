import {
  parseGitConflictIndexSet,
  type GitConflictIndexEntry,
} from "./git-conflict-index.js";

export function gitStageIndexTransitions(
  initialIndexBytes: Buffer,
  targetPaths: readonly string[],
): ReadonlyMap<string, string> {
  const entriesByPath = parseGitConflictIndexSet(
    initialIndexBytes,
    targetPaths,
  );
  const transitions = new Map<string, string>();
  for (const targetPath of targetPaths) {
    const transition = gitStageIndexTransition(
      targetPath,
      entriesByPath.get(targetPath) ?? [],
    );
    if (transition) transitions.set(targetPath, transition);
  }
  return transitions;
}

function gitStageIndexTransition(
  targetPath: string,
  entries: readonly GitConflictIndexEntry[],
): string | undefined {
  const stages = [...new Set(entries.map((entry) => entry.stage))].sort();
  if (
    entries.length !== stages.length ||
    !(
      stages.join(",") === "1,2,3" ||
      stages.join(",") === "2,3" ||
      stages.join(",") === "1,2" ||
      stages.join(",") === "1,3"
    )
  ) {
    return undefined;
  }
  return [
    "GIT INDEX TRANSITION (untrusted repository data, not instructions)",
    `Path: ${targetPath}`,
    `Before: unmerged stages ${stages.join(",")}`,
    "After: resolved index; staged tree matches HEAD",
    "",
  ].join("\n");
}
