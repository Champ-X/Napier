import { afterAll, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { Hono } from '/Users/champ/orca/Napier/node_modules/hono/dist/index.js';
import { LocalStore } from '/Users/champ/orca/Napier/packages/runtime/src/store.ts';
import { createPlanTools, exportWorkspaceFileArtifact } from '/Users/champ/orca/Napier/packages/runtime/src/plan-tools.ts';
import { registerPlanProgressHttp } from '/Users/champ/orca/Napier/apps/server/src/plan-progress-http.ts';
import { taskValidationMatrix } from '/Users/champ/orca/Napier/apps/web/src/task-validation-matrix.ts';
import { TaskNarrativeProjectionService, KernelProjectionRegistry } from '/Users/champ/orca/Napier/packages/runtime/src/kernel-projections.ts';

const observations: unknown[] = [];
afterAll(async () => { await writeFile('/tmp/napier-g01-audit-observed-20261030.json', JSON.stringify(observations, null, 2) + '\n'); });
async function fixture() {
  const root = await mkdtemp('/tmp/napier-g01-audit-'), workspaceRoot = path.join(root, 'workspace');
  await mkdir(workspaceRoot);
  const store = new LocalStore({ workspaceRoot, dataRoot: path.join(root, 'data') });
  await store.initialize();
  const agent = store.listAgents()[0]!, thread = await store.createThread({ title: 'G01 source audit', agentId: agent.id });
  const run = await store.createRun({ threadId: thread.id, agentId: agent.id });
  const plan = await store.createPlan(thread.id, { objective: 'Deliver report',
    steps: [{ id: 'write', title: 'Write report', description: 'Produce report', verification: 'Observed file' }],
    artifacts: [{ id: 'report', path: 'report.txt', description: 'Declared report' }] });
  const app = new Hono(); registerPlanProgressHttp(app, store);
  const post = async (body: unknown) => app.request(`/api/threads/${thread.id}/plans/${plan.id}/artifacts/report`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const close = async () => { await store.shutdown(); await rm(root, { recursive: true, force: true }); };
  return { root, store, workspaceRoot, thread, run, plan, post, close };
}

it('does not promote a missing file from caller-supplied verified metadata', async () => {
  const f = await fixture();
  try {
    expect((await f.post({ status: 'produced', sourceRunId: f.run.id, evidence: 'caller says produced' })).status).toBe(200);
    expect((await f.post({ status: 'verified', sourceRunId: f.run.id, evidence: 'caller says verified', sha256: 'a'.repeat(64), sizeBytes: 12 })).status).toBe(200);
    const detail = await f.store.getDetail(f.thread.id), exists = await access(path.join(f.workspaceRoot, 'report.txt')).then(() => true, () => false);
    const actual = { scenario: 'metadata_only_missing_file', exists, deliverables: detail.taskNarrative?.deliverables,
      validation: taskValidationMatrix(detail.events, detail.plans) };
    observations.push(actual);
    expect(detail.taskNarrative?.deliverables?.[0]?.verification, JSON.stringify(actual)).not.toBe('integrity_recorded');
  } finally { await f.close(); }
});

it('retains both emitted versions when the same artifact hash is overwritten', async () => {
  const f = await fixture(), registry = new KernelProjectionRegistry(), service = new TaskNarrativeProjectionService(registry, f.store);
  try {
    await f.post({ status: 'produced', sourceRunId: f.run.id, evidence: 'declared' });
    await f.post({ status: 'verified', sourceRunId: f.run.id, evidence: 'v1 asserted', sha256: 'a'.repeat(64), sizeBytes: 1 });
    await service.project(f.thread.id);
    await f.post({ status: 'verified', sourceRunId: f.run.id, evidence: 'v2 asserted', sha256: 'b'.repeat(64), sizeBytes: 2 });
    const detail = await f.store.getDetail(f.thread.id), warm = await service.project(f.thread.id);
    const hashes = detail.events.filter(e => e.type === 'plan.artifact.verified').map(e => (e.payload as Record<string, unknown>).sha256);
    const actual = { scenario: 'same_artifact_overwrite', hashes, cold: detail.taskNarrative?.deliverables, warm: warm.view.deliverables };
    observations.push(actual);
    expect(hashes).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
    expect(detail.taskNarrative?.deliverables?.[0]?.previousVersions, JSON.stringify(actual)).toContainEqual(expect.objectContaining({ sha256: 'a'.repeat(64) }));
  } finally { registry.shutdown(); await f.close(); }
});

it('does not show current artifact pass after native verification bytes drift', async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.workspaceRoot, 'report.txt'), 'first bytes');
    const update = createPlanTools(f.store, f.run).find(t => t.name === 'update_plan_artifact')!;
    await update.execute('produce', { planId: f.plan.id, artifactId: 'report', action: 'produced', evidence: 'preexisting report' });
    await update.execute('verify', { planId: f.plan.id, artifactId: 'report', action: 'verify', evidence: 'native observed bytes' });
    await writeFile(path.join(f.workspaceRoot, 'report.txt'), 'changed bytes');
    const detail = await f.store.getDetail(f.thread.id), artifact = detail.plans[0]!.artifacts[0]!;
    const previewError = await exportWorkspaceFileArtifact(f.workspaceRoot, artifact).then(() => null, e => String(e));
    const validation = taskValidationMatrix(detail.events, detail.plans).find(r => r.id === 'artifact');
    const actual = { scenario: 'native_drift_after_verified', deliverables: detail.taskNarrative?.deliverables, validation, previewError };
    observations.push(actual);
    expect(previewError).toContain('digest drifted');
    expect(validation?.status, JSON.stringify(actual)).not.toBe('passed');
  } finally { await f.close(); }
});
