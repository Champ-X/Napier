import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { test } from "vitest";
import { superviseCampaignProcess, campaignCollectionResult } from "./harness-process-supervisor.mjs";
import { readTerminalReportProof } from "./harness-terminal-report.mjs";

const script = `
const fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const [output,mode]=process.argv.slice(1),dir=path.join(output,'trial-4');
fs.mkdirSync(path.join(dir,'data'),{recursive:true});
const db=new DatabaseSync(path.join(dir,'data','ledger.sqlite'));
db.exec('CREATE TABLE ledger_events(seq INTEGER PRIMARY KEY,run_id TEXT,event_json TEXT)');
const runId='run_terminal_fixture';
if(mode!=='no_terminal')db.prepare('INSERT INTO ledger_events(run_id,event_json) VALUES (?,?)').run(runId,JSON.stringify({runId,type:'run.failed',createdAt:new Date().toISOString()}));
db.close();
const report={caseId:'sample_v1',trial:mode==='wrong_trial'?0:3,arm:'baseline',runId,status:'failed',taskSuccess:false,graderExitCode:mode==='ungraded'?null:0,reservedFen:600};
fs.writeFileSync(path.join(dir,'result.json'),mode==='partial'?'{':JSON.stringify(report));
if(mode==='normal')process.exit(0);
if(mode==='ignore_term')process.on('SIGTERM',()=>{});
setInterval(()=>{},10000);
`;
async function fixture(mode, run) {
  const output = await mkdtemp(path.join(os.tmpdir(), "napier-process-supervisor-"));
  const child = spawn(process.execPath, ["-e", script, output, mode], { stdio: "ignore" });
  const job = { output, caseId: "sample_v1", arm: "baseline", trial: 3 };
  try { await run(child, job); }
  finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await rm(output, { recursive: true, force: true }); }
}
const options = job => ({ readTerminalReport: () => readTerminalReportProof(job), terminalGraceMs: 50, killGraceMs: 80, pollMs: 10, maxProcessMs: 2000 });

test("a stable graded terminal failure bounds lingering without altering report or usage", async () => {
  await fixture("linger", async (child, job) => {
    const result = await superviseCampaignProcess(child, options(job));
    assert.equal(result.exitSignal, "SIGTERM");
    assert.equal(result.cleanup.reason, "post_terminal_linger");
    assert.equal(result.cleanup.pid, child.pid);
    const before = result.cleanup.terminalReport, after = await readTerminalReportProof(job);
    assert.deepEqual(after, before);
    const report = JSON.parse(await readFile(before.reportPath));
    assert.equal(report.taskSuccess, false); assert.equal(report.reservedFen, 600);
    const collection = campaignCollectionResult(result);
    assert.equal(collection.exitCode, 0);
    assert.equal(collection.reason, "terminal_report_available_after_cleanup");
    assert.equal(collection.processResult.exitSignal, "SIGTERM");
    assert.equal(collection.processResult.cleanup.terminalReport.status, "failed");
  });
});

test("normal exit is preserved without a cleanup signal", async () => {
  await fixture("normal", async (child, job) => {
    const result = await superviseCampaignProcess(child, options(job));
    assert.equal(result.exitCode, 0); assert.equal(result.cleanup, undefined);
  });
});

test("a terminal child that ignores SIGTERM is killed after the bounded grace", async () => {
  await fixture("ignore_term", async (child, job) => {
    const result = await superviseCampaignProcess(child, options(job));
    assert.equal(result.exitSignal, "SIGKILL");
    assert.equal(result.cleanup.escalatedTo, "SIGKILL");
    assert.equal(result.cleanup.terminalReport.graderExitCode, 0);
  });
});

test.each(["partial", "no_terminal", "ungraded", "wrong_trial"])("%s cannot authorize post-terminal cleanup or successful collection", async mode => {
  await fixture(mode, async (child, job) => {
    const result = await superviseCampaignProcess(child, { ...options(job), maxProcessMs: 250 });
    assert.equal(result.cleanup.reason, "process_timeout");
    assert.equal(result.cleanup.terminalReport, undefined);
    assert.notEqual(campaignCollectionResult(result).exitCode, 0);
    if (mode === "wrong_trial") assert.match(result.reportReadError, /identity mismatch/);
  });
});

test("caller cancellation is not normalized into a collectable success", async () => {
  await fixture("linger", async (child, job) => {
    const controller = new AbortController();
    const result = await superviseCampaignProcess(child, { ...options(job), signal: controller.signal,
      readTerminalReport: async () => {
        const proof = await readTerminalReportProof(job);
        if (proof) controller.abort();
        return proof;
      } });
    assert.equal(result.cleanup.reason, "cancelled");
    assert.notEqual(campaignCollectionResult(result).exitCode, 0);
  });
});
