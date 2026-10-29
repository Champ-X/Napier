import { describe, expect, it } from "vitest";
import type { ExecutionPlan, RunEvent, RunRecord } from "@napier/contracts";
import { createPlanArtifactEventPayload } from "/Users/champ/orca/Napier/packages/runtime/src/plans.ts";
import { applyTaskNarrativeEvent, createTaskNarrativeEventState, projectTaskDeliverables, applyConversationArtifactEvent, createConversationArtifactEventState } from "@napier/contracts/task-narrative";
import { conversationArtifacts, currentConversationArtifacts } from "/Users/champ/orca/Napier/apps/web/src/conversation-artifact-view-model.ts";

it("reclassifies a history-bound native card when a newer primary attempt exists", () => {
 const f=versionFixture();
 const events=[...f.events,startedEvent(3,"run_current","intent_current00001")];
 const runs=[run("run_1","completed"),run("run_current","running")];
 const fresh=conversationArtifacts(events,f.plans,6,runs);
 const native=currentConversationArtifacts({...f,events,runs});
 expect(fresh[0]?.attemptScope).toBe("previous");
 expect(native[0]?.attemptScope).toBe("previous");
});
it("does not accept a different event run when sourceRunId was omitted", () => {
 const current=plan();delete current.artifacts[0]!.sourceRunId;
 const events=[event(2,"plan.artifact.verified","user",createPlanArtifactEventPayload(current,current.artifacts[0]!))];
 const state=events.reduce(applyTaskNarrativeEvent,createTaskNarrativeEventState());
 const projected=conversationArtifacts(events,[current]);
 expect(projected).toHaveLength(1);
 const spoofed={...projected[0]!,runId:"run_unrelated",createdAt:"2026-10-30T00:00:00Z"};
 const output=currentConversationArtifacts({plans:[current],events:[],runs:[],projected:[spoofed],deliverables:projectTaskDeliverables([current],{history:state.artifactHistory})});
 expect(output).toEqual([]);
});
it("retains immutable incremental states and sorts artifact history by sequence", () => {
 const f=versionFixture();const first=createConversationArtifactEventState();const before=structuredClone(first);
 const state=f.events.reduce(applyConversationArtifactEvent,first);
 expect(first).toEqual(before);
 const saved=structuredClone(state);
 applyConversationArtifactEvent(state,startedEvent(3,"run_current","intent_current00001"));
 expect(state).toEqual(saved);
 const reversed=conversationArtifacts([...f.events].reverse(),f.plans);
 expect(reversed).toEqual(f.projected);
});
function versionFixture() {
  const current = plan();
  const events = [event(2, "plan.artifact.verified", "user", createPlanArtifactEventPayload(current, current.artifacts[0]!))];
  const state = events.reduce(applyTaskNarrativeEvent, createTaskNarrativeEventState());
  return { plans: [current], events, projected: conversationArtifacts(events, [current]),
    deliverables: projectTaskDeliverables([current], { history: state.artifactHistory }) };
}

function plan(): ExecutionPlan {
  return {
    id: "plan_1",
    threadId: "thread_1",
    objective: "Deliver the report",
    status: "completed",
    steps: [],
    artifacts: [
      {
        id: "artifact_report",
        path: "artifacts/report.md",
        kind: "file",
        description: "Verified delivery report",
        status: "verified",
        sha256: "a".repeat(64),
        sizeBytes: 128,
        sourceRunId: "run_1",
        evidence: "Runtime verified the report bytes.",
        createdAt: "2026-08-08T00:00:00.000Z",
        updatedAt: "2026-08-08T00:00:02.000Z",
      },
    ],
    replans: [],
    replanRecommendation: null,
    criticalPathStepIds: [],
    readyStepIds: [],
    blockedStepIds: [],
    phaseWaves: [],
    activePhaseIndex: null,
    parallelReadyStepIds: [],
    phaseProjectionSha256: "b".repeat(64),
    revision: 3,
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:02.000Z",
  };
}

function event(
  seq: number,
  type: string,
  visibility: RunEvent["visibility"],
  payload: RunEvent["payload"],
): RunEvent {
  return eventForRun(seq, "run_1", type, visibility, payload);
}

function eventForRun(
  seq: number,
  runId: string,
  type: string,
  visibility: RunEvent["visibility"],
  payload: RunEvent["payload"],
): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: "thread_1",
    runId,
    seq,
    type,
    category: "plan",
    visibility,
    createdAt: `2026-08-08T00:00:0${String(seq)}.000Z`,
    payload,
  };
}

function startedEvent(seq: number, runId: string, intentId: string): RunEvent {
  return eventForRun(seq, runId, "run.started", "debug", { intentId });
}

function run(id: string, status: RunRecord["status"]): RunRecord {
  return {
    id,
    threadId: "thread_1",
    agentId: "agent_1",
    status,
    startedAt: `2026-08-08T00:00:0${id === "run_current" || id === "run_recovery" ? "3" : "1"}.000Z`,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    },
  };
}

it("uses primary event fallback despite newer child activity, with sorted and reversed inputs",()=>{
 const f=versionFixture();
 const child={...startedEvent(3,"run_child","intent_child0000001"),payload:{intentId:"intent_child0000001",source:"subagent"}};
 const activity=eventForRun(4,"run_child","model.response","user",{});
 const events=[startedEvent(1,"run_1","intent_primary00001"),...f.events,child,activity];
 expect(conversationArtifacts(events,f.plans)[0]?.attemptScope).toBe("current");
 expect(conversationArtifacts([...events].reverse(),f.plans)[0]?.attemptScope).toBe("current");
 const childRecord={...run("run_child","running"),source:"subagent" as const};
 expect(conversationArtifacts(events,f.plans,6,[run("run_1","completed"),childRecord])[0]?.attemptScope).toBe("current");
 expect(conversationArtifacts(events,f.plans,6,[childRecord])[0]?.attemptScope).toBe("previous");
});
it("binds only the latest matching revision independently of artifact event insertion order",()=>{
 const first=plan();
 const old=event(2,"plan.artifact.verified","user",createPlanArtifactEventPayload(first,first.artifacts[0]!));
 const next=structuredClone(first);next.revision=4;next.artifacts[0]!.updatedAt="2026-08-08T00:00:03.000Z";next.artifacts[0]!.sha256="b".repeat(64);
 const current=event(3,"plan.artifact.verified","user",createPlanArtifactEventPayload(next,next.artifacts[0]!));
 expect(conversationArtifacts([current,old],[next])).toEqual(conversationArtifacts([old,current],[next]));
 expect(conversationArtifacts([current,old],[next])).toMatchObject([{id:current.id,planRevision:4,artifact:{sha256:"b".repeat(64)}}]);
});
