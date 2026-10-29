import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect } from "vitest";
import type { ModelAccountingPhase } from "@napier/contracts/model-accounting";
import { LocalStore } from "../src/store.js";
import { accountedTestRegistry } from "./model-usage-registry-fixture.js";

const fixtures: Array<{ root: string; store: LocalStore }> = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    fixture.store.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

export async function accountedReviewRegistry() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-operation-review-"));
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  fixtures.push({ root, store });
  const accounting = await accountedTestRegistry(
    store,
    path.join(root, "usage.sqlite"),
  );
  return {
    models: accounting.models,
    assertOperationReceipt(phase: ModelAccountingPhase) {
      const receipts = accounting.receipts();
      expect(receipts).toHaveLength(1);
      const { attribution, observation, acknowledgedAt } = receipts[0]!;
      expect(attribution.owner).toMatchObject({
        kind: "operation",
        operation: phase,
      });
      expect(attribution.phase).toBe(phase);
      expect(attribution.method).toBe("completeSimple");
      expect(observation.terminal).toBe("response");
      expect(acknowledgedAt).not.toBeNull();
      expect(accounting.source.pending()).toEqual([]);
    },
  };
}
