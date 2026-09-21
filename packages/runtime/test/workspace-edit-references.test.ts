import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceTools } from "../src/tools.js";
import { withWorkspaceEditReferences } from "../src/workspace-edit-reference-tools.js";
import { WorkspaceEditSnapshots } from "../src/workspace-edit-snapshots.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(unifiedDiff = false) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-edit-refs-"));
  roots.push(root);
  const source = "export const price = 10;\nexport const tax = 2;\n";
  await writeFile(path.join(root, "price.ts"), source);
  const tools = withWorkspaceEditReferences(
    createWorkspaceTools(root, {
      includeWriteTools: true,
      dataRoot: path.join(root, ".napier"),
    }),
    { unifiedDiff },
  );
  const read = tools.find((tool) => tool.name === "read_file")!;
  const patch = tools.find((tool) => tool.name === "apply_patch")!;
  const result = await read.execute("read-price", { path: "price.ts" });
  const details = result.details as {
    snapshotRef: string;
    sha256: string;
    anchors: Array<{ line: number; anchorRef: string }>;
  };
  const edit = {
    operation: "hashline_replace",
    path: "price.ts",
    snapshotRef: details.snapshotRef,
    edits: [{ anchorRef: "L1", newText: "export const price = 12;" }],
  };
  return { root, source, tools, read, patch, result, details, edit };
}

describe("workspace edit references", () => {
  it("commits unified diffs through the original atomic patch tool and rejects stale, partial or disabled snapshots", async () => {
    const f = await fixture(true);
    const patch = {
      operation: "unified_diff",
      path: "price.ts",
      snapshotRef: f.details.snapshotRef,
      diff: "--- a/price.ts\n+++ b/price.ts\n@@ -1,2 +1,2 @@\n-export const price = 10;\n+export const price = 12;\n export const tax = 2;\n",
    };
    const result = await f.patch.execute("diff", patch);
    expect(await readFile(path.join(f.root, "price.ts"), "utf8")).toBe(
      f.source.replace("10", "12"),
    );
    expect(result.details).toMatchObject({ beforeSha256: f.details.sha256 });
    await expect(f.patch.execute("stale-diff", patch)).rejects.toThrow(
      "read_then_rebuild_edit",
    );
    const partial = await f.read.execute("partial", {
      path: "price.ts",
      startLine: 1,
      endLine: 1,
    });
    await expect(
      f.patch.execute("partial-diff", {
        ...patch,
        snapshotRef: (partial.details as { snapshotRef: string }).snapshotRef,
      }),
    ).rejects.toThrow("complete read_file");
    const disabled = await fixture();
    await expect(
      disabled.patch.execute("disabled-diff", {
        ...patch,
        snapshotRef: disabled.details.snapshotRef,
      }),
    ).rejects.toThrow("enabled policy");
  });

  it("edits real bytes using short references while retaining full-hash evidence", async () => {
    const f = await fixture();
    expect(f.result.content[0]).toEqual(
      expect.objectContaining({
        text: expect.not.stringContaining('"lineAnchors"'),
      }),
    );
    expect(f.details.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(f.result.content[0]).toMatchObject({
      text: expect.stringContaining("L1|export const price = 10;"),
    });
    const result = await f.patch.execute("edit", f.edit);
    expect(await readFile(path.join(f.root, "price.ts"), "utf8")).toBe(
      f.source.replace("10", "12"),
    );
    expect(result.details).toMatchObject({ beforeSha256: f.details.sha256 });
  });

  it("rejects stale snapshots and supplies a recovery action without overwriting external edits", async () => {
    const f = await fixture();
    const external = f.source.replace("tax = 2", "tax = 3");
    await writeFile(path.join(f.root, "price.ts"), external);
    await expect(f.patch.execute("edit", f.edit)).rejects.toThrow(
      "read_then_rebuild_edit",
    );
    expect(await readFile(path.join(f.root, "price.ts"), "utf8")).toBe(
      external,
    );
    const refreshed = await f.read.execute("reread", { path: "price.ts" });
    await f.patch.execute("retry-new-intent", {
      ...f.edit,
      snapshotRef: (refreshed.details as { snapshotRef: string }).snapshotRef,
    });
    expect(await readFile(path.join(f.root, "price.ts"), "utf8")).toBe(
      external.replace("10", "12"),
    );
  });

  it("retains the commit-time CAS winner with concurrent reference edits", async () => {
    const f = await fixture();
    const outcomes = await Promise.allSettled([
      f.patch.execute("a", f.edit),
      f.patch.execute("b", {
        ...f.edit,
        edits: [{ anchorRef: "L1", newText: "export const price = 15;" }],
      }),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    const contents = await readFile(path.join(f.root, "price.ts"), "utf8");
    expect([
      f.source.replace("10", "12"),
      f.source.replace("10", "15"),
    ]).toContain(contents);
  });

  it("rejects foreign files, invented anchors and previous-run references", async () => {
    const f = await fixture();
    await writeFile(path.join(f.root, "other.ts"), f.source);
    await expect(
      f.patch.execute("foreign-file", { ...f.edit, path: "other.ts" }),
    ).rejects.toThrow("different file");
    await expect(
      f.patch.execute("foreign-anchor", {
        ...f.edit,
        edits: [{ anchorRef: "L100", newText: "bad" }],
      }),
    ).rejects.toThrow("not in this read");
    const nextRun = withWorkspaceEditReferences(
      createWorkspaceTools(f.root, {
        includeWriteTools: true,
        dataRoot: path.join(f.root, ".napier"),
      }),
    );
    await expect(
      nextRun
        .find((tool) => tool.name === "apply_patch")!
        .execute("foreign-run", f.edit),
    ).rejects.toThrow("another run");
    expect(await readFile(path.join(f.root, "price.ts"), "utf8")).toBe(
      f.source,
    );
  });

  it("does not silently replace conflicting full-hash arguments", async () => {
    const f = await fixture();
    await expect(
      f.patch.execute("conflicting-file", {
        ...f.edit,
        expectedSha256: "a".repeat(64),
      }),
    ).rejects.toThrow("conflicts with expectedSha256");
    await expect(
      f.patch.execute("conflicting-line", {
        ...f.edit,
        edits: [{ anchorRef: "L1", line: 2, newText: "bad" }],
      }),
    ).rejects.toThrow("conflicts with explicit line");
    expect(await readFile(path.join(f.root, "price.ts"), "utf8")).toBe(
      f.source,
    );
  });

  it("keeps explicit legacy edits and cancellation working", async () => {
    const f = await fixture();
    await expect(
      f.patch.execute("cancel", f.edit, AbortSignal.abort()),
    ).rejects.toThrow("aborted");
    await f.patch.execute("legacy", {
      operation: "replace",
      path: "price.ts",
      expectedSha256: f.details.sha256,
      edits: [{ oldText: "price = 10", newText: "price = 11" }],
    });
    expect(await readFile(path.join(f.root, "price.ts"), "utf8")).toBe(
      f.source.replace("10", "11"),
    );
  });

  it("bounds retained snapshots and refuses evicted references", () => {
    const snapshots = new WorkspaceEditSnapshots(1);
    const input = { path: "a", sha256: "a".repeat(64), lineAnchors: [] };
    const first = snapshots.capture(input);
    snapshots.capture(input);
    expect(() => snapshots.resolve({ snapshotRef: first.snapshotRef })).toThrow(
      "expired",
    );
  });
});
