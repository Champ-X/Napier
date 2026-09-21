import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "vitest";
import {
  createSpendingBudget,
  openSpendingBudget,
} from "./harness-spending-budget.mjs";

// Exercise the real CLI/scheduler/filesystem with a synthetic campaign child in
// an isolated copy. No provider, credential or real task-quality claim is used.
test.each(["passing", "regressed", "prioritized_regression", "funds"])(
  "paired suite CLI retains %s collection evidence without network",
  async (scenario) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "napier-paired-cli-"));
    try {
      await cp(path.resolve("scripts"), path.join(root, "scripts"), {
        recursive: true,
      });
      await writeFile(
        path.join(root, "scripts/run-harness-optimization-campaign.mjs"),
        `
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { observation } from "./harness-campaign-test-fixture.mjs";
const args=process.argv.slice(2), get=k=>args[args.indexOf('--'+k)+1];
if(get('trials')!=='1') throw Error('Expected one scheduled trial per child');
if(get('grader-mode')!=='sandbox'||get('grader-runtimes')!=='node,python') throw Error('Grader settings not forwarded');
const trial=Number(get('trial-offset')), arm=get('arm'), output=get('output');
const manifest=JSON.parse(await readFile(path.join(get('case-root'),'manifest.json'),'utf8'));
await appendFile(path.join(path.dirname(output),'synthetic-launches.jsonl'),JSON.stringify({caseId:manifest.id,arm,trial})+'\\n');
const dir=path.join(output,'trial-'+(trial+1));await mkdir(dir,{recursive:true});
const report=observation(arm,{caseId:manifest.id,trial,fixtureSha256:(manifest.id==='one'?'1':'2').repeat(64),
taskSuccess:!(['regressed','prioritized_regression'].includes(process.env.NAPIER_TEST_SCENARIO)&&manifest.id==='two'&&arm==='candidate')});
await writeFile(path.join(dir,'result.json'),JSON.stringify(report),{flag:'wx'});
`,
      );
      for (const id of ["one", "two"]) {
        const dir = path.join(root, id);
        await mkdir(path.join(dir, "fixture"), { recursive: true });
        await writeFile(path.join(dir, "fixture/input.txt"), id);
        await writeFile(path.join(dir, "prompt.md"), `Fix ${id}`);
        await writeFile(
          path.join(dir, "outcome.mjs"),
          "// synthetic external grader",
        );
        await writeFile(
          path.join(dir, "manifest.json"),
          JSON.stringify({
            id,
            fixturePath: "fixture",
            promptPath: "prompt.md",
            outcomeTestPath: "outcome.mjs",
          }),
        );
      }
      const suite = path.join(root, "suite.json"),
        output = path.join(root, "output");
      await writeFile(
        suite,
        JSON.stringify({
          kind: "napier.harness-optimization-suite",
          schemaVersion: 1,
          id: "synthetic_suite",
          cases: ["one", "two"].map((id) => ({ path: id, coverage: [id] })),
        }),
      );
      const args = [
        path.join(root, "scripts/run-harness-optimization-suite.mjs"),
        "--suite",
        suite,
        "--output",
        output,
        "--baseline-runtime",
        root,
        "--candidate-runtime",
        root,
        "--max-api-requests",
        "20",
        "--api-request-interval-ms",
        "30000",
        "--grader-mode",
        "sandbox",
        "--grader-runtimes",
        "node,python",
      ];
      const spending = path.join(root, "spending.sqlite");
      if (scenario === "prioritized_regression")
        args.push("--prioritize-case", "two");
      if (scenario === "funds") {
        createSpendingBudget(spending, { maxFen: 500 });
        args.push("--spending-budget", spending);
      }
      const child = spawnSync(process.execPath, args, {
        timeout: 15000,
        encoding: "utf8",
        env: { PATH: process.env.PATH, NAPIER_TEST_SCENARIO: scenario },
      });
      const result = JSON.parse(
        await readFile(path.join(output, "suite-result.json"), "utf8"),
      );
      assert.equal(result.scheduleMode, "paired-stop");
      assert.equal(result.concurrency, 1);
      assert.equal(result.apiRequestBudget.admitted, 0);
      assert.equal(result.promotionReady, false);
      assert.deepEqual(result.quality.required, {
        minimumCases: 30,
        minimumTrials: 3,
      });
      assert.equal(result.statuses.length, 12);
      if (scenario === "passing") {
        assert.equal(child.status, 0, child.stderr);
        assert.equal(result.collectionComplete, true);
        assert.equal(result.quality.comparablePairs, 6);
        assert.deepEqual(
          [...new Set(result.observations.map((r) => r.trial))].sort(),
          [0, 1, 2],
        );
        assert.equal(new Set(result.observations.map((r) => r.runId)).size, 12);
      } else if (
        scenario === "regressed" ||
        scenario === "prioritized_regression"
      ) {
        const completed = scenario === "regressed" ? 4 : 2;
        assert.equal(child.status, 1);
        assert.equal(result.stop.reason, "quality_regressed");
        assert.equal(result.observations.length, completed);
        assert.equal(result.missing.length, 12 - completed);
        const checkpoint = JSON.parse(
          await readFile(
            path.join(output, `checkpoint-${completed}.json`),
            "utf8",
          ),
        );
        assert.equal(checkpoint.stop.reason, "quality_regressed");
        assert.equal(
          result.observations.some((r) => r.taskSuccess === false),
          true,
        );
      } else {
        assert.equal(child.status, 1);
        assert.equal(result.stop.reason, "spending_budget_insufficient");
        assert.equal(result.statuses[0].result.spawned, false);
        assert.equal(result.observations.length, 0);
        assert.equal(result.spendingBudget.remainingFen, 500);
        assert.equal(result.spendingBudget.requests, 0);
        const budget = openSpendingBudget(spending);
        assert.equal(budget.snapshot().requests, 0);
        budget.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
