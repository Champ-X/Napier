// Run from the repository root:
// node --import tsx docs/investigations/2026-11-07-review/benchmark-recovery.mjs [output.json]
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.cwd();
const { projectRunOrchestrationState } = await import(pathToFileURL(resolve(root, 'packages/runtime/src/run-orchestration-projection.ts')).href);
const { projectRunRecoveryCheckpoint, recoveryCheckpointFromOrchestration } = await import(pathToFileURL(resolve(root, 'packages/runtime/src/run-recovery-checkpoint.ts')).href);
const run = { id: 'run_source', threadId: 'thread_source', status: 'interrupted' };
const events = Array.from({ length: 500 }, (_, i) => ['tool.started', 'tool.completed'].map((type, j) => ({
  id: `e_${i * 2 + j}`, runId: run.id, threadId: run.threadId, seq: i * 2 + j + 1,
  type, category: 'tool', visibility: 'debug', createdAt: '2026-11-07T00:00:00Z',
  payload: { callId: `call_${i}`, toolName: 'read_file' },
}))).flat();
const before = () => [projectRunRecoveryCheckpoint(run, events), projectRunOrchestrationState(run, events)];
const after = () => {
  const state = projectRunOrchestrationState(run, events);
  return [recoveryCheckpointFromOrchestration(state), state];
};
if (JSON.stringify(before()) !== JSON.stringify(after())) throw new Error('Projection output changed');
for (let i = 0; i < 5; i++) { before(); after(); }
const samples = { before: [], after: [] };
for (let i = 0; i < 30; i++) {
  for (const [name, fn] of i % 2 ? [['after', after], ['before', before]] : [['before', before], ['after', after]]) {
    const start = performance.now();
    fn();
    samples[name].push(performance.now() - start);
  }
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const result = {
  measuredAt: new Date().toISOString(), workspaceRoot: root, nodeVersion: process.version,
  scope: 'Microbenchmark of checkpoint plus orchestration projections only; not HTTP or browser latency',
  before: 'Compute the checkpoint and orchestration projections independently',
  after: 'Compute orchestration once, then derive checkpoint from it',
  events: events.length, samplesPerVariant: 30, warmupPerVariant: 5, identicalOutput: true,
  beforeMedianMs: median(samples.before), afterMedianMs: median(samples.after), samplesMs: samples,
};
const destination = process.argv[2];
if (destination) writeFileSync(destination, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ destination, ...result, samplesMs: undefined }));
