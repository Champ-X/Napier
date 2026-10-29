import { rm } from "node:fs/promises";
import { createAssistantMessageEventStream, fauxProvider, type AssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ModelRegistry } from "/private/tmp/napier-overflow-safety-verify-20261030/packages/runtime/src/models.ts";
import { accountingFixture } from "/private/tmp/napier-overflow-safety-verify-20261030/packages/runtime/test/model-accounting-fixture.ts";
import { processReadyAgentRuntime } from "/private/tmp/napier-overflow-safety-verify-20261030/packages/runtime/test/process-run-readiness-test-fixture.ts";
import { assertModelRequestEvidenceBindings } from "/private/tmp/napier-overflow-safety-verify-20261030/packages/runtime/src/model-prompt-evidence-bindings.ts";
import { aggregateRunUsage } from "/private/tmp/napier-overflow-safety-verify-20261030/packages/runtime/src/run-replay.ts";
import { RunBudgetTracker } from "/private/tmp/napier-overflow-safety-verify-20261030/packages/runtime/src/run-budget.ts";
const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External requests forbidden"); })));
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await Promise.all(cleanups.splice(0).map((close) => close())); });
it.each(["hidden_cancel", "hidden_throw_cancel", "diagnostic_throw_cancel"])("main legacy callback boundary %s", async (mode) => {
 const f = await accountingFixture();
 cleanups.push(async () => { await f.store.shutdown(); f.source.close(); await rm(f.root,{recursive:true,force:true}); });
 await f.store.finishRun(f.parent.run.id,"completed",{leaseToken:f.parent.token});
 const provider=fauxProvider({provider:"main-callback-probe",models:[{id:"bounded",reasoning:false},{id:"fallback",reasoning:false}]});
 const registry=new ModelRegistry();
 const dispatch=vi.fn(() => {
  const source=createAssistantMessageEventStream();
  const error: AssistantMessage={...f.fixture.message,provider:provider.provider.id,model:"bounded",stopReason:"error",errorMessage:"HTTP 500: context_length_exceeded"};
  source.push({type:"error",reason:"error",error});return source;
 });
 registry.registerProvider({...provider.provider,stream:dispatch,streamSimple:dispatch});
 const controller=new AbortController();
 const auxiliary=vi.spyOn(RunBudgetTracker.prototype,"observeAuxiliaryUsage");
 const primary=vi.spyOn(RunBudgetTracker.prototype,"observePrimaryUsage");
 let observedCallback=0;
 const result=await processReadyAgentRuntime(f.store,registry).runPrompt({threadId:f.thread.id,text:"Return one result",
  model:{provider:provider.provider.id,id:"bounded"},signal:controller.signal,
  modelRoute:{role:"reasoning",fallbackModels:[{provider:provider.provider.id,id:"fallback"}]},
  onEvent:async event=>{
   const target=mode.startsWith("hidden") ? event.type==="model.response" && event.payload?.["responseDisposition"]==="context_overflow_retry" : event.type==="model.context.overflow";
   if(target){observedCallback++;controller.abort();if(mode.includes("throw"))throw new Error("Injected observer failure");}
  }});
 const events=await f.store.listRunEvents(result.id);
 expect(observedCallback).toBe(1);
 expect(dispatch).toHaveBeenCalledOnce();
 expect(primary).toHaveBeenCalledOnce();
 if(mode.startsWith("hidden"))expect(auxiliary).toHaveBeenCalledOnce();else expect(auxiliary).not.toHaveBeenCalled();
 expect(aggregateRunUsage(events,[])).toEqual(result.usage);
 expect(result.usage.inputTokens).toBe(f.fixture.message.usage.input);
 expect(result.usage.outputTokens).toBe(f.fixture.message.usage.output);
 expect(()=>assertModelRequestEvidenceBindings(events)).not.toThrow();
 const charged=events.filter(e=>e.type==="model.response" && Number(e.payload?.["usage"]?.["inputTokens"])>0);
 expect(charged).toHaveLength(1);
});
