import type { LspRenameCommitOutcome } from "./lsp-rename-commit.js";
import type { LspWorkspaceEditSourceVerificationAdapter } from "./lsp-workspace-edit-mutation.js";
import type { SubagentWorktreeChange } from "./subagent-worktree-diff.js";
import type {
  SubagentWorktreeLifecycleDiagnosticsAdapter,
  SubagentWorktreeLifecycleDiagnosticsObservation,
  SubagentWorktreeLifecycleDiagnosticsState,
} from "./subagent-worktree-lifecycle-diagnostics.js";
import type {
  WriteLinkedLifecycleBeforeState,
  WriteLinkedLifecycleFile,
} from "./write-linked-test-lifecycle.js";
import type {
  WriteLinkedTestVerification,
  WriteLinkedTestVerificationRunner,
} from "./write-linked-test-verification.js";

export interface SubagentWorktreeApplyVerificationSource {
  changes: SubagentWorktreeChange[];
}

export interface SubagentWorktreeApplyVerificationState {
  diagnostics: SubagentWorktreeLifecycleDiagnosticsState;
  testFiles: WriteLinkedLifecycleFile[];
  tests?: WriteLinkedLifecycleBeforeState;
}

export type SubagentWorktreeLifecycleTestRunner = Pick<
  WriteLinkedTestVerificationRunner,
  "supports" | "captureLifecycleBefore" | "runLifecycle"
>;

export function createSubagentWorktreeApplyVerification<
  Source extends SubagentWorktreeApplyVerificationSource,
>(input: {
  diagnostics: SubagentWorktreeLifecycleDiagnosticsAdapter;
  tests?: SubagentWorktreeLifecycleTestRunner;
}): LspWorkspaceEditSourceVerificationAdapter<
  Source,
  SubagentWorktreeApplyVerificationState,
  SubagentWorktreeLifecycleDiagnosticsObservation
> {
  return {
    async observeBefore(source, signal) {
      const diagnostics = await input.diagnostics.observeBefore(
        source.changes,
        signal,
      );
      const testFiles = input.tests
        ? lifecycleTestFiles(
            source.changes,
            input.tests.supports.bind(input.tests),
          )
        : [];
      const tests =
        input.tests && testFiles.length > 0
          ? await input.tests.captureLifecycleBefore(testFiles)
          : undefined;
      return {
        diagnostics,
        testFiles,
        ...(tests ? { tests } : {}),
      };
    },
    async observeAfter(state, source, outcome, signal) {
      let diagnostics: SubagentWorktreeLifecycleDiagnosticsObservation;
      try {
        diagnostics = await input.diagnostics.observeAfter(
          state.diagnostics,
          signal,
        );
      } catch (error) {
        diagnostics = input.diagnostics.unavailable(state.diagnostics, error);
      }
      const tests = await observeLifecycleTests(
        input.tests,
        state,
        source,
        outcome,
        signal,
      );
      return {
        diagnostics,
        ...(tests ? { tests } : {}),
      };
    },
  };
}

async function observeLifecycleTests(
  runner: SubagentWorktreeLifecycleTestRunner | undefined,
  state: SubagentWorktreeApplyVerificationState,
  source: SubagentWorktreeApplyVerificationSource,
  outcome: LspRenameCommitOutcome,
  signal?: AbortSignal,
): Promise<WriteLinkedTestVerification | undefined> {
  if (
    !runner ||
    !state.tests ||
    state.testFiles.length === 0 ||
    outcome.postcondition !== "verified"
  ) {
    return undefined;
  }
  const current = lifecycleTestFiles(
    source.changes,
    runner.supports.bind(runner),
  );
  return runner.runLifecycle(current, state.tests, signal);
}

function lifecycleTestFiles(
  changes: SubagentWorktreeChange[],
  supports: (candidate: string) => boolean,
): WriteLinkedLifecycleFile[] {
  return changes
    .filter((change) => supports(change.path))
    .map((change) => ({
      path: change.path,
      pathSha256: change.pathSha256,
      beforeSha256: change.beforeSha256,
      afterSha256: change.afterSha256,
    }));
}
