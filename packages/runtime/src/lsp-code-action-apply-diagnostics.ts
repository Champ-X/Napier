import type { LspCodeActionApplyDiagnosticsDetails } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  LspRenameApplyDiagnostics,
  type LspRenameDiagnosticsObservation,
  type LspRenameDiagnosticsState,
  unavailableLspRenameDiagnostics,
} from "./lsp-rename-apply-diagnostics.js";
import type { LspRenameCommitExpectedFile } from "./lsp-rename-commit.js";
import type { LspRenameFile } from "./lsp-rename-workspace-edit.js";

export interface LspCodeActionApplyDiagnosticsObservation {
  details: LspCodeActionApplyDiagnosticsDetails;
  summary: string;
}

export class LspCodeActionApplyDiagnostics {
  private readonly delegate: LspRenameApplyDiagnostics;

  constructor(
    options: ConstructorParameters<typeof LspRenameApplyDiagnostics>[0],
  ) {
    this.delegate = new LspRenameApplyDiagnostics(options);
  }

  observeBefore(
    files: LspRenameFile[],
    signal?: AbortSignal,
  ): Promise<LspRenameDiagnosticsState> {
    return this.delegate.observeBefore(files, signal);
  }

  async observeAfter(
    state: LspRenameDiagnosticsState,
    expectedFiles: LspRenameCommitExpectedFile[],
    signal?: AbortSignal,
  ): Promise<LspCodeActionApplyDiagnosticsObservation> {
    return codeActionObservation(
      await this.delegate.observeAfter(state, expectedFiles, signal),
    );
  }

  unavailable(
    state: LspRenameDiagnosticsState,
    error: unknown,
  ): LspCodeActionApplyDiagnosticsObservation {
    return codeActionObservation(unavailableLspRenameDiagnostics(state, error));
  }
}

function codeActionObservation(
  observation: LspRenameDiagnosticsObservation,
): LspCodeActionApplyDiagnosticsObservation {
  const {
    kind: _kind,
    resultSha256: _resultSha256,
    ...durableDetails
  } = observation.details;
  const base = {
    kind: "napier.lsp-code-action-apply-diagnostics" as const,
    ...durableDetails,
  };
  return {
    details: {
      ...base,
      resultSha256: sha256(canonicalJson(base)),
    },
    summary: observation.summary
      .replace("Rename diagnostics:", "Code Action diagnostics:")
      .replace(
        "The rename commit outcome remains authoritative",
        "The Code Action commit outcome remains authoritative",
      ),
  };
}
