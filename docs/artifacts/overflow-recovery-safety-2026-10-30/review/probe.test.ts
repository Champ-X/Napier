import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createAssistantMessageEventStream, fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { cleanupModelSessionFixtures, createModelSessionFixture } from '/private/tmp/napier-overflow-safety-verify-20261030/packages/runtime/test/subagent-model-session-fixture.ts';
import { recoverModelContextOverflow, isFinalizedModelContextOverflow } from '/private/tmp/napier-overflow-safety-verify-20261030/packages/runtime/src/model-context-overflow-recovery.ts';
import { aggregateRunUsage } from '/private/tmp/napier-overflow-safety-verify-20261030/packages/runtime/src/run-replay.ts';

beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External calls forbidden'); })));
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await cleanupModelSessionFixtures(); });
const partialUsage = { input: 100, output: 20, cacheRead: 10, cacheWrite: 5, totalTokens: 135,
  cost: { input: .01, output: .02, cacheRead: .002, cacheWrite: .001, total: .033 } };
const zeroUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

it.each(['partial', 'unknown'])('native child mixedHTTP %s stops its actual route before fallback', async (state) => {
  const f = await createModelSessionFixture({ nativeAccounting: true, timeoutMs: 15_000 });
  const fallback = fauxProvider({ provider: 'child-overflow-probe-fallback', models: [{ id: 'fallback', reasoning: false }] });
  const calls: string[] = [];
  const dispatch = (model: any) => {
    calls.push(`${model.provider}/${model.id}`);
    const stream = createAssistantMessageEventStream();
    const message = { ...fauxAssistantMessage(''), api: model.api, provider: model.provider, model: model.id,
      content: [], usage: state === 'partial' ? partialUsage : zeroUsage,
      stopReason: 'error' as const, errorMessage: 'HTTP 500: context_length_exceeded' };
    stream.push({ type: 'error', reason: 'error', error: message });
    return stream;
  };
  f.registry.registerProvider({ ...f.faux.provider, stream: dispatch, streamSimple: dispatch });
  f.registry.registerProvider({ ...fallback.provider, stream: dispatch, streamSimple: dispatch });
  const handle = await f.supervisor.start(f.request({ outputSchema: { type: 'string' },
    modelRoute: { fallbackModels: [{ provider: fallback.provider.id, id: 'fallback' }] } }));
  const result = await f.supervisor.collect(handle);
  expect(result.status).toBe('failed');
  expect(calls).toEqual([`${f.model.provider}/${f.model.id}`]);
  const child = f.store.listRuns(f.thread.id).find(run => run.id === result.task.childRunId)!;
  const events = await f.store.listRunEvents(child.id);
  const routeEnds = events.filter(event => event.type === 'route_attempt_ended');
  expect(routeEnds.map(event => event.payload)).toEqual([expect.objectContaining({ outcome: 'terminal', failureClass: 'provider_server' })]);
  expect(events.filter(event => event.type === 'route_attempt_started')).toHaveLength(1);
  expect(events.filter(event => event.type === 'model.accounting.prepared')).toHaveLength(1);
  expect(events.filter(event => event.type === 'model.usage.reconciled')).toHaveLength(1);
  expect(events.filter(event => event.type === 'model.response')).toHaveLength(1);
  expect(events.find(event => event.type === 'model.response')?.payload).toMatchObject({ stopReason: 'error', accountingMode: 'physical_receipt_v1' });
  expect(events.find(event => event.type === 'model.response')?.payload).not.toHaveProperty('outputDisposition');
  expect(events.find(event => event.type === 'model.context.overflow')?.payload).toMatchObject({ action: 'finalize', recoveryReadiness: 'incomplete', evidenceRole: 'diagnostic' });
  expect(events.find(event => event.type === 'model.context.overflow')?.payload).not.toHaveProperty('usage');
  expect(events.find(event => event.type === 'model.usage.reconciled')?.payload).toMatchObject({ observation: { usageStatus: state } });
  expect((await f.store.modelAccountingRepository.readRunAccounting(child.id)).usageStatus).toBe('incomplete');
  expect(aggregateRunUsage(events, [])).toEqual(child.usage);
  expect(f.source!.pending()).toHaveLength(0);
});

it('opaque finalized disposition does not transfer through bytes, fields or prototype', async () => {
  const message = { ...fauxAssistantMessage(''), stopReason: 'error' as const, errorMessage: 'HTTP 500: context_length_exceeded' };
  const source = createAssistantMessageEventStream();
  source.push({ type: 'error', reason: 'error', error: message });
  const recover = vi.fn(async () => source);
  const stream = recoverModelContextOverflow({ source, nativeAccounting: true, signal: new AbortController().signal, recover });
  for await (const _event of stream) {}
  expect(recover).not.toHaveBeenCalled();
  expect(isFinalizedModelContextOverflow(message)).toBe(true);
  for (const copy of [structuredClone(message), { ...message }, JSON.parse(JSON.stringify(message)), Object.create(message),
    { ...message, finalizedOverflow: true, outputDisposition: 'finalized_context_overflow' }]) {
    expect(isFinalizedModelContextOverflow(copy)).toBe(false);
  }
  expect(isFinalizedModelContextOverflow(await stream.result())).toBe(true);
  message.errorMessage = 'HTTP 500: network error';
  // Scope boundary: this is a sticky deny marker for one identity, not a receipt or retry capability.
  expect(isFinalizedModelContextOverflow(message)).toBe(true);
});
