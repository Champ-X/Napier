import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, it } from "vitest";

import {
  resolveRepoRelativePath,
  settleReceiptFile,
  sha256,
  stableJson,
  toRepoRelativePath,
} from "./content-addressed-receipt.mjs";

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("content-addressed receipt", () => {
  it("atomically writes passing receipts with stable public bytes", async () => {
    const root = await createRoot();
    const receiptPath = "docs/artifacts/receipt.json";
    const target = path.join(root, receiptPath);

    await settleReceiptFile({
      receipt: { type: "napier.test", ok: true },
      receiptPath,
      repoRoot: root,
    });

    assert.equal(
      await readFile(target, "utf8"),
      '{\n  "type": "napier.test",\n  "ok": true\n}\n',
    );
    assert.equal((await stat(target)).mode & 0o777, 0o644);
    await assert.rejects(stat(`${target}.${process.pid}.tmp`), {
      code: "ENOENT",
    });
  });

  it("removes stale receipts when the current result fails", async () => {
    const root = await createRoot();
    const target = path.join(root, "receipt.json");
    await writeFile(target, "stale", "utf8");

    await settleReceiptFile({
      receipt: { ok: false },
      receiptPath: "receipt.json",
      repoRoot: root,
    });

    await assert.rejects(readFile(target), { code: "ENOENT" });
  });

  it("canonicalizes hashes and confines receipt paths to the repository", async () => {
    const root = await createRoot();
    const canonical = stableJson({ z: 1, nested: { b: 2, a: 1 } });

    assert.equal(canonical, '{"nested":{"a":1,"b":2},"z":1}');
    assert.equal(
      sha256(Buffer.from(canonical, "utf8")),
      "2add9fb59c0898968607fcf9ce99adcf043ef5e68f8886bfea401bceb5c545b2",
    );
    const target = resolveRepoRelativePath(
      root,
      "docs/receipt.json",
      "receiptPath",
    );
    assert.equal(toRepoRelativePath(root, target), "docs/receipt.json");
    assert.throws(
      () => resolveRepoRelativePath(root, "../outside.json", "receiptPath"),
      { message: "receiptPath must stay inside the repo root" },
    );
    assert.throws(() => resolveRepoRelativePath(root, target, "receiptPath"), {
      message: "receiptPath must be a repo-relative path",
    });
  });
});

async function createRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-receipt-"));
  temporaryRoots.push(root);
  return root;
}
