import { randomBytes } from "node:crypto";
import path from "node:path";
import { sha256 } from "./ed25519.js";
import { compileUnifiedDiffEditIntent } from "./unified-diff-edit-intent.js";
import { compileEditIntent } from "./edit-dialect-adapter.js";

const HASH = /^[a-f0-9]{64}$/u;

interface EditSnapshot {
  path: string;
  sha256: string;
  anchors: Map<number, string>;
  source?: string;
}

export interface WorkspaceEditReference {
  snapshotRef: string;
  anchors: Array<{ line: number; anchorRef: string }>;
}

/** Run-local names for full preconditions, never substitutes for commit-time CAS.
 * A resumed run must read again; a previous run's names cannot authorize a write.
 */
export class WorkspaceEditSnapshots {
  private readonly snapshots = new Map<string, EditSnapshot>();
  private readonly namespace = randomBytes(8).toString("hex");
  private sequence = 0;

  constructor(private readonly capacity = 128) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1024)
      throw new Error("Invalid edit snapshot capacity");
  }

  capture(input: {
    path: string;
    sha256: string;
    lineAnchors: Array<{ line: number; sha256: string }>;
    source?: string;
  }): WorkspaceEditReference {
    if (!HASH.test(input.sha256)) throw new Error("Invalid edit snapshot hash");
    const target = canonicalPath(input.path);
    const anchors = new Map<number, string>();
    for (const anchor of input.lineAnchors) {
      if (
        !Number.isSafeInteger(anchor.line) ||
        anchor.line < 1 ||
        !HASH.test(anchor.sha256) ||
        anchors.has(anchor.line)
      )
        throw new Error("Invalid edit snapshot anchor");
      anchors.set(anchor.line, anchor.sha256);
    }
    const snapshotRef = `s${this.namespace}_${++this.sequence}`;
    this.snapshots.set(snapshotRef, {
      path: target,
      sha256: input.sha256,
      anchors,
      ...(input.source !== undefined && sha256(input.source) === input.sha256
        ? { source: input.source }
        : {}),
    });
    if (this.snapshots.size > this.capacity)
      this.snapshots.delete(this.snapshots.keys().next().value!);
    return {
      snapshotRef,
      anchors: [...anchors.keys()].map((line) => ({
        line,
        anchorRef: `L${line}`,
      })),
    };
  }

  resolve(input: Record<string, unknown>): Record<string, unknown> {
    const { snapshotRef, ...rest } = input;
    if (snapshotRef === undefined) {
      if (
        Array.isArray(input.edits) &&
        input.edits.some((edit) => record(edit) && edit.anchorRef !== undefined)
      )
        throw new Error("anchorRef requires snapshotRef from read_file");
      return input;
    }
    const snapshot =
      typeof snapshotRef === "string"
        ? this.snapshots.get(snapshotRef)
        : undefined;
    if (!snapshot)
      throw new Error(
        "Edit snapshot is expired or belongs to another run; read_file again before editing",
      );
    if (
      typeof rest.path !== "string" ||
      canonicalPath(rest.path) !== snapshot.path
    )
      throw new Error(
        "Edit snapshot belongs to a different file; read_file the target before editing",
      );
    if (rest.operation === "create")
      throw new Error("Create does not accept a read snapshot");
    if (
      rest.expectedSha256 !== undefined &&
      rest.expectedSha256 !== snapshot.sha256
    )
      throw new Error(
        "Edit snapshot conflicts with expectedSha256; read_file again",
      );
    if (rest.operation === "unified_diff") {
      return compileSnapshotDiff(snapshot, rest);
    }
    if (!Array.isArray(rest.edits))
      throw new Error("Edit snapshot requires edits");
    return {
      ...rest,
      expectedSha256: snapshot.sha256,
      edits: rest.edits.map((edit: unknown) => {
        if (!record(edit)) throw new Error("Invalid snapshot edit");
        const { anchorRef, ...fields } = edit;
        if (anchorRef === undefined) return fields;
        if (
          rest.operation !== "hashline_replace" ||
          typeof anchorRef !== "string" ||
          !/^L[1-9][0-9]*$/u.test(anchorRef)
        )
          throw new Error(
            "anchorRef requires hashline_replace and an anchor from read_file",
          );
        const line = Number(anchorRef.slice(1));
        const anchorSha256 = snapshot.anchors.get(line);
        if (!anchorSha256)
          throw new Error(
            "Anchor was not in this read snapshot; read_file the requested range",
          );
        if (
          (fields.line !== undefined && fields.line !== line) ||
          (fields.anchorSha256 !== undefined &&
            fields.anchorSha256 !== anchorSha256)
        )
          throw new Error("Edit anchor conflicts with explicit line or hash");
        return { ...fields, line, anchorSha256 };
      }),
    };
  }
}

function compileSnapshotDiff(
  snapshot: EditSnapshot,
  input: Record<string, unknown>,
) {
  if (snapshot.source === undefined || typeof input.diff !== "string")
    throw new Error(
      "Unified diff requires a complete read_file snapshot and a diff string",
    );
  if (
    input.edits !== undefined ||
    input.content !== undefined ||
    input.createParentDirectories !== undefined
  )
    throw new Error("Unified diff conflicts with other edit fields");
  const intent = compileUnifiedDiffEditIntent({
    target: snapshot.path,
    expectedSha256: snapshot.sha256,
    source: snapshot.source,
    diff: input.diff,
  });
  return compileEditIntent({ availableToolNames: ["apply_patch"], intent })
    .input;
}

function canonicalPath(value: string): string {
  if (!value || path.isAbsolute(value) || /[\u0000-\u001f\u007f]/u.test(value))
    throw new Error("Edit snapshot requires a workspace-relative path");
  const normalized = path.normalize(value);
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`))
    throw new Error("Edit snapshot path escapes workspace");
  return normalized;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
