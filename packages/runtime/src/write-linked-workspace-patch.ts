import type {
  WorkspacePatchObservation,
  WorkspacePatchObservationState,
  WorkspacePatchObserver,
} from "./workspace-patch-tool.js";
import { unavailableWorkspacePatchObservation } from "./workspace-patch-tool.js";
import type {
  WriteLinkedTestBeforeState,
  WriteLinkedChangedFile,
} from "./write-linked-test-selection.js";
import type { WriteLinkedTestVerificationRunner } from "./write-linked-test-verification.js";

interface CombinedBeforeState {
  diagnostics?: WorkspacePatchObservationState;
  tests?: WriteLinkedTestBeforeState;
}

export class WriteLinkedWorkspacePatchObserver implements WorkspacePatchObserver {
  constructor(
    private readonly options: {
      diagnostics?: WorkspacePatchObserver;
      tests?: Pick<
        WriteLinkedTestVerificationRunner,
        "supports" | "captureBefore" | "run"
      >;
    },
  ) {}

  supports(candidate: string): boolean {
    return (
      this.options.diagnostics?.supports(candidate) === true ||
      this.options.tests?.supports(candidate) === true
    );
  }

  async observeBefore(input: {
    path: string;
    expectedSha256: string;
    signal?: AbortSignal;
  }): Promise<WorkspacePatchObservationState> {
    const diagnostics =
      this.options.diagnostics?.supports(input.path) === true
        ? await this.options.diagnostics.observeBefore(input)
        : undefined;
    const tests =
      this.options.tests?.supports(input.path) === true
        ? await this.options.tests.captureBefore([changedFile(input)])
        : undefined;
    return {
      fileSha256: diagnostics?.fileSha256 ?? input.expectedSha256,
      opaque: {
        ...(diagnostics ? { diagnostics } : {}),
        ...(tests ? { tests } : {}),
      } satisfies CombinedBeforeState,
    };
  }

  async observeAfter(input: {
    path: string;
    expectedSha256: string;
    before?: WorkspacePatchObservationState;
    signal?: AbortSignal;
  }): Promise<WorkspacePatchObservation> {
    const before = input.before ? combinedState(input.before) : undefined;
    const diagnostics = await this.observeDiagnosticsAfter(input, before);
    const tests =
      this.options.tests?.supports(input.path) === true
        ? await this.options.tests.run(
            [changedFile(input)],
            before?.tests,
            input.signal,
          )
        : undefined;
    return {
      summary: [diagnostics?.summary, tests?.summary]
        .filter((value): value is string => Boolean(value))
        .join("\n\n"),
      ...(diagnostics?.details ? { details: diagnostics.details } : {}),
      ...(tests ? { tests: tests.details } : {}),
    };
  }

  private async observeDiagnosticsAfter(
    input: {
      path: string;
      expectedSha256: string;
      signal?: AbortSignal;
    },
    before: CombinedBeforeState | undefined,
  ): Promise<WorkspacePatchObservation | undefined> {
    if (this.options.diagnostics?.supports(input.path) !== true) {
      return undefined;
    }
    const startedAt = Date.now();
    try {
      return await this.options.diagnostics.observeAfter({
        ...input,
        ...(before?.diagnostics ? { before: before.diagnostics } : {}),
      });
    } catch (error) {
      return unavailableWorkspacePatchObservation(
        input.expectedSha256,
        error,
        Math.max(0, Date.now() - startedAt),
      );
    }
  }
}

function changedFile(input: {
  path: string;
  expectedSha256: string;
}): WriteLinkedChangedFile {
  return {
    path: input.path,
    expectedSha256: input.expectedSha256,
  };
}

function combinedState(
  state: WorkspacePatchObservationState,
): CombinedBeforeState {
  if (!state.opaque || typeof state.opaque !== "object") {
    throw new Error("Write-linked patch observation state is invalid");
  }
  return state.opaque as CombinedBeforeState;
}
