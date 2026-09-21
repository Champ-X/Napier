# Harness optimization implementation

## Final engineering closeout after user stop (2026-09-15)

The latest user instruction supersedes the earlier requirement to finish full statistics before delivery: stop test expansion, review code, and close out quickly. All paid campaign and audit watcher processes are terminal. The in-flight queue baseline was cancelled and has no final report; it is not counted as an observation. The temporary full-statistical collector and test were removed from the deliverable after exact source/hash archival. Historical plans below describe superseded activity, not authorization to restart.

A focused review covers 17 integration files. Contracts, Runtime, CLI, Server and Web typechecks all pass, and the complete Git diff whitespace check passes. No new blocking code defect was found in the reviewed boundaries; this is not an exhaustive review claim. No further model calls were made for code review. Seven product directions remain implemented as documented, and v6 stays explicitly opt-in.

The observed queue candidate behavior failure remains. Eleven paired observations and one additional failed candidate do not establish the full 30 x 3 gate or default promotion. Conservative final occupancy is CNY71.94: user-reported historical CNY20, settled CNY21.94, and CNY30 in five unresolved reservations. No commit, push, deployment, or release-attestation rewrite occurred. See [closeout evidence](artifacts/harness-rapid-closeout-2026-09-15.json) and [engineering delivery](harness-optimization-delivery.md).

## Historical implementation and statistical iterations



## Full sample with adverse outcomes (2026-09-15)

The bounded queue candidate completes its Run but fails the independent grader. Isolated, zero-model probes confirm that it accepts null and shaped plain objects despite the concrete AbortSignal contract, and may start jobs with invalid input. Its self-authored checks omit these boundaries. The original report, workload and CNY0.50 settlement remain unchanged. See [diagnosis](artifacts/bounded-queue-contract-failure-2026-09-15.json).

To honor the user's full 30-case/3-trial requirement, the new collection module (subsequently removed and archived in the final closeout) separates completion of the predetermined sample from the unchanged quality verdict. Adverse behavioral observations are collected and retained; integrity, source/model/environment, grader-evidence and spending failures still stop dispatch. A full sample containing this candidate failure cannot pass the original promotion gate. The stopping-rule amendment is explicitly recorded after observing the failure, and supports descriptive results rather than a confirmatory significance claim. Twenty-five offline checks pass, including preservation of a rejected promotion decision across a complete simulated sample.

The [continuation plan](artifacts/outcome-preserving-full-statistics-plan-2026-09-15.json) binds all 25 retained reports, 157 remaining positions, eight unused baseline reuses, the unchanged v6 source, original model/driver/task/limits and CNY100 ceiling. It begins with the original queue baseline, never a new candidate attempt. CNY65.77 is occupied at launch, including four unresolved reservations totaling CNY24. No source reset or new candidate version is introduced.

## Bounded model calls and native DeepSeek token field (v6, 2026-09-15)

`harness-model-call-budget.ts` binds an opt-in 8192 reasoning-output ceiling and SDK-supported reasoning level after prepare extensions, before compilation/capture. A detached finalizer options object and assertion reject removal/widening or reasoning changes before dispatch. Existing lower ceilings and the 2048-token short retry remain effective. This is a token limit, not a latency guarantee.

`model-provider-wire-compatibility.ts`, applied by `createModelAdapterModels`, fixes all calls to the official DeepSeek endpoint to serialize `max_tokens` without mutating the catalog model. Other endpoints are unchanged. The unmodified SDK emits `max_completion_tokens`, which the official API does not document. Historical server interpretation is unknown. This corrects the field name in the prior SDK audit without rewriting that artifact.

48 focused offline checks pass, including Agent/store/capsule flow and installed SDK pre-HTTP serialization. Compile passes; the six inherited architecture violations remain. [Validation](artifacts/bounded-thinking-offline-validation-2026-09-15.json) binds the six source changes and v6 profile. [Pilot](artifacts/bounded-thinking-pilot-plan-2026-09-15.json) freezes 5668 files and starts one necessary NDJSON pair under the unchanged 30-case/3-trial gate and cumulative budget. All old cohorts remain available; no v5 candidate qualifies v6.

Baseline: `c454a155`. Scope: implement all seven optimization directions from the
2026-09-13 design review without reducing task completion quality. **The overall
goal remains unfinished; no candidate policy has been promoted to a default.**

Latest v6 checkpoint: [eleven eligible pairs](artifacts/bounded-eleven-pair-statistics-2026-09-15.json), 24 raw observations. Candidate task completion is 11/11, baseline 8/11; both independent grader totals are 11/11. Four newly collected Runs passed the complete offline evidence audit. All 1266 source files and 32 orchestration files still match the active plan. The queue has automatically started the bounded async queue candidate. Conservative occupancy at checkpoint 4 is CNY65.27, including historical CNY20 and CNY24 retained reservations. Full acceptance remains pending.

Current v6 statistics: the inventory supplemental pair passes both Runs and independent graders with complete usage (candidate 9 calls / CNY0.35; baseline 17 calls / CNY0.44). The original failed baseline and CNY6 reservation remain unchanged. There are nine eligible pairs and twenty raw observations. The [supervised continuation](artifacts/bounded-recovered-full-statistics-plan-2026-09-15.json) now dispatches the remaining 81 original pairs, with eight unused immutable baseline reuses. The 30-case/3-trial gate and all candidate, driver, model, timeout and request policies remain frozen. At continuation start, conservative budget occupancy is CNY62.34, including historical CNY20 and four unreceipted reservations totaling CNY24. See [recovery closeout](artifacts/bounded-inventory-recovery-closeout-2026-09-15.json).

The [nine-pair raw error taxonomy](artifacts/bounded-nine-pair-tool-failures-2026-09-15.json), derived without model calls, retains the ineligible original inventory pair as well. Eligible candidate observations contain 19 tool failures, including nine patch failures; eligible baselines contain seven tool failures. Several patch errors still use legacy `unknown` classification. A later design iteration should give edit parsing, stale references and policy refusals explicit structured failure kinds and recovery instructions, then validate them against these captured failures. This is a follow-up supported by observed diagnostics, not an implemented v6 change or a reason to discard the failures. The frozen campaign continues unchanged.

## Historical v5 acceptance and earlier iterations

The following checkpoints describe their stated source epochs; current v6 progress is above and in the status document.

The user explicitly requires full statistical acceptance before unified delivery. Engineering checks do not replace the 30-case/3-trial gate. A prospective [missing-usage recovery protocol](artifacts/staged-missing-usage-recovery-protocol-2026-09-15.json) preserves all original 180 positions and reports, appends one unused NDJSON trial (trial 3), retains raw campaign failure, and forbids retiring any candidate failure or eligible failed baseline. Twenty-seven offline checks pass, including a full simulated 30-case/3-trial gate.

The supplemental v5 candidate fails before any verification or edit: Run `run_d2d2215e7ae242e19125`, 125.6 seconds, independent grader exit 1. Its complete 86,152-byte trace accompanies a semantic-progress timeout, whose configured window is 90 seconds. The baseline was never started. A collector hardcoded `trial-1/result.json` instead of the offset's `trial-4/result.json`; [offset-path handling](../scripts/harness-trial-result-path.mjs) and a read-only reconciled projection now preserve both the original collection error and the actual candidate failure. No rerun or report rewrite was used. See [closeout](artifacts/staged-recovered-ndjson-stopped-2026-09-15.json).

[Actual SDK serialization without HTTP](artifacts/staged-ndjson-sdk-budget-audit-2026-09-15.json) maps captured medium reasoning to DeepSeek-supported high. Its earlier max_tokens field label is incorrect: a new actual-SDK audit confirms max_completion_tokens 16384; see the correction above. Existing retry options serialize to thinking disabled and 2048, but the local spending gate blocked the retry after unreceipted usage. The next implementation target is a general pre-dispatch reasoning/output budget, verified through actual SDK and Agent integration before new model calls. No causal remedy is claimed yet and no watchdog is relaxed.

Current source still has nine comparable pairs plus one newly observed unpaired candidate failure, which cannot be retired by the recovery protocol. Three new financial requests add CNY0.03 settled and CNY6 reserved. Current totals: 290 requests, 287 settled for CNY9.44, three reservations for CNY18, user-reported prior CNY20, occupancy CNY47.44 and remaining CNY52.56. All paid work is stopped, with no later jobs queued. The following earlier checkpoints remain historical.

Engineering handoff: [current usage and module summary](harness-optimization-delivery.md). The latest no-model acceptance passes 129 base checks, then 19 actual native-tool checks (17 previously skipped, two overlapping) and six CLI checks. The CLI adds current v5 profile delivery through its real Agent/store entrypoint while retaining read-only permissions. All 1264 frozen runtime/contracts source files remain identical. See [bound acceptance](artifacts/harness-engineering-acceptance-2026-09-15.json). This is engineering-path evidence, not statistical qualification or release approval.

A [read-only NDJSON recovery audit](artifacts/staged-ndjson-recovery-audit-2026-09-15.json) finds ten complete usage responses for eleven provider financial requests. The following zero-usage error response belongs to the locally rejected retry, not the missing request 109. No deterministic settlement is possible from the inspected artifacts; original failure and reservation remain unchanged.

Latest frozen and tested source is `staged-verification-v1` (5658 bound files), explicit profile v5, driver v8. Its `contract-staged-v3` protocol executes the known baseline before expanding checks and grounds expected behavior in supplied specifications rather than guessed grader conventions. All v2 verification obligations and existing limits remain. Nineteen targeted checks pass, including actual Agent/store/verifier/edit integration with a scripted model; Contracts and Runtime compilation pass. Twelve prior prompt-layer combinations and both prior protocol constants are unchanged. Architecture still has six inherited violations, and the release build remains blocked by existing source-manifest drift.

Nine original-task pairs are now comparable on this unchanged runtime source, including atomic JSON Patch in addition to the prior eight cases. v17 has **nine comparable pairs, seventeen locally executed terminal Runs plus three reused original baseline observations, and 160 unstarted schedule positions**. Each case has one paired trial. Atomic Patch passes in both arms: candidate 9 requests / 241.9 seconds / CNY0.55 / zero tool failures; baseline 25 requests / 448.2 seconds / CNY0.74 / nine recovered tool failures. Only the two permitted source files change. This establishes completion of a task that stalled in older candidates, not a general or causal result.

Following the user's request for faster convergence, the unstarted BM25 pair was cancelled from the working plan; no paid job was launched or queued for it. The new [offline convergence check](../scripts/harness-campaign-convergence.mjs) uses the unchanged quality evaluator and original schedule to forecast whether remaining observations could satisfy the gate. It validates report identities, binds report hashes and rejects futile qualification dispatch without executing models. Twenty focused checks pass, including the existing quality-evaluator tests.

The [actual bound assessment](artifacts/staged-convergence-bound-assessment-2026-09-15.json) returns `remediate_before_more_model_calls` (CLI exit 2): even with all 160 unstarted positions successful, this fixed schedule can provide at most 89 comparable pairs and only 29 cases with three trials. The retained NDJSON evidence gap makes the existing 30-case/3-trial gate unreachable through unrelated new samples. Resolve original evidence or establish an auditable recovery path that preserves failures and meets the original requirements before further qualification collection. The forecast does not rewrite observations, release reservations, authorize resampling or promote defaults. Runtime source and frozen driver remain unchanged; the new checker is a separate offline planning tool.

The latest pagination candidate passes with 10 new requests, 182.8 seconds and CNY0.47; its original baseline is reused with zero new calls (original 20 requests, 326.2 seconds, CNY0.61). Each arm has one recovered tool failure. The fresh upload candidate passes with 8 requests, 117.4 seconds and CNY0.23. Its baseline uses 13 requests, 201.8 seconds and CNY0.37; code grading passes but the Run fails the old contradicted-capability guard. All usage settles, so this is an eligible failed observation. Both upload arms have zero tool failures; the baseline corrects an erroneous self-authored boundary assertion. Offline replay of four captured responses shows old-guard unavailable-capability classifications and none from the current frozen guard; it does not rewrite the failed baseline. See [upload evidence](artifacts/staged-upload-pair-2026-09-15.json), [guard replay](artifacts/staged-upload-claim-replay-2026-09-15.json) and [combined closeout](artifacts/staged-pagination-upload-final-2026-09-15.json).

Immutable baseline reuse is now exercised in the bounded launcher: it checks the original report/audit hashes and run/trial/model/protocol identity, and returns before baseline process launch, API admission or spending reservation. Nine mismatch classes reject offline. In the preceding batch, the memory and configuration candidates pass with only 7/8 new requests and CNY0.13/0.40, respectively; the two original baselines add zero calls and zero reservations. Their original paths and hashes are unchanged, no replacement baseline directories exist, and result provenance explicitly says `reused_original_baseline`. The original baselines contain 39 prior admissions; that number is provenance, not new traffic or a measured counterfactual saving. See [live reuse audit](artifacts/staged-baseline-reuse-live-final-2026-09-15.json).

The latest state-task batch adds 55 fully settled requests for CNY2.42 with no new reservation. TTL candidate/baseline both pass: 10/19 requests, 207.7/339.9 seconds, CNY0.49/0.58. Savepoints candidate passes with 10 requests, 208.8 seconds and CNY0.37; baseline code grading passes but its Run fails at 292,291/250,000 total tokens, using 16 fully settled requests, 354.8 seconds and CNY0.98. This remains a failed baseline, eligible for comparison because complete usage exists. Candidate tool failures are 1/2, baseline 2/2. See [state-task audit](artifacts/staged-state-pairs-final-2026-09-15.json).

The earlier LSP/debugger pairs pass in both arms, including every original pre-edit tool requirement. LSP candidate/baseline each use 10 requests and about 141 seconds, costing CNY0.22/0.14. Debugger candidate/baseline use 10/13 requests, 141.1/187.3 seconds, costing CNY0.18/0.16. Each Run recovers from one command-argument failure. Candidate costs are higher in those two tasks; no general efficiency gain is claimed. All 43 added provider requests settle for CNY0.70. See [tool-contract audit](artifacts/staged-toolchain-pairs-final-2026-09-15.json).

The original NDJSON candidate passes: 10 admissions, CNY0.44, 205.7 seconds, no tool failures, only the two allowed source files changed. All nine primary input capsules contain the staged protocol; real Python tests settle before edits and pass afterward, and the independent grader passes. Baseline code grading also passes, but its Run fails after the old overplanning-heading guard interrupts it. Twelve local admissions correspond to eleven provider reservations: ten settled for CNY0.35 and one missing usage receipt retains CNY6. The final local retry is blocked by the financial evidence gate. This pair remains ineligible; its original zero-comparable-pair batch and both reports are retained. Candidate success is not generalized or causal proof.

The prior v16 source retains three valid pairs (configuration, pagination and source-bound shipping memory), seven terminal observations and 173 unstarted positions. Its NDJSON candidate failed before baseline execution, motivating the new protocol; its captured trace and CNY6 reservation remain intact. In the memory pair the candidate's six actual inputs all include the current rule and reject the stale rule; baseline still receives stale memory. Both include nine irrelevant facts, so semantic selection remains limited. No prior-source candidate qualifies v17; eligible immutable baseline reports are reused only with the explicit identity bindings described above.

Starting from the user-reported CNY20 aggregate checkpoint, all 287 financial records comprise CNY9.41 settled across 285 requests and CNY12 retained for two unreceipted requests: conservative occupancy CNY41.41, remaining CNY58.59 under the unchanged CNY100 ceiling. The current atomic Patch pair adds 34 requests, all settled for CNY1.29 with no new reservation. This is not an independently retrieved provider invoice. Minimum admission spacing remains 15000 ms, all 1264 runtime/contracts source files match the freeze, and historical ledgers/reports remain unchanged. All batches are terminal with no later jobs queued; the overall objective and full gate remain unfinished. See [atomic closeout](artifacts/staged-atomic-closeout-2026-09-15.json) and [current status](harness-optimization-status.md).

A read-only [baseline reuse precheck](artifacts/staged-baseline-reuse-prequalification-2026-09-15.json) confirms three existing v16 baseline observations (configuration, pagination and memory; 59 prior admissions) match the current frozen baseline artifact, driver, recorded model identity, original task and per-case limits, environment and spending protocol. No old candidate is reusable. All three baseline reuses are now complete under explicit plans, with zero additional baseline calls or reservations. Original run/trial provenance and all failed evidence are retained and the evaluator is unchanged. Reuse is not a new observation or concurrent randomized causal comparison.

The previous tested source is frozen as `progressive-verification-v1`, retaining the
explicit `napier.current-integrated.v2` profile. Its only production-source
change from `contract-transitions-v2` is a correction to the thinking-loop
heading heuristic: eight headings alone no longer interrupt distinct reasoning;
repeated completed section bodies are required. Twenty-three focused checks and
Runtime compilation pass. A prior complete audit (2739 passed, 60 skipped)
predates these changes and is not a fresh audit of this source.

A new, prospective allowance cohort keeps this source and driver v6 frozen.
Each arm has the same 64-admission ceiling, derived from the unchanged 15-minute
Run window at a minimum fifteen-second admission interval plus four admissions
of lifecycle margin. Cadence remains serial and the cumulative ceiling remains
CNY 100. Prior twenty-cap observations remain ineligible and are not relabeled.
The source-versioned memory/shipping pair has settled successfully in both
arms. Candidate uses **7 admissions / CNY 0.10**; baseline uses **13 / CNY 0.16**.
The new cohort has **six comparable pairs and zero observed regressions**.
The debugger candidate completes the original live-inspection contract and passes
its independent grader (11 admissions / CNY 0.13). Baseline fails the code grader
and Run (15 admissions / CNY 0.18); the target remains unchanged and an unauthorized
debug driver is created. The supplemental audit stops the original batch with
`tool_contract_evidence_incomplete`; offline review establishes an observed
baseline task failure, not a candidate regression. That original stop is retained.
The LSP migration pair (indices 58/59) also passes in both arms, including its
original pre-edit reference/read requirements: candidate 11 admissions / CNY 0.22,
baseline 8 / CNY 0.13. This pair shows higher candidate request count and cost,
not an efficiency gain. The NDJSON pair also passes with complete usage evidence (candidate 16 admissions /
CNY 0.63; baseline 17 / CNY 1.04), resolving the missing current-source paired
observation for the prior correction. The TTL-cache/savepoints batch also passes in both arms: candidate/baseline
13/19 admissions and CNY 0.49/0.66 for TTL; 15/22 and CNY 0.72/0.59 for savepoints.
Fewer requests do not always mean lower cost. All twelve paired reports remain retained. The atomicity batch stopped after
index 33: candidate code grading passed, but its Run failed at 250865/250000
accounted tokens. Indices 32/37/36 never started. This is an unpaired failure,
not a successful pair or an established baseline-relative regression. The old
cohort now has 13 terminal observations and 167 unstarted jobs. No paid job is queued. The full
30-case/3-trial gate remains insufficient; no policy is promoted.

The semantic-version parsing/ordering candidate completes and passes its
independent grader: **12 admissions / CNY 0.46**. Baseline also passes the code
grader, but its Run fails after the twenty-first admission is denied by the
unchanged twenty-request cap: **20 actual admissions / CNY 0.88**. This pair is
ineligible, not a qualified success; the strict exhausted-budget rule remains
unchanged. Both original reports are retained; that historical pair is terminal.

The NDJSON corrective candidate **completes and passes its independent grader**.
Its actual output also passes the unchanged prior pending-CR diagnostic on a
same-image disposable copy. All thirteen invocation capsules contain the exact
new protocol. This is one successful candidate, not a completed quality pair:
a thinking-loop cancellation lacks terminal provider usage, so its full CNY 6
reservation remains and its budget evidence is ineligible. The baseline was
stopped after three admissions once this was detected; that historical pair is terminal. The complete 30-case/3-trial schedule remains intact.

Previous paused-epoch budget, superseded for prospective admission by the user-reported CNY20 checkpoint below: **CNY 43.08 settled conservative charges**, plus **CNY 54.00
reserved for nine unreceipted cancelled requests**, for **CNY 97.08 committed**
and **CNY 2.92 available** under the cumulative CNY 100 ceiling. There are
728 financial request records and 719 settled usage receipts. At that historical checkpoint the remainder was below the mandatory CNY 6 next-request reservation and paid work stopped. Local API admissions are tracked separately from financial reservations. The atomicity Run added 19
admissions: 18 settled for CNY 1 and one thinking-loop cancellation reserved
CNY 6. The cancellation and later token exhaustion are separate events. These
are conservative local charges, not a verified provider invoice; no historical
charge or reservation was released.

The worktree adds `request-aware-v2` via explicit profile
[`napier.current-integrated.v3`](../benchmarks/harness-profiles/current-integrated.v3.json).
Request-local budget guidance includes current remaining capacity and recent
uncached-call forecasts, and refreshes after compaction/overflow accounting.
It uses the required `workspace.run_budget` runtime-tail source and invocation
capsule binding, without synthetic user revisions or changing hard limits.
The prior v1 policy and v2 profile remain unchanged. Contracts and Runtime
compilation passed; 36 focused offline checks passed (zero failures/skips).
See [tests](artifacts/run-budget-context-offline-tests-2026-09-15.json) and
[accounting replay](artifacts/request-budget-context-offline-validation-2026-09-15.json).
This new source is frozen as `request-budget-context-v1`. Its candidate-first
atomic JSON Patch observation was operator-terminated; the baseline never started.
Seven actual input snapshots have one fresh budget source each and match preceding
accounted usage; all are working-phase snapshots. There is no terminal Run report
or independent grader result. A prior cancellation receipt arrived during shutdown,
but the last in-flight request remained reserved. Six new receipts settled for
CNY 0.55 and that last request retained CNY 6. See the [interrupted observation](artifacts/request-budget-context-interrupted-2026-09-15.json).
At that checkpoint this source had zero qualified pairs;
old-source pairs cannot qualify it. Replay proves accounting and delivery, not
improved model behavior. Thinking-loop cancellation receipt loss remains unresolved.

The worktree spending transport now refuses overlapping requests until the current
request has settled complete terminal usage. This prevents another paid retry while
a cancelled SDK stream is still unresolved. It preserves historical reservations,
raw stream bytes and hard financial/request limits. All 45 related offline checks
pass; see [validation](artifacts/spending-serialization-offline-validation-2026-09-15.json).
Driver v7 retains this transport. Its upload candidate produced no model content
or edits and was cancelled across a documented 561-second macOS sleep; one
request retained CNY 6 and the baseline was never started. The original failed
report remains [retained](artifacts/receipt-serial-upload-stop-2026-09-15.json).
Driver v8 adds a full-wake preflight and scoped caffeinate assertion before paid
admission. Fourteen offline checks pass. With the host fully awake, a fresh upload pair completed and both arms passed
their unchanged independent graders. Candidate used 11 requests / CNY 0.44 /
188.7 seconds; baseline 13 / CNY 0.40 / 215.3 seconds. All 24 requests settled.
All ten candidate primary input capsules carry correct fresh budget snapshots;
the last two entered finalization and the Run completed normally. The additional
candidate request was auxiliary memory extraction. There is one qualified pair
and 177 unstarted jobs plus one unpaired failed search candidate in this frozen cohort; no general efficiency or causal claim follows. Both scoped awake assertions from that pair were released. The search/config batch (49/48/50/51) stopped after search candidate 49 failed with semantic_stall, no edits and grader exit 1. Four local admissions yielded only three financial reservations: two settled for CNY 0.03, one cancellation retained CNY 6, and the next dispatch was refused by the transport. The baseline and configuration jobs never started; no later batch is queued. See [stopped evidence](artifacts/search-config-stopped-2026-09-15.json). See [paired evidence](artifacts/host-awake-upload-pair-2026-09-15.json),
[live budget delivery](artifacts/request-budget-context-live-delivery-2026-09-15.json), and
[host evidence](artifacts/host-awake-preflight-validation-2026-09-15.json).
Two [local HTTP tests](artifacts/provider-cancellation-http-offline-validation-2026-09-15.json)
also verify caller/watchdog cancellation through the pinned provider SDK. They
do not prove the cause of the earlier live semantic stalls or qualify task quality.

The worktree now separates resource identifiers from task instructions in
`model-harness-task-text.ts` and expands ordinary programming word forms.
It preserves explicit navigation and mixed research/coding intent. The unchanged
30-case replay corrects 15 classifications; all 62 focused offline checks and
Runtime compilation pass. Existing architecture failures remain disclosed.
This source is frozen as `resource-intent-v1` (5634 bound files) and now has one comparable BM25 pair (49/48). Candidate completed and passed code grading: 13 requests, CNY 0.67, 275.7 seconds. Baseline passed code grading but its Run failed when the old capability guard misclassified its quoted diagnostic: 22 requests, CNY 0.59, 354.8 seconds. All 35 financial requests settled. Offline replay of both rejected baseline responses establishes that quoted "No test suite found" near write-linked/repo triggers old tool-unavailability rules; the current frozen guard returns no claims on the original responses. This is not a code-grader failure or a new successful baseline Run; original results remain intact. See [replay](artifacts/resource-intent-baseline-claim-replay-2026-09-15.json). Twelve actual candidate resolutions were coding; budget-tail replay covers working, finalization and critical phases. Four newline command-argument failures recovered. No general efficiency or causal conclusion follows; see [pair](artifacts/resource-intent-search-pair-2026-09-15.json) and [delivery](artifacts/resource-intent-live-delivery-2026-09-15.json). The original atomic JSON Patch pair (33/32) stopped after candidate run_f3346b82709444f0b012 failed with semantic_stall, no edits and grader exit 1 at 124.1 seconds. Four local admissions yielded three financial reservations: two settled for CNY 0.03 and one cancelled request retains CNY 6; the fourth was refused by the transport. All four prepared resolutions are coding, with working-phase budget context; the last capsule was not dispatched to the provider. Classification repair did not eliminate the stall. Recorded 83041 reasoning bytes and 20733 chunks do not establish a false positive. Baseline never started, no later paid batch is queued, and no watchdog or quality gate was relaxed. See [stop](artifacts/resource-intent-atomic-stopped-2026-09-15.json) and [resolution](artifacts/resource-intent-atomic-resolution-2026-09-15.json). See [bounded plan](artifacts/resource-intent-bounded-plan-2026-09-15.json). Profile v3
and driver v8 are unchanged; the old upload pair cannot qualify the new source.
Misclassification is established independently, but causation of semantic stall
and cancellation receipt loss is unproven. See [offline validation](artifacts/resource-task-intent-offline-validation-2026-09-15.json).

The preceding `validation-envelope-v1` source is rejected: its eight comparable
pairs include a real NDJSON code regression. Seven earlier pairs showed no
observed regression; HTTP ETag is separately ineligible due to request-cap
exhaustion. These original observations remain immutable and do not qualify the
new source. No candidate has passed the overall quality gate.

The parent `failure-invocations-v1` completed one new real HTTP retry task and
passed its external grader. It reused the exact compatible historical baseline,
preserving that baseline's failed Run outcome and original metadata. Twelve new
requests cost a conservative **CNY 1.00**; the twelve baseline calls were not
repeated. Both distinct failures remained visible in all five subsequent inputs,
and pending contextual hints did not prevent completion. This is a retrospective
comparison, not a new independent baseline observation; the full gate remains
insufficient and 178 jobs remain unstarted.

The complete audit confirms that the two earlier capability-contract failures
are resolved by test-home isolation. It includes 26 additional assertions and
removes none relative to the preceding full report. The earlier intermittent
Workflow failure did not recur; its original evidence and unexplained cause
remain retained. After the access pair, conservative API spending was **CNY 18.04**
across 238 settled admissions. The user then increased the cumulative ceiling to
**CNY 100**, leaving **CNY 81.96 before the new Python batch**. That historical batch has settled; subsequent spending checkpoints are recorded below.

## Multiline argv contract and native OCI replay (2026-09-15)

`command-execution-input.ts` separates bounded request validation from process
execution. Literal argv accepts HT/LF/CR for program text and data; cwd and write
scopes retain strict path validation. Other prohibited ASCII controls, parameter
count/length/total bounds, deadlines, output limits, sandbox permissions and
preview-bound writes are unchanged. Command and Process schemas share these
constants, including the Python extension. Existing command-execution exports
remain compatible; four file-hash consumers import the same defining runtime
function directly instead of depending on execution. This removes the new line
and coupling violations without increasing any architecture budget.

All 74 final targeted tests pass, without failures or skips, and Runtime
compilation passes. Compact tool definitions remain under the original 1.5 KiB
combined Command/Verification and 3.25 KiB Process ceilings, including Python
extension. Six existing architecture failures remain disclosed.

Real OCI replay uses the unchanged pinned image and exact arguments from ten
historically rejected model calls against disposable copies of their final
workspaces. All ten reach the interpreter: eight programs succeed and two
preserve their own program failures. The latter are not counted as passes.
Native Node, Python and shell checks preserve line endings and literal data;
read-only write denial and managed preview/start writes are exercised. A caller
argument mutation after preview does not change executed bytes; only the
specified existing fixture file changes. The initial helper's nonexistent write
scope was correctly refused, and only its unfinished write stage was resumed.
These are native-tool observations, not new full-Agent quality samples.

No provider calls were made; the CNY 100 ledger remains 8438 fen committed,
including 4200 fen reserved across seven unreceipted cancellations, and 1562 fen
available. The current worktree is unfrozen and no policy is promoted. Semantic
stall and cancelled-request receipt loss remain unresolved. See [bound validation](artifacts/multiline-command-input-validation-2026-09-15.json),
[final tests](artifacts/multiline-command-complete-tests-2026-09-15.json), and
[OCI evidence](artifacts/multiline-command-oci-replay-2026-09-15.json).

## Frozen toolchain continuation (2026-09-14)

After the memory pair passed, a bounded batch planned only original schedule
indices 57, 56, 58 and 59: candidate/baseline Node loyalty debugging, then
candidate/baseline pricing-reference migration. Source, driver, profile, task,
grader, admission policy and CNY ledger are unchanged. The existing memory pair
is hash-bound and retained in aggregate evaluation; all 180 jobs remain listed.
The start checkpoint is CNY 45.88 committed, including CNY 12 of historical
reservations, leaving CNY 54.12. No other batch is queued.

A supplemental audit is frozen before model dispatch. For debugging it requires
actual paused observations of subtotal 2000, percentage 15 and the original wrong
discount 15 on the original source, followed by continue/cancel and termination
before the first edit. For migration it requires a complete original-source LSP
result covering both call sites, one initial layout listing, and reading all
three affected files before the first edit. It uses actual completed calls and
hash-validated model inputs; only raw tool output matching its ledger text hash
can supply debugger or reference values. Rewritten/truncated context is not used
as raw evidence. Original task and grader bytes are unchanged.

An offline negative check against both actual memory Runs confirms that successful
code editing without debugger observations cannot satisfy this tool contract.
That check makes no model call and writes only disposable audit output. During
collection, an unsuccessful candidate, incomplete tool evidence, invalid first-arm
budget evidence, or a pair/aggregate quality blocker stops remaining dispatches.
Supplemental failure does not rewrite the original grader or report verdict.

Plan: `~/.cache/napier-seven-quality/cny-deadline-bounded-core-v9/toolchain-two-pair-batch-v1/plan.json`.

The debugger pair settled on local 2026-09-15; only indices 57 and 56 ran.
Candidate inspected the original live values (2000, 15, 15), cancelled the
session, and then patched the allowed target. Baseline launched the original
source before any patch, but that launch terminated without paused values. Its
first patch created `outputs/thread_e7855660f8804824b242/debug-driver.mjs`;
subsequent paused calls refer to that driver, not to a modified `src/loyalty.js`.
The target source remains byte-identical to the fixture. The external grader
reports gold discount expected 1700, received 1985; the Run ends on no measurable
progress. All 15 baseline invocation capsules and spending rows pass offline
binding/accounting audit. Both new Runs settled all requests, adding CNY 0.31.
This preserves the baseline's adverse outcome rather than hiding it as missing
capture. Receipt: `docs/artifacts/debugger-pair-validation-2026-09-15.json`.

The original batch remains stopped. A new `lsp-pair-batch-v1/plan.json` hash-binds
that result and its clarification, retains memory/debugger observations, and
runs only the unstarted indices 58/59 under the same frozen audit and budgets.
No memory or debugger model requests are repeated.

The LSP continuation has now settled without a stop. Both original-source
reference/read-order audits pass, both independent host code graders pass, and
all 19 new admissions settle (CNY 0.35). Candidate has one recovered command
failure and takes 156965 ms; baseline has no tool failures and takes 110746 ms.
These observations do not establish a general efficiency gain. No production
source, grader or audit changes were made. Receipt:
`docs/artifacts/lsp-pair-validation-2026-09-15.json`.

A bounded NDJSON continuation dispatches only indices 5/4 after that settlement,
with the same frozen source and full retained report set. It addresses the prior
real regression and the absence of an eligible current-source pair after a
historical unreceipted cancellation. Original task/grader bytes, same-image OCI
grading, fifteen-second cadence, 64-admission insurance and CNY 100 ceiling stay
fixed. The reusable launcher accepts at most two pairs and validates the prior
result hash before dispatch; no later batch is queued.

The NDJSON pair has settled successfully on local 2026-09-15. Candidate completes
with 16 admissions / CNY 0.63 / zero tool failures; baseline completes with
17 admissions / CNY 1.04 / four recovered tool failures. Both independent same-image
OCI graders pass; only the two permitted Python files change. Fifteen candidate
invocation capsules contain the contract-transition protocol. The candidate's
pre-edit checks fail on original defects and its post-edit checks pass. All 33
new requests settle, with no new historical reservation or evidence blocker.
The aggregate reaches four comparable pairs, still below the unchanged full gate.
Receipt: `docs/artifacts/ndjson-current-pair-validation-2026-09-15.json`.

The next bounded batch runs only original unstarted TTL-LRU cache and transaction
savepoint pairs (25/24/30/31) to cover additional state-transition and failure
atomicity behavior. Source, profile, tasks and graders remain frozen; all eight
completed reports remain hash-bound. The same serial cadence and budget stops
apply; no subsequent batch is queued. For a compact current view, see
[Harness current status](harness-optimization-status.md).

The TTL/savepoints batch has now settled without a stop. All four Runs and their
independent host graders pass. TTL candidate/baseline use 13/19 admissions and
CNY 0.49/0.66, with 1/3 recovered tool failures. Savepoints candidate/baseline use
15/22 admissions and CNY 0.72/0.59, with 6/3 recovered tool failures. All 69 new
admissions settle; the four-Run batch costs CNY 2.46. The aggregate retains twelve
original reports and six comparable pairs, with no observed regression or
evidence blocker. The full 30-case/3-trial gate is still insufficient; 168 jobs
remain unstarted. No further paid batch is running or queued. Receipt:
`docs/artifacts/state-contract-pairs-validation-2026-09-15.json`.

A read-only capsule audit identifies all six savepoint-candidate command failures
as same-response Node `-e` argv containing newlines rejected by the current
argument schema. Every diagnostic matches the ledger hash; eight later commands
complete and independent grading passes. This is an observed tool-contract
limitation, not six model retries or six failed code tests. It is recorded in
`docs/artifacts/node-inline-newline-observation-2026-09-15.json`; no source or
schema change is made during the frozen campaign.

## Prospective deadline-based request allowance (2026-09-14)

The external twenty-request limit has censored two otherwise observed baseline
code outcomes (HTTP ETag and semantic-version ordering). Future sampling uses
an identical 64-request allowance for both arms: the existing fifteen-minute
Run deadline and fifteen-second cadence permit about sixty admissions during
execution, with four more of terminal lifecycle margin. This ceiling is not a
request target. Only one pair is dispatched. Every task retains its original
turn/token/time/SDK-usage limits, and the shared CNY ledger retains its CNY 100
ceiling, peak cache-split settlement and both CNY 6 historical reservations.
No old admission database is modified, no exhausted observation is qualified,
and no Runtime/profile/task/grader/evaluator code is changed.

A new empty local admission database verifies the prospective policy without
sending a model request. All frozen source, dependency, driver and task hashes
are checked before dispatch. The new cohort retains the entire 30-case/3-trial
schedule but dispatches only the memory/shipping pair. It exercises a remaining
module with current and stale source-bound memory, without repeating the
interrupted semantic-version task. Original twenty-cap receipts are retained
separately. First-arm failure or invalid budget evidence stops before baseline.

The candidate completes the memory task in seven admissions, with CNY 0.10
settled and no tool failures. Six hash-validated actual model inputs each include
the current source-bound 6000-cent rule and exclude the stale 5000-cent rule.
They also each retain nine unrelated historical facts: this is the existing
ranked fallback limitation, not evidence of perfect semantic selection. Membership
and source-version checks do not prove causal dependence on a memory fact.
Baseline also completes and passes. Its twelve actual inputs omit the current
rule and include the stale rule, while the candidate's six actual inputs always
include the current rule and exclude the stale one. Both retain nine unrelated
historical facts. The exact seed records are matched after the repository's
normal whitespace normalization; current/stale source hashes are checked against
the unchanged actual README. These context membership differences do not prove
that the model relied on a particular fact; both code outcomes pass the same
independent grader.

All actual input, workspace, source, grader and admission bindings pass audit.
The candidate has no tool failures; baseline has one recovered command failure.
Both accounting snapshots retain the same two historical reservations and every
new request settles. The first-arm budget check succeeds before baseline dispatch.
The aggregate gate reports one comparable pair, no observed regressions and no
evidence blockers, but remains insufficient with one of thirty required cases
and only its first of three trials. Nothing is promoted. Final receipt:
`docs/artifacts/deadline-memory-pair-validation-2026-09-14.json`.

Plan: `~/.cache/napier-seven-quality/cny-deadline-bounded-core-v9/plan.json`.
Policy receipt: `docs/artifacts/deadline-bounded-allowance-2026-09-14.json`.

## Progressive reasoning and transfer qualification (2026-09-14)

The previous run records an `overplanning_headings` cancellation, but its
buffered reasoning was discarded. This does not establish that the particular
historical invocation was a false positive. A separate synthetic contract
analysis proves a general defect: ten distinct obligations, with no file-path
anchors, trigger the old detector solely because they use headings. The defect
reproduces with one-character, seventeen-character and whole-text delivery.

`model-thinking-loop-detector.ts` now requires at least three repeated substantive
completed section bodies among the recent sections before using the heading
heuristic. It excludes the current incomplete streamed section. Literal and
near-paragraph repetition, low novelty, anchored reasoning, terminal recovery,
retry limits and budget exhaustion retain their existing checks. The old stalled
planning example remains detected. Runtime integration with a faux provider
executes the original file-listing call and completes without an extra retry.
There are 23 passing targeted checks across four files, plus Runtime compilation;
no real-model calls were used for this diagnosis or correction.

Source freeze `/tmp/napier-harness-progressive-verification-v1` binds 5042
production source/dist/profile files and the targeted test sources. Driver v6
binds the shared scheduler's first-arm budget check. The new plan retains the
exact 30 cases and three trials, dispatching only one pair on the previously
unstarted semantic-version task. A real task is necessary to assess model choices
and independent behavior after the generic guard correction; this is not a retry
of the successful NDJSON task. Prior observations do not qualify the new source.

Offline evidence: `docs/artifacts/progressive-thinking-offline-validation-2026-09-14.json`.
Plan: `~/.cache/napier-seven-quality/cny-progressive-verification-core-v8/plan.json`.

The pair has settled with **zero comparable pairs** and an unchanged request-cap
blocker. Candidate completes and passes the independent original host grader;
baseline passes the same grader but exhausts its twenty-call external allowance
before completing delivery. Candidate's eleven and baseline's twenty-one input
capsules pass hash/binding audit. The final baseline capsule is prepared but
unserved and is not a twenty-first billed request. Both changed workspaces and
grader bytes match their reported hashes. Actual admission intervals meet the
fifteen-second minimum. Candidate has no thinking-loop detection. Baseline records one `semantic_stall` retry; its original evidence is retained.

Candidate has three recovered argument-validation failures caused by multiline
code in a single-line argv slot. All three remain invocation-scoped invalid-input
failures. Their original arguments and diagnostic hashes are retained. No tool
permission or validation rule was relaxed to hide them. The current protocol is
present in every candidate model input. Candidate spends CNY 0.46 and baseline
CNY 0.88 under cache-aware peak settlement; all new request reservations settle.
The two historical unreceipted reservations remain encumbered at CNY 12 total.
No cost/latency gain or full non-regression qualification is inferred from this
ineligible pair. Receipt:
`docs/artifacts/progressive-verification-transfer-validation-2026-09-14.json`.

## Contract-transition corrective experiment (2026-09-14)

`contract-transitions-v2` is an explicit protocol version in
`packages/contracts/src/harness-experiments.ts`, selected in
`packages/runtime/src/agent-prompt-layers.ts` and validated by
`packages/runtime/src/harness-policy-profile.ts`. Its text in
`packages/runtime/src/contract-verification-protocol.ts` derives checks from the
user's contract: state before/after a call, rejection timing, partial work,
observable effects and behavior after failure. It explicitly forbids inventing
eager validation, poisoning, atomicity or retryability absent a requirement.
It contains no task-specific NDJSON hints or grader content.

The seventeen targeted checks cover stable prompt delivery, unchanged v1/preset
bindings, pre-edit ordering, actual Node/Python repair and SQLite reopening with
input export. Architecture checking retains the same six known violations; no
limit was raised. The freeze binds 5042 source/dist/profile files. The frozen
plan retains original task, fixture and grader bytes, and dispatches only the
first pair of its 180-job schedule. New driver v5 uses cache-aware settlement;
its first real task also supplies accounting verification, avoiding a separate
billing probe. A failed candidate stops before baseline, with no repeated-until-
pass loop or default promotion.

Plan: `~/.cache/napier-seven-quality/cny-contract-transitions-core-v7/plan.json`.
Offline receipt: `docs/artifacts/contract-transitions-offline-validation-2026-09-14.json`.

The candidate uses fourteen admissions: thirteen settle for CNY 0.65; one
thinking-loop cancellation retains CNY 6.00 with no terminal usage. The failure
is recorded as `overplanning_headings`; its byte-based usage estimate is not used
to release the reservation. Run completion and external grading pass. Seven
completed Python command calls and thirteen model capsules pass read-only audit.
Actual post-edit checks include invalid pending CR, double CR and chunk-boundary
validation. The unchanged diagnostic verifies immediate rejection, subsequent
failed-state behavior and valid split CRLF without editing the original output.
Self-authored checks remain distinct from independent grading.

The bounded launcher checked candidate task success before baseline dispatch,
but omitted the first arm's budget-evidence eligibility check. Baseline therefore
started unnecessarily and was stopped after three admissions: two settled for
CNY 0.03 and one retains CNY 6.00. The original partial reports and reservations
are retained. The pair has zero comparable observations and is not promoted.

`scripts/harness-paired-schedule.mjs` now checks the existing request/spending
eligibility validator before dispatching a first arm's counterpart. It preserves
the complete-pair quality evaluator and its unchanged 30-case/3-trial minimum.
Twenty-one focused scheduler/CLI checks pass. Offline replay of this exact actual
candidate report stops after one simulated dispatch and leaves 179 jobs unstarted;
no model call or report mutation is involved. Future collection must use this
shared scheduler guard; the old frozen launcher is retained as historical evidence.
Receipt: `docs/artifacts/contract-transitions-corrective-validation-2026-09-14.json`.

## NDJSON regression and forward-only spending settlement (2026-09-14)

The preceding `validation-envelope-v1` candidate is **rejected for a real external-behavior regression**.
NDJSON baseline passes the independent grader but its Run fails; candidate
declares completion while failing the grader. The evaluator retains the baseline's
passing code outcome and correctly reports the regression rather than hiding it
behind two unsuccessful task outcomes. Eight pairs are comparable, including this
regression; HTTP ETag remains separately ineligible due to request-cap exhaustion.
No paid task was running or queued at that rejection checkpoint.

Baseline uses **13 admissions / CNY 1.79**; candidate uses **16 / CNY 1.49**.
Thirteen baseline and fifteen candidate capsules pass audit. A read-only same-image
diagnostic reproduces the original failure on pending invalid CR bytes, including
CR split across calls. Baseline immediately rejects and remains failed; candidate
delays rejection. Normal split CRLF framing passes both. Original code, scores,
input capsules and task/grader bytes remain unchanged. Receipt:
`docs/artifacts/ndjson-current-candidate-regression-2026-09-14.json`.

At settlement the shared ledger records **CNY 31.60 / 404 admissions**, no
outstanding reservations, leaving **CNY 68.40**. The independent HTTP budget
blocker remains unresolved. Its strict qualification rule was not relaxed. The
next candidate needs a general contract-verification improvement for validation
timing, early returns and state after failure; editing the generated task output
would not repair or qualify the Harness.

Separately, budget settlement now supports an explicit provider-cache split.
Official current peak CNY rates are 0.04/M cached input, 2/M uncached input and
8/M output. Reservation remains CNY 6 per request, and the cumulative ceiling
remains CNY 100. Discount requires integer hit/miss counts summing exactly to the
provider's total prompt tokens. Missing, malformed or inconsistent splits retain
full peak input pricing; incomplete overall usage retains the entire reservation.
The transport forwards original stream bytes unchanged and stores each new
settlement's token split and accounting mode. SDK USD prices and local prefix
similarity are not used for charges.

Fifty-four offline checks pass. An additional migration probe on a disposable
copy of the actual legacy database preserves all 238 historical rows and the
original backup. After both live NDJSON processes exited, the actual ledger was
backed up and migrated transactionally; all 404 old charges, prior spending and
ceiling remain unchanged. Only future requests can receive cache-aware settlement.
A stale/unsettled boundary is rejected. Exact accounting policies must match
within a pair; only the precision of the same official peak tariff may differ
between settled pairs, with no cost attribution across accounting modes.
Receipts: `docs/artifacts/cache-aware-spending-offline-validation-2026-09-14.json`
and `docs/artifacts/cache-aware-spending-live-migration-2026-09-14.json`.

Driver `/tmp/napier-cny-sandbox-quality-driver-v5` binds this change. Older drivers
remain immutable and must not be used with the migrated ledger. Runtime source
has not changed in this stage. The new charging path has offline SSE/SQLite
validation; it will be inspected on the next necessary real-model task instead
of spending on a separate billing-only smoke test.

## Current collection stop and bounded continuation (2026-09-14)

The HTTP ETag pair does **not** add an eighth comparable pair. Candidate completes
and passes (12 admissions / CNY 0.93); baseline passes the independent code grader
but fails when its 21st API admission is denied by the unchanged twenty-request
cap (20 admissions / CNY 1.60). The last admitted turn records a completed milestone;
no final user delivery is observed. Twenty-one baseline invocation capsules include
the final prepared but unserved request; they are not twenty-one billed calls.
All original statuses, reports and the request-budget evidence blocker remain intact.

Both automatic continuations stopped before NDJSON or queue/semver dispatch.
At that stop, cumulative spending is **CNY 28.32 / 375 settled admissions**, no
outstanding reservation, leaving **CNY 71.68** under the CNY 100 ceiling. Seven
pairs remain comparable; the aggregate gate now also retains the HTTP budget
blocker. Receipt: `docs/artifacts/etag-request-cap-stop-2026-09-14.json`.

After this read-only diagnosis, a separate frozen plan starts only the previously
unstarted NDJSON pair: two serial Runs, at most forty admissions, the unchanged
fifteen-second interval and twenty-request Run cap. It preserves all sixteen
original reports and the exact existing evidence blocker in aggregate evaluation.
That blocker is allowed only for continued data collection; it is neither suppressed
nor qualified. Any new blocker, regression or unsuccessful candidate still stops
collection. Overall promotion remains blocked. No paid HTTP retry or Runtime
change was made, and no further batch is queued. Plan:
`~/.cache/napier-seven-quality/cny-validation-envelope-core-v6/ndjson-after-cap-v1/plan.json`.

## Budget increase and continuous bounded collection (2026-09-14)

The user's instruction to accelerate and raise the budget to CNY 100 is recorded
in `docs/artifacts/api-budget-increase-100cny-2026-09-14.json`. The existing ledger
retains every request and prior charge; only its cumulative ceiling changes.
A read-only pre-increase backup and an authorization row preserve that change.
The original `budget-50cny-2026-09-14.sqlite` filename is retained so old and new
drivers cannot accidentally use separate accounting ledgers.

Collection now automatically proceeds between two predeclared Python pairs:
booking calendar v2 and safe CSV export v1. At most four new Runs/eighty admissions
may be dispatched, serially, with twenty admissions per Run and at least thirty
seconds between admissions. Each pair is evaluated before the next begins; a
regression, invalid evidence or unsuccessful candidate stops collection. This
removes manual scheduling/report-writing delays while retaining low-frequency
model use. No further pair is authorized by this batch plan.

The evaluator allows a user-authorized cumulative ceiling increase between
settled pairs while requiring identical pricing and matching allowances within
each pair; exhausted observations remain ineligible. Thirty-four focused checks
pass. This changes no model-dispatch or Runtime code and does not rewrite the
six original observations. The new evaluator is frozen in
`/tmp/napier-cny-sandbox-quality-driver-v3`. The batch plan is
`~/.cache/napier-seven-quality/cny-validation-envelope-core-v6/python-two-pair-batch-v1/plan.json`.
The 30-case/3-trial quality gate and all 180 scheduled jobs remain intact.

The booking pair has now settled: candidate **13 admissions / CNY 1.20**, baseline
**11 admissions / CNY 1.20**. Both Runs and same-image OCI graders pass. Twelve
candidate and ten baseline input capsules pass audit. The candidate performs
eleven completed calls with an explicit Python runtime, including verification;
the baseline uses the legacy command surface. Two candidate command failures
remain recorded, followed by successful completion. Only the two allowed Python
source files change. The gate now has four comparable pairs; cumulative spending
at that checkpoint is **CNY 20.44, 262 settled admissions**. CSV comparison subsequently settled successfully. Receipt: `docs/artifacts/current-booking-pair-validation-2026-09-14.json`.

To implement the user's acceleration request, subsequent pairs use a **15-second
minimum admission interval (at most four admissions/minute)** with concurrency
one and the unchanged twenty-request Run cap. The active booking/CSV batch keeps
its original thirty-second policy. The evaluator requires the same cadence in
both arms of a pair and retains a fixed request cap across the campaign; it
does not attribute latency/cache/cost across different cadences. Thirty-eight
focused checks pass, and the stronger evaluator is frozen as
`/tmp/napier-cny-sandbox-quality-driver-v4`. A bounded continuation waits for the
verified current process to exit and for the batch to pass before dispatching
only inventory-event projection and weighted-expense allocation. This adds no
overlapping model calls or repeated completed observations. Receipt:
`docs/artifacts/bounded-cadence-acceleration-2026-09-14.json`.

A read-only inventory examined 281 historical baseline reports. Apart from the
three baselines already retained here, only one old queue baseline matches the
current source/driver/limits, and its oracle version differs. It is not directly
reused or counted. Other baseline mismatches remain recorded in
`~/.cache/napier-seven-quality/cny-validation-envelope-core-v6/retained-baseline-compatibility-inventory.json`.

## CSV result and next bounded batch (2026-09-14)

CSV baseline and candidate both complete and pass the same-image OCI grader.
Baseline uses **15 admissions / CNY 0.89**; candidate uses **14 / CNY 0.67**.
Fourteen baseline and thirteen candidate capsules pass read-only audit, with
valid request bindings and unchanged grader workspaces. The candidate executes
four completed calls with explicit Python runtime. The campaign retains five
comparable pairs, no observed regressions, and an insufficient-evidence verdict.
At batch settlement the ledger records **CNY 22.00 / 291 admissions**, with no
outstanding reservation. Receipt: `docs/artifacts/current-csv-pair-validation-2026-09-14.json`.

The conditional continuation passed its admission checks and started the frozen
inventory/expense batch. Inventory candidate completes and passes, using fifteen
admissions / CNY 0.90; fourteen capsules pass audit. Its baseline subsequently completes and passes with fifteen admissions / CNY 1.12.
Six comparable pairs now remain free of observed regressions or evidence blockers;
spending at that pair settlement is CNY 24.02 / 321 admissions. Receipt:
`docs/artifacts/current-inventory-pair-validation-2026-09-14.json`. Expense allocation
subsequently passes both arms and its supplemental checks, as recorded below.
All new admissions use the planned fifteen-second minimum interval, concurrency
one and the existing shared CNY 100 ceiling. The two arms share the same cadence and OCI grader identity.

The next bounded continuation is admitted in
`~/.cache/napier-seven-quality/cny-validation-envelope-core-v6/mixed-pairs-after-fast-v2-admission.json`.
It waits for the exact current batch process to exit and for successful pairs,
valid evidence and settled spending before dispatching only HTTP ETag/preconditions
and incremental NDJSON, in original schedule order. At most four new Runs/eighty
admissions use the same fifteen-second serial policy and cumulative CNY 100 ledger.
The existing host/OCI grader selection remains unchanged for each task. No other
future dispatch is queued.

## Expense supplemental contract check (2026-09-14)

Contract review found that the original expense oracle compares Python dictionaries
for equality without checking the required participant-ID iteration order. A
separate supplemental oracle checks that explicit ordering requirement, unchanged
input dictionaries, and input validation for zero totals. It adds no new task
requirements and leaves the frozen original grader, prompts and fixtures unchanged.

Four offline checks pass: the reference passes both graders; three mutations
(unsorted output, boolean capacities, missing ID validation) pass the original
grader and fail the supplement. Both Agent reports were absent when the oracle
was hash-frozen, before either output was inspected. Receipt:
`docs/artifacts/expense-supplemental-oracle-validation-2026-09-14.json`.

The next waiting continuation was replaced before any dispatch. Its v2 gate
checks disposable copies of both settled expense outputs in the same image and
requires a passing candidate, complete observations and no supplemental regression
before any next model request. Original reports remain unchanged. This additional
evidence consumes no model requests and does not increase the comparable-pair count.

The expense pair now passes both the original OCI graders and the supplemental
checks. Baseline: **12 admissions / CNY 1.07**; candidate: **10 / CNY 0.70**.
Eleven baseline and nine candidate capsules pass audit, including exact request
bindings and unchanged workspaces. Three candidate completed calls use explicit
Python runtime. Original and supplemental image identities match. At settlement
the ledger records **CNY 25.79 / 343 admissions**, zero outstanding reservations,
and seven comparable pairs with no observed regression or evidence blocker.
Receipt: `docs/artifacts/current-expense-pair-validation-2026-09-14.json`.

The v2 continuation passed the supplemental gate, rechecked dependencies and
started HTTP ETag/preconditions candidate, followed by its baseline and the
NDJSON pair if all preceding gates pass. A further bounded continuation now waits for that exact batch to settle before
dispatching queue v4 and semantic-version ordering, at most four Runs/eighty
admissions with the same serial fifteen-second policy. Its immutable admission
is `/Users/champ/.cache/napier-seven-quality/cny-validation-envelope-core-v6/queue-semver-after-mixed-admission.json`. Original old queue evidence
remains separate because its oracle, cadence and spending ceiling differ.

## HTTP ETag candidate failure-context audit (2026-09-14)

The current candidate completes and passes with **12 admissions / CNY 0.93**,
changing only `src/etag.mjs` and `src/preconditions.mjs`. Eleven capsules pass
audit; verification fails before repair and passes afterward. Both actual edits
use replacement; no unified-diff adoption is inferred. The baseline is in progress.

Three recovered tool failures remain recorded: one SDK input rejection and two
Plan artifact transition rejections with identical diagnostic bytes but different
call IDs. Every subsequent model input retains each preceding rejection separately;
three inputs contain all three attempts. Independent checks against actual start/
completion bindings confirm that later same-tool completion is distinguished from
matching-input completion. This is observed failure-context behavior on a settled
Run, not additional model trials or compaction/recovery evidence. Receipt:
`docs/artifacts/etag-failure-context-validation-2026-09-14.json`.

## Explicit full-profile CLI entry (2026-09-14)

Normal one-shot CLI now accepts `--harness-profile-file <path>`, mutually
exclusive with `--harness-policy`. Relative paths resolve from the invocation
directory. The loader reads at most 64 KiB from a regular file, honors cancellation,
and validates the exact loaded profile and nested policy hashes before Run creation
or model dispatch. Existing capability presets remain independent. Runtime source
and existing policy presets are unchanged.

The checked-in `benchmarks/harness-profiles/current-integrated.v1.json` is byte-
identical to the frozen candidate profile, including its original ID and hash.
For explicit experimental use, after building the CLI:

```sh
node apps/cli/dist/index.js run --workspace /path/to/project \
  --prompt 'Inspect the project' --preset read_only \
  --harness-profile-file benchmarks/harness-profiles/current-integrated.v1.json
```

Five focused offline checks pass through the real CLI with a faux provider,
including exact profile binding, unchanged write restrictions, tampered-profile
rejection before model use, path handling, size bounds and cancellation. CLI
compilation passes; architecture retains the same six existing violations and
adds none in CLI. Receipt: `docs/artifacts/cli-explicit-harness-profile-validation-2026-09-14.json`.
This makes the complete candidate explicitly usable; its quality gate remains
unqualified and no default is promoted. No paid model check was needed.

## Current HTTP result and grader environment repair (2026-09-14)

The access-rule pair completed under the original frozen driver and source.
The baseline uses seventeen admissions (CNY 1.63), passes the original and
supplemental code graders, but its Run fails in the final capability-claim guard.
The candidate uses fourteen admissions (CNY 1.29), completes and passes both
graders, with zero tool failures and failed-before/passed-after verification.
Seventeen baseline and thirteen candidate input capsules and model-request
bindings pass audit; only `src/access.mjs` and `src/resource.mjs` change. The
measured admission intervals remain at least thirty seconds. The original gate
now retains three comparable pairs and 174 unstarted jobs; overall evidence is
still insufficient. These observations do not establish an efficiency gain.

Offline replay of the baseline's original text reproduces three old classifier
denials; the current frozen classifier returns no denial for each. This is a
diagnostic on retained text, not a rewritten baseline outcome or new model Run.
Exact receipts: `docs/artifacts/validation-envelope-access-pair-validation-2026-09-14.json`.

Before either report existed, supplemental access oracle v3 was frozen. Seven
offline checks pass. It detects locale-based ID sorting, sparse validation
arrays, dot identifiers and empty action lists missed by v2. It also checks
path/wildcard boundaries, subject/action/resource conjunction, all-rule
validation, independent outputs and unchanged input objects. The v3 reference
corrects its own sparse-array omission using `Array.from(a).every(p)`; original
v2 files and all Agent-facing fixture/prompt bytes remain unchanged. Supplemental
results are separate from the original reports and add no observations. Both
retained outputs pass v3 in disposable, hash-verified workspace copies.

For future Python pairs, a separate frozen driver and immutable schedule
amendment preserve the full 180-job schedule. Only 42 unstarted jobs across the
seven Python tasks switch to OCI grading; booking alone selects the corrected
v2 oracle, with identical fixture, prompt, reference and acceptance fields.
All completed observations and the original schedule remain untouched. Both
baseline and candidate adapters resolve identical image-bound Node/Python
configurations. This preparation made no model request and dispatches nothing
automatically. Evidence: `docs/artifacts/python-grading-schedule-amendment-2026-09-14.json`.

The shared quality evaluator now also retains independent code outcomes: a
passing baseline grader followed by a failed candidate grader counts as a
regression even when the baseline Run failed for another reason. A candidate
that fails its grader cannot qualify, and incomplete grader observations are
ineligible. This avoids hiding code regressions behind two failed Run statuses.
Fifty-seven focused tests pass across campaign evaluation, paired stopping,
suite CLI, sandbox grading and edit calibration. Reassessment of the six current
reports leaves their original three-pair verdict unchanged. The Runtime and
model-dispatch code are unchanged; the stronger evaluator is frozen separately
in `/tmp/napier-cny-sandbox-quality-driver-v2`, with an immutable v2 Python plan
revision. Evidence: `docs/artifacts/independent-behavior-quality-gate-2026-09-14.json`.

The current HTTP candidate `run_cbe63ac7511f44c0abf2` completes, passes the
external grader and has zero tool failures. Fourteen admissions cost a
conservative CNY 1.39; the measured minimum admission interval is 30,001 ms.
Thirteen input capsules and the model-request evidence bindings pass audit.
Only `src/retry-after.mjs` and `src/retry.mjs` change. Verification fails before
repair and passes afterward. The original baseline observation is reused with
its failed Run outcome and metadata unchanged; no new baseline calls were made.
The predecessor candidate also passed, but remains a separate diagnostic
observation. At phase 2, core v6 had two comparable pairs, no newly observed regression or
evidence blocker, and **176 unstarted jobs**. The 30-case/3-trial gate remains
`insufficient_evidence`; this is not an efficiency or overall quality claim.

Before dispatching Python cases, deterministic pre-review found that Agent OCI
uses Python 3.13.5 while the external host oracle invokes Python 3.9.6. A
disposable booking reference using native `datetime.fromisoformat(text)` for
`Z` timestamps passes the unchanged oracle in OCI and fails it on the host.
The original reference passes both; an incorrect conflict implementation fails
both. Original benchmark files remain unchanged. No model calls were needed.

`scripts/harness-sandbox-grader.mjs` adds explicit OCI grading through the same
adapter as the Agent. Campaign and suite CLIs accept
`--grader-mode sandbox --grader-runtimes node,python`. Runtime binding preflight
runs before model dispatch. The later oracle gets a read-only workspace and no
network capability, with bounded output and execution timeout. Actual OCI
checks confirm writes fail and all visible network interfaces are loopback.
There is no host-interpreter fallback. The timeout starts after sandbox launch;
this does not establish a total preflight/launch deadline or general service/
virtual-environment support. Legacy CLI behavior remains explicit host grading
by default for compatibility; future Python pairs must select sandbox grading.

Configuration and execution receipts bind interpreter/image identities, Run,
oracle, observed final workspace, result and reported output. The quality
evaluator rejects missing/altered receipts, incomplete execution, workspace
mutation, mixed host/OCI grading and mismatched interpreter configurations.
Adverse task outcomes remain visible when grading evidence is ineligible.
Forty-three focused checks pass across five files, including real suite CLI
argument forwarding with synthetic campaign children. The OCI probes are
deterministic grader checks, not Agent Runs or additional quality observations.

Booking oracle v2 separately removes unspecified exception-class requirements
from three validations. It still requires `ValueError` for naive timestamps and
duplicate reservation IDs, and still requires every invalid input to be rejected.
Seven offline checks pass, covering correct alternatives and wrong behavior.
Prompt, fixture, public tests and reference bytes are unchanged. This revision
has not replaced the frozen v6 case or been counted as a new task.

The Runtime source and frozen paid-test driver remain unchanged. The new root
campaign driver has different source/helper hashes and has not run a paid
campaign. Future use requires an explicit frozen plan; existing observations
must not be silently relabeled or regraded into its results. Supporting receipts:
`docs/artifacts/validation-envelope-http-pair-validation-2026-09-14.json` and
`docs/artifacts/sandbox-grader-environment-validation-2026-09-14.json`.

Earlier real-model evidence belongs to the `history-linear-v1` source:
the HTTP retry pair in
`~/.cache/napier-seven-quality/cny-history-linear-core-v5`: both outputs pass the
external grader, but only the candidate Run completes. The baseline's capability
guard falsely rejects its runner-compatibility explanation. The candidate uses
more requests and costs more in this observation; no efficiency improvement is
claimed. The v5 gate retains one pair and 178 unstarted jobs. Earlier queue evidence is
`~/.cache/napier-seven-quality/cny-history-linear-core-v3`: the first paired queue
trial compares original `c454a155` with frozen `history-linear-v1`. The candidate
passes and the baseline fails; correcting an unspecified validation-error class
in a new v4 oracle leaves those outcomes unchanged on offline regrade. The v3
reports retain one comparable pair, with 178 of the 180 planned jobs unstarted.
That earlier source also passed one synthetic-history/real-model branch component.
Neither result qualifies the overall composition. The prior core collection,
`core-corrected-corpus-suite-v2` against `stream-timing-v1`, remains stopped and
rejected after a queue regression, retaining 57 observations and 27 comparable
pairs. Earlier `visible-order-v1` and `contract-type-v1` pairs remain separate;
all adverse results are retained below. Earlier optional durable pre-edit ordering was introduced
in `durable-pre-edit-v1`, derived from frozen `contract-first-v1`. The parent
static verification protocol was rejected on queue
trial 2 against `memory-grouping-final-v1`. The complete
contract and protocol were present in the failed Agent's context; sparse-array
validation still failed. Grouped memory v3 resolves the observed bilingual-rule
omission in paired components; selective-v2 remains rejected. Earlier core/mixed-
service regressions remain unresolved at whole-composition scope; no current
composition is quality-qualified.

## Current-source rollout pair and complete offline Runtime audit (2026-09-14)

The `validation-envelope-v1` source and original `c454a155` baseline ran one
rollout-dependency-planning pair under the frozen driver and core v6 inputs.
Both dependency graphs were inventoried before dispatch and remained stable.
Execution was serial, capped at twenty API requests per Run and spaced at least
thirty seconds between admissions. Only this pair was launched; the full
thirty-case/three-trial schedule retains 178 unstarted jobs.

| Arm | Requests | Conservative CNY | External grade | Run/task | Tool failures |
| --- | ---: | ---: | --- | --- | ---: |
| Original baseline | 16 | 1.02 | Pass | Completed/pass | 1 |
| Current candidate | 11 | 0.67 | Pass | Completed/pass | 0 |

Fifteen baseline and ten candidate Agent-input capsules pass audit. Final
workspace/grader hashes match; both arms change only `src/graph.mjs` and
`src/rollout.mjs`, using replacement edits. The candidate sees the pre-edit rule
in its first input, records failed verification before repair and passed
verification afterward, and has no pre-edit policy block. The baseline's single
invalid-input `run_command` failure is retained. The candidate's observed lower
request count, elapsed time and cost are not a causal efficiency qualification.

Contract review also exposed missing oracle coverage for explicitly required JS
lexicographic ordering and the upper parallelism bound. The supplemental rollout
v3 oracle adds mixed-case Map/dependency/wave ordering, independent merged waves,
fresh results, empty/invalid/sparse graphs and option boundaries. Eight offline
checks pass, including four wrong implementations that pass v2 but fail v3.
Task prompts, fixtures, public checks and references remain byte-identical.
The new oracle was frozen before the candidate result existed or its output was
inspected. Both retained outputs pass v3 in separate disposable copies with a
sanitized environment. Original v2 reports/workspaces stay unchanged, and these
regrades do not add a task, Run or independent paired trial. They use host Node;
no additional isolation claim is made.

One complete offline Runtime audit ran on an isolated copy whose source, dist
and tests exactly match the frozen candidate. The 22 existing support files were
verified. It finishes **2739 passed, 0 failed, 60 skipped in 540 files**. Relative
to the preceding complete report, the only common status changes are the two
capability-contract failures becoming passes; there are 26 new assertions and
none removed. The earlier unexplained Workflow failure remains recorded even
though it passes in this run. Source/support inventories still match afterward.
The serial paid campaign used separate processes/workspaces concurrently, so
the offline suite's elapsed time is not a controlled performance measurement.

No production source changed in this phase. The real pair adds **27 requests and
CNY 1.69**; the full suite and supplemental grader checks add no model calls.
Shared spending is **CNY 13.73 of 50**, with **CNY 36.27 remaining**. The core v6
gate has one comparable pair, no observed regression, `insufficient_evidence`
and `promotionReady: false`. Broad quality, actual preferred-format adoption,
long-task recall and cache-cost attribution remain unproven.

Evidence: [`validation-envelope-rollout-pair-validation-2026-09-14.json`](artifacts/validation-envelope-rollout-pair-validation-2026-09-14.json),
[`validation-envelope-full-runtime-validation-2026-09-14.json`](artifacts/validation-envelope-full-runtime-validation-2026-09-14.json).

## SDK validation failures and retrospective HTTP comparison (2026-09-14)

After offline compaction/recovery verification, one necessary real candidate Run
checked whether invocation-bound failure context disrupted actual task completion.
The frozen driver, task, grader, limits and admission policy match the existing
HTTP baseline. Its original report/hash, twelve capsules, final workspace and
grader were re-audited, and a fresh dependency inventory matches its recorded
dependency hash. The original report was referenced unchanged: no new baseline
Run, relabeled trial, changed outcome or additional independent sample is claimed.
The candidate received its own fresh dependency inventory.

| Observation | New requests | Conservative CNY | External grade | Run/task |
| --- | ---: | ---: | --- | --- |
| Retained original baseline | 0 (12 historically) | 0 new (1.27 historically) | Pass | Failed |
| `failure-invocations-v1` candidate | 12 | 1.00 | Pass | Completed/pass |

The candidate's eleven Agent-input capsules and model-request evidence bindings
pass audit. It changes only the two allowed source files, uses replacement edits,
and verifies failed before repair then passed afterward. Both `run_command`
failures remain in all five later inputs. A later successful call with different
arguments marks same-tool completion without claiming an identical retry or
clearing either original review hint. The Agent still completes. Minimum request
spacing is at least 30 seconds, with no overlapping Runs or denied admission.
All 166 cumulative admissions are settled; shared spending is CNY 12.04 of 50.
The observed lower cost/time does not establish a causal efficiency improvement.

The retained failures also expose a separate general bug: both are SDK argument
validation failures for multiline JavaScript in control-character-free argv, yet
the second was classified as `rate_limited`. Its echoed script contains `429`.
`tool-failure-legacy-fallback.ts` previously scanned that code as diagnostic text.
It now recognizes the SDK validation header/diagnostic before keyword inference,
preserving the original bounded diagnostic hash. The exact captured second error
changes from `rate_limited/retry_after` to `invalid_input/correct_input` on offline
replay. Original Run records remain untouched.

Eight initial regression assertions fail before the fix. The final selection
passes 26 tests in six files, including actual installed-SDK validation, ordinary
failure classifications, declared failure semantics, replay/context bounds and
the real-Runtime/faux-provider compaction recovery test. Runtime compilation
passes. Architecture retains the same six existing violations with no raised
budget. Only this classifier source differs in the new `validation-envelope-v1`
freeze. The successful paid Run belongs to its parent source; it does not qualify
this changed source, and no further API calls were made for the deterministic fix.

Evidence: [`failure-invocations-http-retained-baseline-validation-2026-09-14.json`](artifacts/failure-invocations-http-retained-baseline-validation-2026-09-14.json),
[`tool-failure-validation-envelope-validation-2026-09-14.json`](artifacts/tool-failure-validation-envelope-validation-2026-09-14.json).

## Validation-error oracle corrections (2026-09-14)

Read-only contract review found three additional graders requiring `TypeError`
where the task only requires rejection: rollout options, duplicate access-rule
IDs/principal groups, and supplying a current ETag for a nonexistent resource.
New v2 case versions remove only those unspecified matchers. Graph/path/header
errors explicitly documented as `TypeError` retain that requirement. The shipping
grader is unchanged: its fixture already throws `TypeError` and its prompt asks
to preserve input validation.

Nineteen offline checks pass. Contract-conforming `TypeError`, `RangeError` and
`Error` variants now pass only at the unspecified boundaries; accepting invalid
inputs and changing explicitly required error types still fail. Fixtures, public
checks, prompts and reference implementations are byte-identical. Core suite v6
keeps thirty tasks and rejects grader-version aliases as distinct tasks. Original
graders/reports remain intact; no old model result was regraded. The HTTP
observation used its already-frozen v5 inputs. These corrections required
zero model calls. Evidence:
[`validation-error-oracles-v2-validation-2026-09-14.json`](artifacts/validation-error-oracles-v2-validation-2026-09-14.json).

## Invocation-bound failures in working state (2026-09-14)

The added `task-failure-compaction-recovery.test.ts` now exercises the actual
Runtime and durable store with a scripted provider. Two different missing-file
reads remain visible after provider overflow and real compaction, even when the
checkpoint summary falsely says they were resolved. After budget pause, reopening
the store and constructing a fresh Runtime retains those records. Making only
`a.txt` available and reading it again clears only its matching review hint;
`b.txt` remains pending. Recovery executes exactly one tool call, has no rejected
tool events, and leaves the original Run ledger byte-identical. Both Runs pass
model-request evidence binding validation.

The budget-rejected invocation emits both `tool.blocked` and `tool.failed`.
The projection conservatively retains both records; their count must not be
reported as two separate executed calls. This test explicitly checks both,
rather than discarding them from the recovery expectations. Initial fixture
failures are retained in the receipt. The final additional test passes with no
production change; all Runtime/Contracts source and dist inventories still match
`failure-invocations-v1`. The test itself is newer than that immutable snapshot.
This is same-process store reopening, not an OS crash test, and the scripted
provider supplies no real-model quality evidence. Zero API calls were needed.
Evidence: [`task-failure-compaction-recovery-validation-2026-09-14.json`](artifacts/task-failure-compaction-recovery-validation-2026-09-14.json).

The retained HTTP candidate exposed two failures of `update_plan_artifact`.
Reviewing its actual ledger prefixes found a general projection defect: the
per-tool map kept only the second failure. Once the first artifact was recorded
`produced`, all failure-review hints disappeared although the second artifact
was still `expected`. This does not rewrite the completed Run's outcome; it is a
counterexample in the derived state delivered during task execution/compaction.

`task-tool-failures.ts` now preserves each rejected invocation. A later same-tool
completion is recorded separately from a matching-input completion. Only a unique
earlier `tool.started` binding for the same thread/Run/tool/call ID supplies an
input hash; a later completed call with the same bound tool/input can clear that
attempt's review hint. Missing, conflicting, duplicated, late or cross-Run-borrowed
bindings cannot do so. Genuine same-thread recovery can match a new bound call to
an earlier source Run's failed input. No call is replayed and no task success or
permission is inferred. Each pending index consumes an attempt at most once.

`task-working-state.ts` keeps the last twelve rejected attempts while disclosing
the omitted count. `agent-working-state-context.ts` delivers individual call IDs
and both completion observations, with guidance that rejected attempts are context
and do not create extra work obligations. Different corrected arguments are not
silently treated as an exact retry; their original failure remains review context.

Seven initial regression assertions failed on the parent code. The final selection
passes **36 tests in seven files**, including twelve focused failure tests plus
working-state, plan-revision/snapshot, query provenance, ordinary follow-up and
branch-control integration. Runtime compilation and formatting pass. Architecture
still has six existing violations with no new ones or increased limits. The full
Runtime suite was not repeated and its original intermittent Workflow failure
remains unresolved. All test/live credentials were removed for the final selection.

Offline projection of the same retained ledger prefixes now reports two rejected
attempts and two pending reviews both immediately after the failures and after the
unrelated `produced` completion (previously one/one then one/zero). Source, compiled
dist and tests are frozen at `/tmp/napier-harness-failure-invocations-v1`; only three
Runtime source files differ from the parent. Profile policy and profile-file hash
are unchanged. External dependencies remain linked; an inherited dependency
preflight receipt was not copied as evidence for the new snapshot.

This fix made **zero API calls**. Shared spending remains **CNY 11.04 committed,
38.96 remaining**, with 154 settled requests and no outstanding reservation.
Parent real-model pairs do not qualify this changed source and the full seven-
module quality goal remains unfinished. Evidence:
[`task-failure-invocation-projection-validation-2026-09-14.json`](artifacts/task-failure-invocation-projection-validation-2026-09-14.json).

## Current-source HTTP retry pair and oracle correction (2026-09-14)

The next paid pair was preceded by ten offline oracle checks. The original HTTP
retry grader required `TypeError` for every invalid `retryDelay` option although
the README names that error class only for the helper's invalid clock.
`http-retry-policy-v2` removes the unspecified matcher, keeps rejection mandatory,
and adds explicit helper-clock and validation-before-nonretryable-status checks.
The task prompt, public checks, initial workspace and reference stay byte-identical.
Mutants confirm that early status return, null on invalid options, retry before
server permission, unsafe backoff and a wrong helper-clock error remain rejected.
`harness-core-quality-suite-v5.json` still contains thirty tasks; versions cannot
count as independent tasks. Old graders and reports remain intact.

The frozen `history-linear-v1` candidate and original `c454a155` baseline then ran
one HTTP retry pair serially, using the existing frozen driver. All 26 admissions
were at least 30,000 ms apart and within the per-Run limit of twenty. No other
case was launched; the complete 180-job schedule retains 178 not-started jobs.

| Arm | Requests | Conservative CNY | External grade | Run/task result | Tool failures |
| --- | ---: | ---: | --- | --- | ---: |
| Original baseline | 12 | 1.27 | Pass | Failed | 0 |
| Current candidate | 14 | 1.46 | Pass | Completed/pass | 2 |

The baseline final text describes a write-linked runner's inability to host a
test-file format. Its old proximity-based capability guard misattributes that
statement to editing availability, redirects once, then fails the Run. Offline
replay of both retained final drafts reproduces the old editing-capability claim;
the frozen current guard returns no unavailable-capability claim for either.
The baseline failure remains failed in the report despite its correct code.

All twelve baseline and thirteen candidate Agent-input capsules were audited.
The candidate sees the pre-edit rule in its first input, has zero pre-edit policy
blocks, and records `verify_workspace` failed before repair then passed after
repair. Its two failures are attempts to move Plan artifacts directly from
`expected` to `verified`; these remain in the evidence. Both arms edit only the
two allowed source files and use replacement edits. Workspace, grader, source,
build and frozen input hashes match after execution. Dependencies remain linked.
The candidate is slower and costs more in this trial; this is no unified-diff,
cache-cost or general performance qualification.

The pair adds **CNY 2.73**, leaving cumulative **CNY 11.04 committed and 38.96
remaining**. All 154 shared-ledger requests are settled, with no outstanding
reservation or denied admission. The v5 gate is `insufficient_evidence`, with one
comparable pair, no observed regression and `promotionReady: false`. Earlier v3
queue evidence remains separate. A read-only screen of 265 retained baseline
reports found only the current v3 queue reference itself matches the current
runtime/driver/model/limit/admission-policy metadata; other historical reports
cannot be pooled unchanged to avoid fresh baseline calls. This is a compatibility
screen, not regrading or new task-quality evidence.

Receipts: [`retry-oracle-v2-validation-2026-09-14.json`](artifacts/retry-oracle-v2-validation-2026-09-14.json),
[`cny-current-http-retry-pair-validation-2026-09-14.json`](artifacts/cny-current-http-retry-pair-validation-2026-09-14.json)
and [`retained-baseline-compatibility-screen-2026-09-14.json`](artifacts/retained-baseline-compatibility-screen-2026-09-14.json).

## API spending constraint (2026-09-14)

**Latest authorization: finish within a total CNY 50 budget; choose request counts
and frequency autonomously.** This replaces the earlier pending-budget question
and single-probe stop instruction, while preserving the prohibition on unnecessary
large/high-frequency tests. The durable budget is
`~/.cache/napier-seven-quality/budget-50cny-2026-09-14.sqlite`. It includes a
conservative CNY 1.10 allocation for the preceding 14-request probe, leaving
CNY 48.90 before newly authorized model work. This allocation is not a claim about
the prior provider bill.

Fresh official pricing review exposed drift in the SDK catalog: `deepseek-v4-flash`
is now a provider alias for DeepSeek-V4.1-Flash, with peak CNY prices of 2/million
uncached input tokens and 8/million output tokens. The old SDK quotes $0.14/$0.28
per million, so its persisted USD estimates must not enforce this budget or be
presented as current billing. Pricing source:
https://api-docs.deepseek.com/zh-cn/quick_start/pricing (checked 2026-09-14).
The requested alias remains unchanged for continuity; the serving-version mapping
comes from the dated official documentation, not an independently pinned model.

`harness-spending-budget.mjs` and `harness-spending-transport.mjs` add shared CNY
admission in integer fen. A request reserves CNY 6 before dispatch, exceeding the
documented worst-case Flash charge at 1M input and 384K output tokens. Only complete
terminal stream usage replaces that reserve with a rounded-up peak-price estimate,
treating all input as uncached. Missing/invalid usage, cancellation and transport
failure retain the full reserve across process restart. Unknown models/endpoints,
multiple completions and output limits beyond the priced model are refused.
SQLite transactions serialize reservations across clients. This protects the test
budget under the checked provider prices and limits; it does not control unrelated
account users or promise that the provider will never change its prices.

The existing shared request cap and minimum interval remain active. Campaign and
suite accept `--spending-budget`; schema-8 reports bind before/after snapshots and
the evaluator refuses absent, incomplete or denied spending evidence. Fourteen
focused budget/admission tests passed (five new spending tests and nine existing
request-guard tests affected by the integration). The updated contract guidance
also passed its two prompt-binding tests and Runtime compilation. No full suite
was repeated.

### Completed targeted comparisons

Seven serial real Agent Runs have finished: **84 API admissions, all task graders
passed, CNY 4.45 new conservative charges**. Including the prior CNY 1.10
allocation, the shared ledger commits **CNY 5.55**, leaving **CNY 44.45**.
All 84 requests are settled; no reservation or denied admission remains.
Each Run allowed at most 20 requests. The recorded global minimum admission
interval is **30,000 ms**; the shortest cross-campaign interval is **46,523 ms**.
These amounts are conservative budget accounting, not a provider invoice.

| Task / source | Requests | Conservative CNY | External grade | Tool failures |
| --- | ---: | ---: | --- | ---: |
| Queue / contract-type candidate | 12 | 0.97 | Pass | 2 |
| Queue / original baseline | 17 | 1.39 | Pass | 1 |
| Memory shipping / contract-type candidate | 7 | 0.17 | Pass | 0 |
| Memory shipping / original baseline | 8 | 0.19 | Pass | 1 |
| Python affected tests / contract-type candidate | 14 | 0.48 | Pass | 1 |
| Python affected tests / original baseline | 15 | 0.87 | Pass | 0 |
| Python affected tests / latest visible-order candidate | 11 | 0.38 | Pass | 0 |

The immutable execution driver is `/tmp/napier-cny-budget-driver-v1`. All seven
plans' driver inventories still match, and all reports retain stable source,
build, dependency and valid context evidence. Only allowed source files changed.
At the close of these seven Runs, workspace Runtime/Contracts source matched
`/tmp/napier-harness-visible-order-v1`; the later query-source change is recorded below.
External dependencies remain shared links rather than a hermetic snapshot.

`contract-type-v1` adds only general guidance about required concrete types/formats,
invalid lookalikes and unsupported compatibility assumptions relative to
`container-visibility-v1`; it contains no task answer or grader knowledge. Both
queue arms pass the enhanced `bounded-async-queue-v2` grader and four supplemental
boundary checks. Actual edits used replacement, so this comparison does not show
unified-diff adoption. Memory selection uses `sqlite-fts5-grouped-v3`, projects ten
facts and excludes one stale source fact. This case contains no duplicate/source-
boosting opportunities and does not qualify broad semantic recall or grouping.

The first Python candidate exposed an avoidable policy block: it was not told
before editing that the active policy requires a settled
`verify_workspace(kind=test)` attempt. `pre-edit-verification.ts` now exports the
existing availability predicate; `agent-tool-preflight.ts` and the effective-
capabilities prompt share it. The prompt explains ordering, settled-check reuse,
and why `run_command` checks do not satisfy this policy. Read-only or unavailable
verifier contexts omit the rule. Enforcement remains unchanged, including the
fact that a failed/denied attempt does not establish task correctness.

Hash-validated invocation capsules confirm the latest candidate sees the rule in
its **first model input**, with zero pre-edit policy blocks versus one in its
parent. It first calls Python verification with `target="test_shipping.py"`, then
uses `affectedBy=["shipping.py"]`; both complete successfully and the latter selects
one test. Independent Python and Node behavior checks pass. Its eleven requests
versus fourteen for the parent and fifteen for the original baseline are single-
trial observations, not a general performance or causal improvement claim.

The pre-edit/capabilities checks passed **16 tests across three files**; Runtime
compilation passed. Architecture retains **seven existing violations and no new
ones**. One focused paired-spending-policy test also passed. No full suite was
repeated after these changes; the previously recorded full Runtime results belong
to the earlier frozen source, as identified below.

The parent has **three cases with one comparable pair each**, and the latest
visible-order candidate has **one case with one comparable pair**. Their gates
are preserved separately as `insufficient_evidence`, `promotionReady: false`.
The unchanged requirement is **30 cases × three paired trials**. Parent results
are not pooled into the latest source's qualification. Earlier regressions remain
retained, and the overall quality goal is unfinished. No further paired campaign
has been scheduled; remaining budget alone is not a reason to repeat passing work.

Sanitized reports, audit hashes, monetary snapshots and separate gates:
[`cny-budgeted-targeted-validation-2026-09-14.json`](artifacts/cny-budgeted-targeted-validation-2026-09-14.json).
The earlier queue-only receipt is preserved at
[`cny-budgeted-queue-comparison-2026-09-14.json`](artifacts/cny-budgeted-queue-comparison-2026-09-14.json).

### Queue oracle correction and corpus v3, offline only

`bounded-async-queue-v3` corrects the frozen grader's `settleJob(nonfunction)`
assertion to accept either synchronous TypeError or Promise rejection, as the
unchanged contract permits. An async assertion wrapper applies only to this
helper; `runJobs` still must return a Promise. The fixture, prompt and reference
are byte-identical to v2. Historical v1/v2 graders and reports remain unchanged.

Ten focused grader tests pass: both permitted helper validation modes are
accepted; defective input, rejected result records, the wrong error type,
undefined returns, synchronous queue validation, sparse-array omission and
AbortSignal duck typing remain rejected. Six retained real-model outputs were
regraded in disposable copies with v2 and v3; the correction changes none of their
v2 results. The three older candidate outputs and the pre-budget probe fail both;
the newly budgeted queue pair passes both. One older trial previously accepted by
v1 additionally fails the stronger null-signal check. This is an offline
reassessment of existing output, not a fresh observation or a rewritten result.

`harness-core-quality-suite-v3.json` replaces only the queue version in the prior
30-task corpus. Two additional offline tests confirm the complete suite snapshots
successfully, still contains thirty tasks and one queue case, and rejects a suite
that tries to count v2 and v3 as separate tasks. No old suite or quality gate is
modified; no broad paid campaign was launched. Runtime source is unchanged from
`visible-order-v1`, and the shared conservative budget remains CNY 5.55 committed,
CNY 44.45 remaining, with zero new API calls for this work.

Evidence and unchanged-output hashes:
[`queue-oracle-v3-validation-2026-09-14.json`](artifacts/queue-oracle-v3-validation-2026-09-14.json).

## Latest full Runtime audit and unresolved Workflow failure (2026-09-14)

The diagnostic-only complete rerun subsequently finished with **2711 passed,
2 failed and 60 skipped across the same 537 files**. Its only assertion-status
change from the preceding full run is the Workflow test returning to passing.
Runtime/Contracts production source, dist and support files remain frozen; the
test tree differs only by the diagnostic assertion. No further whole-suite repeat
was launched, and this pass does not establish a root cause for the earlier
Workflow failure.

The two persistent capability failures were reproduced without a model call.
`os.homedir()` exposed the installed user `frontend-design` Skill: an empty
workspace selected `user_standard` rather than the bundled source, changing the
projection hash; the fixture containing project Skills produced the expected
fail-closed `skill_ambiguous` result for the same name. Both tests now mock only
the home-directory lookup to a fresh temporary directory per test. The real Skill
scanner, bundled assets, expected hash and readiness assertions remain intact.
All **26 tests across the two affected files pass**. After extracting the common
local Skill/runtime fixture, the changed file alone passed again (these repeated
checks are not additional distinct evidence). Its length is now 997 lines, so
the architecture audit retains **six existing violations**, down from seven,
without raising budgets. Production behavior and source are unchanged.

The latest complete report retains its two failures; focused passes do not rewrite
that report into a full-suite pass. This follow-up made **zero API calls** and
leaves the overall quality gate unqualified. Receipts:
[`history-linear-diagnostic-full-runtime-validation-2026-09-14.json`](artifacts/history-linear-diagnostic-full-runtime-validation-2026-09-14.json)
and [`capability-contract-home-isolation-validation-2026-09-14.json`](artifacts/capability-contract-home-isolation-validation-2026-09-14.json).

### Preceding full-run failure and bounded reproductions

An isolated source-test copy of `history-linear-v1` completed the full Runtime
suite with **2710 passed, 3 failed and 60 skipped across 537 files**. Relative to
the hash-validated previous full report, there are 25 new test names and one common
status change from passing to failing. Two failures are the already recorded
capability-contract checks. The third is Workflow revision-pinning/output-reuse
validation, whose expected final output was absent. **This full suite is not green,
and the additional failure is unresolved.**

The first setup attempt executed no assertions because the minimal runtime freeze
lacked a root TypeScript base configuration. A second complete attempt passed 2693
and failed 20 with missing Skill/example fixtures. The final complete attempt added
22 tracked support files to the isolated tree. Production Runtime/Contracts source
and dist remained equal to the frozen source throughout; support-file hashes were
verified unchanged. Both incomplete setup attempts and the final full failure are
retained. Keys, live opt-ins, tokens, secrets and NODE_OPTIONS were removed from the
test environment. External dependencies remain shared links.

The additional Workflow assertion passes when selected alone (one passed), and
both workflow-runtime/workflow-experiments files pass together (62 passed) when
repeating the concurrent-file combination observed in the full run. These reruns
do not erase the failure or prove a harmless cause. Its duration was about 893 ms,
so the evidence does not support blaming the five-second node timeout. The test
assertion now includes the typed Workflow result in its failure message so a future
occurrence can expose node status and diagnostics; no expectation or timeout was
relaxed. The diagnostic source used in both reproductions matches the workspace
change. No new model calls were made for the full audit or this investigation.

Evidence: [`history-linear-full-runtime-validation-2026-09-14.json`](artifacts/history-linear-full-runtime-validation-2026-09-14.json)
and [`workflow-full-suite-failure-triage-2026-09-14.json`](artifacts/workflow-full-suite-failure-triage-2026-09-14.json).

## Current-source first queue pair and oracle v4 (2026-09-14)

The new frozen driver `/tmp/napier-cny-paired-quality-driver-v1` and an immutable
30-task/three-trial schedule bind original `c454a155` and `history-linear-v1`.
Only the first prioritized queue pair was dispatched. Baseline and candidate used
16 and 11 requests respectively, capped at 20 each and spaced at least 30 seconds.
The baseline costs CNY 1.10 and the candidate CNY 1.02 under conservative accounting.
**Cumulative spending is CNY 8.31; CNY 41.69 remains.** All 128 budget-ledger requests
are settled, with no outstanding reservation. This is not a provider invoice.

The candidate passes the external queue grader and changes only the two permitted
source files. The baseline fails, despite reporting completion. Its first reported
failure exposed an oracle defect: the README does not require a particular error
class for `runJobs` validation, but v3 rejected its `RangeError` for out-of-range
concurrency. `settleJob(nonfunction)` explicitly requires `TypeError`.

`bounded-async-queue-v4` removes only the five unspecified `runJobs` error-class
matchers. It retains Promise rejection, full validation before any dispatch,
sparse-array rejection, real AbortSignal validation and the explicit helper error
type. Fixture, prompt and reference are byte-identical to v3. Core suite v4 still
contains exactly 30 tasks; v3/v4 aliases cannot count as independent cases.
**21 offline oracle/corpus checks pass**, including accepted Error/RangeError
variants and rejected synchronous queue validation, sparse-array omission, null
signal acceptance, signal duck typing and the wrong helper error type.

Regrading disposable copies of the actual outputs with v4 leaves the task outcomes
unchanged. The baseline starts two jobs before rejecting a sparse array and starts
one job with a null signal instead of rejecting it. The candidate rejects both
before starting any job. All original v3 reports, ledgers and frozen inputs remain
unchanged. This offline correction is not a fresh model trial or a second queue
case, and no paid rerun was made for it.

Hash-validated invocation capsules and final workspace inventories pass auditing.
The candidate sees the active pre-edit rule on its first model input, triggers no
pre-edit policy block, and performs a failed initial workspace verification followed
by a successful post-edit verification. The baseline makes no `verify_workspace`
call. Both arms use replacement editing, so this supplies no unified-diff adoption
evidence. Their two and four command-tool failures remain recorded. Fewer candidate
requests in one pair establish no general performance or cost improvement.

The preserved v3 gate reports one comparable pair and no candidate regression,
`insufficient_evidence`, `promotionReady: false`. The remaining 178 scheduled jobs
are unstarted; no further paid job is running or scheduled. The latest complete
Runtime offline audit is recorded separately. The overall quality goal is unfinished.

Evidence: [`cny-current-core-queue-pair-validation-2026-09-14.json`](artifacts/cny-current-core-queue-pair-validation-2026-09-14.json).

## Pairwise quality stopping and spending preflight (2026-09-14)

The suite runner now defaults to `--schedule-mode paired-stop --concurrency 1`.
It schedules one baseline/candidate pair at a time, collects trial rounds across
the full corpus, and alternates the first arm by case and round. The repeatable
`--prioritize-case CASE_ID` option moves known failures first without deleting any
task or trial; unknown or duplicate IDs are rejected. Legacy batching remains an
explicit `--schedule-mode batch` choice. The registered live command includes the
shared CNY ledger.

After each complete pair, the existing evaluator decides whether to continue.
Its new `evidenceBlockers` field separates missing sample volume from invalid
source, environment, dependency, input or budget evidence. A regression or invalid
pair stops subsequent jobs; sample insufficiency alone does not. Child failure,
missing/mismatched reports and cancellation also stop collection. Before launching
a child, the suite checks both remaining API admissions and the shared CNY ledger's
600-fen reservation requirement. Transport-level monetary admission remains the
final spending guard. No limits or quality criteria were relaxed.

Campaign `--trial-offset` assigns the actual trial number before execution. Each
scheduled trial has a unique output path and report identity; the scheduler never
renumbers failed observations. Per-job `checkpoint-N.json` receipts preserve
settled outcomes and stop reasons. The final suite receipt retains missing and
`not_started` jobs, the original 30-case/three-trial gate and monetary snapshots.
These checkpoints support auditing; automatic resume/retry is not implemented.

**63 distinct offline tests passed**, including four actual CLI runs with a
synthetic child campaign in a disposable copy. They cover complete small-sample
collection without promotion, early regression, prioritized regression, and CNY
preflight refusal without launching a campaign. Earlier zero-request tests still
retain all 180 missing observations and frozen profiles. A final four-test CLI
rerun validates the added monetary snapshots. No real model or credential was used
in these synthetic CLI tests, and they establish no Agent task-success claim.

An offline replay of the 57 immutable reports from the rejected
`core-corrected-corpus-suite-v2` collection exercises the actual evaluator. Default
pair order detects the first queue regression after 20 reports and leaves 160
planned jobs unstarted. Prioritizing that known failing case detects it after two
reports and leaves 178 unstarted. The old failure and false-completion finding
remain intact. This is a replay of previously observed outcomes, not a causal
prediction of outcomes or money saved under another real execution order.

This tranche makes **zero new API calls**. Cumulative conservative spending stays
at **CNY 6.19**, with **CNY 43.81 remaining** and no reservation outstanding.
Runtime/Contracts and candidate policies are unchanged; no fresh paid comparison
has been added. Architecture retains the seven previously recorded violations.
The seven-module goal remains unfinished and no policy is promoted.

Evidence: [`paired-quality-stop-validation-2026-09-14.json`](artifacts/paired-quality-stop-validation-2026-09-14.json).

## Branch-history real-model component probe (2026-09-14)

**Current cumulative conservative spending is CNY 6.19, leaving CNY 43.81 of the
CNY 50 authorization.** One new serial Run used 17 requests and CNY 0.64; all 101
new-budget requests are settled, with no reserved or denied request. The earlier
CNY 1.10 allocation remains included. These figures are budget accounting, not a
provider invoice. The new Run was capped at 20 requests, with at least 30,000 ms
between admissions (observed minimum 30,000 ms). No paid follow-up is scheduled.

The frozen `history-linear-v1` candidate completed
`benchmarks/harness-components/branch-shipping-history-v1`, changing only
`src/shipping.js`. All **36 independent behavior checks** pass: the branch's 7000-
cent inclusive threshold, both membership categories, surrounding boundaries,
and invalid non-integer/negative inputs. The grader rejects the README's 6000-
cent rule and the original thread's later 9000-cent rule. It was introduced into
the workspace only after the Agent stopped. Two tool failures, followed by
successful calls, remain recorded; the Run made 19 tool calls.

The new campaign option `--branch-history-fixture` uses real LocalStore
queue/delivery and `createThreadBranch` APIs to seed **synthetic prior user/control
history only**. It creates no prior assistant answer or tool result and claims no
prior real-model task success. A later source-thread amendment is deliberately
outside the branch cutoff. All 16 hash-validated Agent invocation capsules contain
the inherited amendment and exclude the later source-thread amendment. All 16
memory-query receipts retain local copied-history provenance. The source and
copied branch ledgers remain byte-equivalent under their recorded event hashes.
This is a branch continuation probe, not process interruption/recovery acceptance.

The invocation audit finds no `verify_workspace` call or pre-edit guidance in this
fixture; command-based checks and the independent grader establish its behavior.
It supplies no evidence about adoption of affected-test selection or the active
pre-edit policy. Runtime context, source/build identity, serving identity and
before/after dependency checks pass. Fresh driver
`/tmp/napier-cny-branch-driver-v1` and the private plan bind the exact inputs; the
old paid driver is unchanged. External dependencies are still linked, not hermetic.

Offline validation passed **31 distinct checks** across the new branch fixture,
campaign evidence, CNY spending and request-admission tests. The branch tests use
real Store/branch APIs with a scripted provider and test both control modes,
foreign-source contamination, ledger mutation and missing query receipts. An
oracle test accepts a correct implementation and rejects five defective variants.
The campaign evaluator and failure exporter reject component reports as ordinary
qualification evidence. A separate offline pre-fix snapshot comparison failed
before its scripted Agent response; its generic provider error alone does not
diagnose the internal exception. No paid baseline was purchased for that component.

Runtime/Contracts source and builds are unchanged in this tranche. Architecture
retains the same seven previously recorded violations. No full Runtime suite was
repeated. This component is explicitly `qualifyingEvidence: false`, is not an
additional independent shipping task, and cannot be pooled with historical paired
Runs. The unchanged **30 cases × three paired trials** gate remains
`insufficient_evidence`, `promotionReady: false`; the seven-module quality goal is
unfinished and no policy was promoted.

Sanitized evidence:
[`branch-history-paid-component-validation-2026-09-14.json`](artifacts/branch-history-paid-component-validation-2026-09-14.json).

## Long-thread query projection cost (2026-09-14)

`projectTaskRequirementRevisions` filtered the entire event array once for every
Run before decoding control lifecycles. Current source groups events once, keeping
first-seen Run order and each Run's original event order. The control decoder and
requirement retention are unchanged; the grouping step no longer scales as the
product of event count and Run count.

A CPU-only comparison against frozen `branch-history-v2` uses identical synthetic
thread histories with valid production-generated queue/delivery payloads. Each size
has one warm-up and five measured iterations. Query text and complete receipt hashes
match exactly across both implementations; inputs remain unchanged.

| Runs | Events | Parent median ms | Current median ms |
| ---: | ---: | ---: | ---: |
| 40 | 1,600 | 0.923 | 0.738 |
| 400 | 16,000 | 18.529 | 5.005 |
| 1,000 | 40,000 | 113.692 | 11.578 |

These are local projection measurements, not end-to-end speed or API-cost claims.
They exclude SQLite reads, FTS retrieval, model inference, network time and heap-use
measurement. Complete large-thread performance and task quality remain unqualified.

**26 targeted checks passed**, including new checks for interleaved Runs sharing a
control ID and rejection of a delivery backed only by another Run's queued request.
Runtime compilation passes; architecture retains the same seven existing violations
with none added. No full suite or paid model comparison was repeated for this
output-preserving refactor. Only `task-requirement-revisions.ts` differs in Runtime
source from its parent; source/build/tests are frozen as
`/tmp/napier-harness-history-linear-v1`. Budget remains CNY 5.55 committed and
CNY 44.45 remaining. Evidence:
[`task-history-linear-grouping-validation-2026-09-14.json`](artifacts/task-history-linear-grouping-validation-2026-09-14.json).

## Inherited branch-control history compatibility (2026-09-14)

Production `createThreadBranch` preserves user payload bytes, including original
steering/follow-up control IDs and hashes, but does not replay their queue/delivery
events. Two actual scripted-model AgentRuntime continuations of these branches
failed under current-Run delivery validation. The original source fixture first
used the demo model, which correctly rejects controls; reproduction used an
explicit local faux-model identity after correcting that fixture.

`task-branch-history.ts` now recognizes inherited local user history from a completed
branch Run with one matching `branch.created` record and a positive source cutoff.
Copied control IDs, modes and text hashes are checked; missing/duplicate/mismatched
markers, tampered bodies and mixed active control events are rejected. No source
thread is reread, no control is requeued and neither ledger is rewritten. Passive
context/compaction receipts may be appended after completion; these are excluded
from copied-message counts and never become user instructions.

Requirement projections and memory-query receipts explicitly bind branch-copy
provenance. The original control mode is not represented as a new delivery in the
current Run. Working-state evidence includes the branch marker in its source hash,
and prompts label copied requests as inherited conversation. Current Run controls
continue to require valid queue and delivery evidence. Running/failed branch Runs
receive no history exemption. Existing branch files and their immutable payloads
remain unchanged, so this works for the retained copy format as well as new branches.

**36 distinct checks passed**: 32 boundary/requirement/working-state checks, two
actual branch-control AgentRuntime checks and two existing multi-turn/compaction
integrations. Both steering and follow-up branches now complete; tests verify that
source and copied ledgers remain unchanged. Runtime compilation passes. One newly
introduced complexity violation was corrected by separating live-control metadata
selection; the architecture audit again contains only the seven pre-existing
violations, with no limit increase. Overlapping affected checks were repeated after
that refactor and the passive-context handling; no full suite was repeated.

Final source/build/tests are frozen as `/tmp/napier-harness-branch-history-v2`.
The earlier `branch-history-v1` snapshot is retained separately and predates the
passive-context receipt allowance. No real-model API was called, and no broader
quality gate or default was promoted. Shared conservative spending remains
CNY 5.55, leaving CNY 44.45. Large-thread projection cost and whole-composition
quality qualification remain open. Evidence:
[`branch-control-history-validation-2026-09-14.json`](artifacts/branch-control-history-validation-2026-09-14.json).

## Thread-memory boundaries and actual compaction integration (2026-09-14)

A follow-up compatibility audit found that recovery ancestry alone omits previous
ordinary turns: a new user Run can say “continue using that rule” without a
`parentRunId`. The current query now uses validated user/workflow events from the
current thread's local Run history. Working-state tool/verification evidence stays
restricted to the current Run and its explicit recovery ancestors; an unrelated
prior Run's failed tool does not become current unfinished work.

`workingStateRunLineage` stops at a validated positive `branchFromSeq` boundary.
A branch Run's copied local messages are available, while its foreign-thread
source parent is not traversed. Two focused checks failed before these changes:
prior-turn query provenance was missing and branch recovery threw a missing-parent
error. Both pass after the correction. This does not change the earlier rejection
of an ordinary recovery parent from another thread.

**19 distinct targeted checks passed**: sixteen boundary/working-state checks,
one actual AgentRuntime multi-turn/branch test, one actual overflow/compaction test,
and one inherited-policy manual recovery test. The multi-turn test completes three
scripted-model Runs using real SQLite histories and `createThreadBranch`; all
three model inputs retain the required reviewed fact, and the branch input excludes
a marker added to the source thread after its cutoff. The overflow test performs
one actual runtime compaction, keeps the original and delivered steering event IDs
in subsequent memory queries, and completes three tools without replay. These are
local scripted-model integrations, not new paid task-success observations.

Runtime compilation passes; architecture retains seven existing violations with
none added. The complete Runtime suite was not repeated. Current source/dist/tests
and Contracts are frozen at `/tmp/napier-harness-thread-memory-v1`, with a fresh
freeze receipt and corrected Runtime/Contracts dependency aliases. Four Runtime
source files differ from the latest paid `visible-order-v1` snapshot. Other package
links and inherited scripts are not a hermetic or newly qualified driver.

The tested branch uses ordinary user messages. Source inspection separately shows
that historical branch copying retains steering control fields without copying
control-delivery events; compatibility of those copies was still unverified at this checkpoint and is
addressed by the subsequent correction above.
Very large thread-history projection cost also remains unmeasured. These gaps and
the unchanged broad quality gate remain open. No model API was invoked; shared
budget is still CNY 5.55 committed / CNY 44.45 remaining. Evidence:
[`thread-memory-boundary-validation-2026-09-14.json`](artifacts/thread-memory-boundary-validation-2026-09-14.json).

## Task-memory query provenance, offline implementation (2026-09-14)

`agent-memory-context.ts` previously derived each invocation's search query from
the last eight transcript messages with `role=user`. Runtime retry and continuation
hints can share that role; repeated hints or a compacted transcript can therefore
remove the original task from retrieval. A deterministic budget-pressure case
reproduces an omitted integer-cent constraint without changing its reviewed status
or file freshness. The first roomier diagnostic retained the fact; omission was
reproduced once competing facts filled the existing context budget.

`task-memory-query.ts` now derives the production invocation query from persisted
user/workflow events in the validated same-thread Run recovery lineage. It reuses
`projectTaskRequirementRevisions` to retain the original request and recent actual
amendments, and validates control-message delivery before accepting an amendment.
Runtime continuation prompts, queued controls and foreign-thread events cannot
supply query text. `agent-invocation-context.ts` uses one event snapshot for working
state and memory; memory-only policies also resolve the recovery lineage. Missing
durable user/workflow input produces an empty query rather than elevating an
unbound summary. Existing authorized-fact filtering and ranked fallback remain.

Invocation `context.memory` events retain query source event IDs, Run IDs,
instruction revision, query-text hash and projection truncation. This is retrieval
provenance, not authority for a new instruction or proof of task completion.
The 6000-character memory budget, ranking/grouping rules and freshness checks are
unchanged. The bounded requirement projection and 64-term query cap remain limits;
this does not establish arbitrary long-task or cross-language recall.

Compiled parent/current invocation-preparation comparison uses the same thirteen
synthetic approved facts and no provider. Both retain the required fact for the
initial request, producing identical text. After twelve runtime hints, or with a
simulated compacted transcript containing only a hint, the parent omits the fact
and current source retains it. Parent output is 5919 characters; current is 5634,
both within 6000. These are local character measurements, not token/cost gains or
an executed model-compaction lifecycle.

**52 distinct targeted checks passed**: 45 memory checks, five requirement-revision
checks and two complete scripted-model AgentRuntime Node/Python flows. The latter
exercise real file edits, test processes, SQLite events and invocation capsules,
and assert query provenance against actual user events. Runtime compilation passes;
architecture retains the same seven violations with none added. A malformed queued
control fixture was corrected using the production payload builder; delivery
validation was preserved. No full suite or real-model test was run for this change.

At this earlier query-provenance checkpoint, three Runtime source files differed
from `visible-order-v1`; the later thread-boundary update is recorded above. Existing paid
comparisons remain evidence for their original snapshots, not for this later
source. No preset/default was promoted. Budget remains CNY 5.55 committed and
CNY 44.45 remaining. Evidence:
[`memory-query-provenance-comparison-2026-09-14.json`](artifacts/memory-query-provenance-comparison-2026-09-14.json).

### Earlier recharge and small probe

The user replenished DeepSeek balance and explicitly authorized necessary live
tests, while prohibiting large or high-frequency campaigns. The earlier paid-test
pause is superseded. Prefer retained evidence and deterministic verification;
launch a real model only to resolve a specific remaining model-behavior question.
Do not repeat passing suites or schedule automatic batches/retries.

The resumed probe runs only `bounded_async_queue_v1` once on the frozen current
candidate. Its unresolved question is whether the integrated profile preserves
asynchronous rejection and rejects null signals and sparse arrays. Historical
Runs used 9–16 usage receipts and recorded about $0.016–$0.025 each. The probe
admits at most **20 actual API requests, at least 30 seconds apart**, including
SDK retries and auxiliary model work. It sets a **$0.05 recorded-usage threshold**
and a 900-second timeout to accommodate deliberate waiting; the fixture, prompt,
grader, 40-turn limit and 250,000-token limit remain unchanged. Recorded cost is
not a provider billing guarantee and a final in-flight response may cross it.
Stop after this one candidate observation, including failure or exhaustion; a
fresh baseline is not automatically scheduled. This narrow probe cannot satisfy
the existing 30-case/three-paired-trial quality gate or authorize promotion.

Both campaign and suite CLI entries now accept `--max-cost-usd` and
`--run-timeout-ms`. The suite applies identical values to both arms and records
them in its schedule; each Run report retains the resolved limits. Invalid,
non-finite or increased spending thresholds fail before runtime/credential
loading. Historical defaults remain $3 and 240 seconds. Three targeted offline
tests passed; no previous full suite was repeated. The driver is frozen separately
at `/tmp/napier-low-frequency-driver-v1`, leaving the current Runtime snapshot
unchanged. Private plan and execution evidence are under
`~/.cache/napier-seven-quality/low-frequency-queue-v2`.

### Resumed single-probe result

Run `run_9d21167a1eb64698920a` completed in 409.72 seconds using **14 admitted
requests** and **$0.0255587752 recorded usage**. The frozen current candidate,
its 129-package dependency graph and request-context evidence remained stable.
Only the two permitted source files changed. The retained original grader passed;
this is **not complete contract acceptance**. An offline audit confirmed that
invalid concurrency uses Promise rejection, null signals reject, and sparse-array
holes reject before jobs start. It also found a missed requirement: the generated
`isAbortSignal` accepts an ordinary object with `aborted` and `addEventListener`,
then starts a job. Such an object is not an AbortSignal. No new model request is
needed to establish this deterministic failure.

`bounded-async-queue-v2` preserves the same fixture, prompt and reference, adding
external checks for null and AbortSignal-shaped plain objects, including initially
aborted ones. It is a stronger grader for the same task, **not an additional
distinct task**. Two focused offline grader tests passed: the reference is accepted,
the original input is rejected, and a duck-typing mutant that passes the old grader
fails the stronger grader. An offline regrade of this unchanged real-model output
also fails. Historical grader files, reports and immutable Runs remain unchanged;
the v2 case is not substituted into an old suite or counted as a fresh model Run.

Three tool failures remain in the source events: one cancelled command and two
policy-rejected edits before workspace verification. Both edits subsequently
completed. These are retained observations, not omitted from the successful
legacy grade. The initial launch attempt stopped at profile-file hash validation
before any API-budget database or provider request; its receipt is also retained.

At that earlier checkpoint, paid testing stopped after one Run and the
composition remained unqualified with a concrete input-validation omission.
The later authorized comparisons and correction are recorded above. The sanitized receipt is
`docs/artifacts/low-frequency-queue-probe-2026-09-14.json`. No fresh baseline,
batch campaign, automatic retry, default promotion or production service change
was performed.

## Paired dependency preflight (2026-09-14)

Fresh read-only inventories of the original `baseline-c454a155` and current
`container-visibility-v1` snapshots are both eligible. Excluding the intentionally
different Runtime/Contracts packages, **all 127 external packages match**, including
their installed-byte identities and dependency relationships. The candidate's
complete graph also matches its earlier preflight receipt. This supports dependency
comparability; it does not restore external services or freeze shared package links.
Subsequent campaigns must still collect their own before/after inventories.

The sanitized receipt is
`docs/artifacts/paired-dependency-preflight-2026-09-14.json`; full hash-only package
inventories remain local. That preflight invoked no Agent or paid API. The user's
subsequent recharge and authorization are governed by the latest CNY 50 budget
and necessary-only testing constraint above. Offline regression checks, scripted OCI integration and dependency
comparability do not replace the outstanding real-model quality comparison.

## Full Runtime differential verification (2026-09-14)

The current `container-visibility-v1` source completed the entire Runtime suite:
**2686 passed, 60 skipped, 2 failed across 533 files**, in **300.85 seconds**.
The command used the package's two-worker/30-second test limits and removed
API-key/token/secret variables, live-test flags and `NODE_OPTIONS`. Paid API calls
were **zero**. Runtime source inventories matched the frozen candidate before
and after execution; this was not a run against the older prepared snapshot.

Compared with the retained large-provider full result (2667 passed, 59 skipped,
2 failed), there are **no new failed titles and no common-test status changes**.
The 20 added assertions comprise 19 passes and the intentionally gated read-only
reproduction CLI test, which was skipped in this offline full run. The two retained
failures are the V5 capability-history vector expectation and production Skill
loader readiness expectation; their first error messages are identical to the
previous full result. They remain failures, not green acceptance checks.

The original and current result files, logs, source inventory and comparison are
bound in `docs/artifacts/container-visibility-runtime-full-audit-2026-09-14.json`.
This completes the broader Runtime regression check for the OCI visibility fix;
it does not rerun root/Web suites or supply current real-model task-quality,
semantic-recall, long-task or cache-cost qualification. The seven-module goal
remains unfinished and no default policy is promoted.

## OCI visibility after atomic edits and complete composition (2026-09-14)

The complete proposed profile now has scripted AgentRuntime integration checks
for Node and Python. They exercise real filesystem/SQLite/verifier processes,
durable first-patch ordering, actual unified-diff edits, affected-test selection,
grouped authorized memory and post-edit source invalidation, current verification
in the request-local working-state tail, invocation-capsule bindings, Store reopen
and private original-input export without ledger mutation. These scripted model
responses test wiring and evidence, not stochastic task quality, semantic recall,
long-task compaction or actual reserve-triggered finalization behavior.

The host checks passed, but OCI Node repeatedly failed after editing with `ENOENT`
for its imported source. Python passed. An independent real-OCI probe reproduced
the boundary without the Agent: ordinary rewrite passed, atomic rename failed;
`stat` and a direct read still failed, but enumerating the parent directory made
the exact original test pass. This was observed on the current Colima virtiofs
mount with image Node 24.16.0. The earlier passing large-workspace OCI cases did
not exercise native Node reads immediately following a host atomic replacement.

`verification-container-entry.ts` now refreshes directory visibility inside OCI
before launching Node verification. Both direct verification and the selected-test
batch path use this entry, including image-owned test/typecheck/format commands.
It streams directory entries, skips links and the same `.git`, `.napier` and
`node_modules` trees excluded by the workspace digest, and stops at 100,000 entries
or a 30-second scan deadline. The enclosing timeout/cancellation still covers the
entry and child verifier. Arguments are passed as an argv vector; stdout, stderr,
nonzero exit status and terminating signals are preserved. No file is rewritten,
no write/network permission is added and host-direct execution is unchanged.
This is visibility refresh, not a filesystem lock or installed-dependency sync.

Final checks: **32 focused tests passed across seven files**, plus **both actual
OCI composition cases passed**, including a nested Node source import. A real
image typecheck and format check passed; a type error introduced by atomic rename
still failed with TS2322. The wrapper's process-tree timeout test leaves no delayed
write. A read-only visibility pass over the current repository completed in
**217 ms including container launch and a fixed probe command**; it did not run
workspace code. These measurements do not establish end-to-end performance gain.

Runtime compilation and formatting passed. Architecture retains exactly the seven
known violations. An old fake-provider argv expectation was updated to retain the
same image-owned verifier arguments behind the new entry; its intermediate failure
is preserved. The initial integration fixture also had a same-scope memory-dedupe
setup error, corrected using identical facts in workspace/current-Agent scopes.
All three failed OCI observations and the direct rename reproducer remain retained;
the final OCI run restored its exact container/network/scratch baseline.

The new current source/build snapshot is
`/tmp/napier-harness-container-visibility-v1`. The earlier
`/tmp/napier-harness-current-profile-v1` remains immutable and now predates this fix.
The explicit profile itself is unchanged; the Runtime/driver source identity must
still be kept separate in any future comparison. New snapshot inputs, tests,
diagnostics and acceptance limits are bound in
`docs/artifacts/container-visibility-composition-validation-2026-09-14.json`.
No paid API was called, no Colima/ZTE/Qdrant service was restarted, no default was
promoted, and the broad current-model quality gate remains unqualified.

## Explicit composition campaign entry and frozen candidate (2026-09-14)

Preparing the next comparison exposed an execution gap: the campaign/suite CLIs
accepted presets and a few overrides, but could not directly exercise arbitrary
validated product profiles such as the integrated durable pre-edit composition.
The campaign now accepts `--profile-file`; the suite accepts independent
`--baseline-profile-file` and `--candidate-profile-file`. Each arm uses its own
Runtime's production validator. Explicit files reject conflicting presets,
default mode, context/finalization overrides and format/catalog selectors.
Existing invocations without profile files retain their preset/default behavior.

The suite freezes the validated profiles into private files before any job and
records source-file, frozen-file and profile hashes in its schedule. It checks
frozen bytes at launch and passes their expected hash to the campaign, which
checks the actual bytes it reads before credentials or execution. This prevents
an original file edit or a between-process snapshot substitution from silently
changing the requested composition. The resolved profile continues through the
ordinary Run binding and campaign report. The new helper is included in the
driver identity; historical drivers/observations remain separate.

Validation: **139 tests passed across 25 files**. The first new-test run had four
fixture-construction failures from incorrectly retaining the old policy hash;
the fixture was corrected using the production constructor's required input.
Tests cover selector conflicts, current complete profiles, invalid hashes and
policies, private/non-overwriting snapshots, original-file edits, snapshot
tampering, and a real zero-budget suite CLI. Architecture still reports exactly
the seven known violations. No Runtime source, default preset or service changed.

Current candidate snapshot: `/tmp/napier-harness-current-profile-v1`, containing
matching current Runtime/Contracts source, builds and tests plus MJS drivers.
Its explicit `candidate-profile.json` combines grouped-v3 memory, tail delivery,
request-aware finalization, contract-first validation, durable pre-edit ordering,
Node/Python verification, working state and edit-reference/unified-diff availability.
This proposed combination is **unqualified**; format availability is not measured
format adoption. Other dependencies retain their existing links, so this is not a
hermetic environment; the fresh installed dependency inventory is eligible.

The frozen driver ran the real 30-case/three-trial suite preflight against the
original baseline path with **zero request allowance**, one concurrent job and
a 60-second admission interval. It retained all **180 missing observations**,
started no child campaigns, admitted no API request and returned non-promotion
(expected exit 1). The exact command is recorded in
`/tmp/napier-current-profile-zero-preflight-v1.command.json`; output is
`/tmp/napier-current-profile-zero-preflight-v1`. A new paid run still needs its
own output directory and agreed request/count/cost budget. This preflight has no
task-success, baseline-runtime execution, provider callability or quality claim.

Source/snapshot/log bindings and limitations are retained in
`docs/artifacts/explicit-profile-preflight-validation-2026-09-14.json`.

## Shared evaluator consumer and completion audit (2026-09-14)

After the sampling-identity correction, the complete `scripts/harness-*.test.mjs`
and edit-calibration evidence selection passed: **134 tests across 24 files**.
This covers the generic gate's consumers, calibration, input freezing, failure
exports, API request admission, scenario control, dependency/environment evidence
and independent corpus graders. The run removed API-key/token/secret variables,
live flags and `NODE_OPTIONS`; no live model driver was started and paid API calls
were **zero**. These results supersede the 32-test selection only for this broader
offline consumer scope; they do not replace Runtime, Web or model acceptance.

The seven-module completion audit still finds every module's overall completion
unproven. Current implementations and scoped component evidence exist, but the
required representative comparisons, actual edit-format adoption, long-task
recall/cache attribution and current whole-composition quality are not established.
Failure replay also retains its dependency/service restoration limits. The earlier
57-observation regression is neither fixed by an evaluator change nor evidence
against untested current code. It remains a retained rejection of its frozen
composition. No default policy is promoted and no paid campaign is scheduled.

`docs/artifacts/harness-consumer-completion-audit-2026-09-14.json` binds the test
selection/results, 43 local test/helper sources and the current implementation
entry points for all seven modules. These are post-test source bindings, not a
hermetic execution snapshot. The next paid qualification still requires explicit
request-count, interval and dollar limits and a frozen current candidate.

## Independent sampling identity (2026-09-14)

The generic campaign quality gate previously counted case names and trial labels
without independently rejecting Run reuse or renamed copies of captured inputs.
The reproduction had **six failures and one pass**. The shared sampling helper now
requires nonempty case/Run IDs, nonnegative safe-integer trials and valid input and
grader hashes. Supplied memory/acceptance hashes must also be valid; legacy absent
optional fields remain supported. Every Run must be unique across cases, trials
and arms. A case definition must remain fixed across all its observations.

Task identity includes fixture, prompt and memory seed hashes. Changing a grader
cannot create a distinct task. All affected pairs are excluded on aliasing or
changed definitions, while observed adverse candidate outcomes remain recorded.
Suite preflight applies the same task identity before model execution; complete
input snapshot hashes still include graders and retain their original format.
Captured byte inequality is not proof of semantic task independence, and these
checks do not authenticate externally supplied reports or prove run execution.

Final focused checks: **32 passed in five files**, including the genuine 30-case
suite preflight, 30-by-three synthetic paired campaign, cross-arm/case Run reuse,
malformed identities, grader changes and retained adverse outcomes. No production
Agent behavior or model driver was changed. DeepSeek paid calls remain **zero**
for this audit. Existing 30-case/three-trial thresholds remain unchanged.

Read-only reassessment of all **57 retained core observations** still yields
**27 comparable pairs, 10 cases, regressed**, with the original queue completion
and false-completion regression retained. Original report and suite-result bytes
are checked before/after; no historical receipt or observation is replaced.
Evaluator/helper sources, tests, logs and the reassessment are bound in
`docs/artifacts/sample-identity-validation-2026-09-14.json`. This is an offline
evaluator correction, not current-composition model quality qualification.

## Failure reproduction source coherence (2026-09-14)

The production exporter previously relied on a CLI-only terminal-event check and
matched invocation capsules only by Run/thread identity. A reader returning events
in reverse order could export a later model call as the initial invocation. A local
Runtime/SQLite reproducer exposed **nine failing assertions**: eight inconsistent
source variants were accepted, and reverse-order export selected the wrong call.
The source Run used a scripted local provider; no paid API was involved.

`run-input-reproduction-source.ts` now validates the configuration fingerprint,
Run/thread scope, unique event IDs and sequence numbers, and one consistent terminal
event. The exporter orders events by sequence, requires capture before the initial
agent invocation and that invocation before termination, and matches the task prompt
only before that invocation. Capture status/counts must match the input capsule;
the complete model-invocation receipt must match the validated capsule, including
turn, purpose, model, context/options bindings and byte count. Invalid sources are
rejected before the output directory is created. These are coherence checks, not
authentication of a caller-supplied ledger or proof that no events were omitted.

The CLI and library both support an explicitly settled `interrupted` source with
a matching terminal event. A missing/unavailable first invocation still prevents
export rather than silently substituting a later call. Existing output schemas,
private file modes, external-review authority and `qualificationReady: false`
remain unchanged. Export does not restore installed dependencies or external
services and cannot guarantee recurrence of a model failure.

Final validation: **23 assertions passed**, covering altered configuration,
missing/conflicting termination, cross-Run events, duplicate sequence, damaged or
rebound invocation receipts, damaged capture receipt, late prompt, unavailable
first invocation, reverse ordering, coherent interruption and actual read-only
SQLite CLI export. The interruption variant supplies a coherent altered record in
the test reader; it is not a new process-crash experiment. Runtime compilation,
formatting and diff checks pass. An intermediate error-message compatibility
failure and a temporary complexity violation were corrected; their logs remain
retained. Architecture again has exactly the seven known violations, with no
budget changes. The prior full Runtime result predates this exporter-only change.

The final CLI also exported **all five retained real-model recovered-tool-failure
Runs** from `pre-edit-verification-queue-v1` into a new private directory at
`/tmp/napier-reproduction-real-current-v2`. Every exported file's bytes and mode
matched its old initial-input bundle, and original bundles/database files remained
unchanged. This is compatibility of historical evidence, not five new model runs
or proof that the current composition passes those tasks. The earlier export pass
before configuration validation remains retained separately as v1.

Bindings, before/after tests and both historical export observations are recorded
in `docs/artifacts/reproduction-source-validation-2026-09-14.json`; selected source
and compiled files are archived in `/tmp/napier-reproduction-source-current-v1`
(not a complete executable environment). No original campaign, failed result,
release receipt, default policy or service was changed. Paid calls remain paused;
the 30-case/three-pair quality gate and whole-goal qualification remain outstanding.

## Complete workspace evidence across verification providers (2026-09-14)

The preceding streaming-digest change covered direct Node verification. Follow-up
inspection found Python verification, affected-test selection/aggregation and
working-state preparation still inherited truncated context snapshots. A real
local reproducer with a 17 MiB workspace asset had **four failed / one passed**:
Python rejected a successful check as indeterminate, selected verification fell
back unnecessarily, and context treated a fresh Node receipt as unknown. The
first reproducer omitted an explicit Node runner for fallback; a corrected
`node-test` replay retained four failures, with Node fallback now explicitly
rejecting incomplete test discovery. Both observations are preserved.

Python verification and both affected-test phases now use the shared complete
digest. Static graph limits, uncertain-import detection and configuration/no-match
fallback rules remain intact. Python's receipt also includes truncation from either
observation, rather than only the first one. Node test discovery now inventories
the scope but reads only candidate test source files. Its source budget remains
16 MiB/2,000 test files; discovery also bounds visited entries and elapsed time.
Unrelated large assets no longer prevent full-suite fallback. Candidate-source
overflow and symbolic links cannot silently narrow a requested native Node scope.
Mixed-framework rejection and explicit wrapper targets are retained.

Working-state preparation obtains a complete digest when a verification receipt
needs assessment and the context snapshot is incomplete. Modern verification
freshness uses that digest; legacy file-list receipts and artifact freshness keep
their original evidence requirements. An incomplete digest cannot upgrade a
receipt to current. This removes repeated `reverify` suggestions caused solely by
large workspace size while retaining stale detection after actual content changes.
It does not establish task completion or relax permission checks.

Final component acceptance used actual processes in the current arm64 OCI image:
**five scenarios passed** across direct Node/Python checks, selected tests,
full-suite fallback and working-state context. Each fallback deliberately retained
an unrelated failing test and reported failure. A write beyond byte 16 MiB after a
successful check changed context freshness from current to stale. No model API was
called. The first OCI attempt failed because macOS's default temporary directory
is not shared with Colima; the same scenarios passed using the existing shared
scratch directory through task-local `TMPDIR`. No Colima restart or service
management occurred; final Napier container/network/scratch counts were all zero.

The earlier focused selection passed **49 assertions / one skipped** with actual
macOS toolchain smoke enabled. A subsequent typed file-handle correction was
compiled successfully and exercised by final OCI acceptance. Full-suite evidence
for the final source is **2,667 passed / 59 skipped / two failed**, 530 files,
301.93 seconds. The two failure titles and first error lines match the retained
durable pre-edit run: V5 capability-history expectation and production Skill-loader
readiness. No new failure title appeared; the suite as a whole is still failing.
This is deterministic regression evidence, not real-model quality qualification.
Two build attempts hit
`ENOTEMPTY` while the existing Runtime TypeScript watcher wrote `dist`; another
exposed the stream flag type mismatch. After correcting the type usage and letting
the watcher settle, the original `build:compile` command passed. All failure logs
are retained. Formatting passes and architecture retains exactly seven known
violations without increasing budgets.

Selected current sources, tests and compiled modules are retained in
`/tmp/napier-large-provider-current-v1`; this is not a complete runnable snapshot.
Bindings and acceptance limits are recorded in
`docs/artifacts/large-workspace-provider-validation-2026-09-14.json`. Prior OCI
receipts and failed model campaigns remain unchanged. Current-source provider and
context improvements still require the original real-model quality qualification;
no policy has been promoted and paid calls remain paused.

## Current OCI acceptance and complete verification digests (2026-09-14)

No paid model calls were made. Current-image LSP acceptance passed diagnostics,
symbols, definitions, URI mapping and escape/authority/query rejection. Both
host-user and portable-user arms executed inside OCI, with equal projections and
exact container/network/scratch baseline restoration. The retained component is
`docs/artifacts/current-image-lsp-component-2026-09-14.json`; its image is the
current arm64 Python-debugger image, not the historical release image.

Installed Homebrew `docker-buildx 0.37.1` and used a task-specific Docker config
under `/tmp/napier-buildx-config-v1`; the user's Docker configuration was not
edited. The first dual-platform attempt failed reaching Docker Hub authentication.
`sandbox-multi-architecture-live.mjs` now preserves explicitly configured proxy
variables only for host-side Buildx commands. Ordinary Docker command environments
and Agent container network policy are unchanged; API keys and arbitrary secrets
are excluded. The proxy regression test passes.

The next two attempts built amd64 and passed all nine production probes, then
failed workspace verification. A diagnostic replay found both verifier exit codes
were zero and all 98 Contracts assertions passed, but the workspace observation
was truncated at 16 MiB and correctly marked `indeterminate`. These failed
observations remain retained as v2/v3; they were not relabeled as passing.

`verification-workspace-digest.ts` now computes the same canonical ordered-entry
hash using 64 KiB file reads, without retaining entry records or whole file
contents. Verification no longer inherits the context snapshot's 16 MiB/2,000-entry
limits. It retains bounded directory listings, a 100,000-entry budget and a
cooperative 30-second scan deadline. Read failures, unsupported entries, observed
file/directory changes and budget exhaustion remain incomplete evidence; cancelled
requests do not launch a verifier. Symlink targets are hashed without reading their
contents. The `.git`, `.napier`, and `node_modules` exclusions remain unchanged.
This is optimistic before/after observation, not filesystem locking or complete
dependency/environment attestation. At this stage, task-context snapshots retained
their existing limits and still reported verification freshness as unknown in large
workspaces; the later provider/context completion above addresses that limitation.

The new digest read **9,765 files / 76,285,322 bytes in 1,217 ms** in one current-
checkout observation without truncation. Tests cover unchanged large workspaces,
late-byte changes beyond 16 MiB, changes after the 2,000th entry, exact compatibility
with complete prior hashes, symlink retargeting, incomplete observations and
cancellation. **37 focused Runtime assertions passed**, including working-state
and durable pre-edit integration; Runtime compilation passed. An initial test
expected an already-aborted request to launch and terminate a child; it was split
into explicit pre-launch cancellation and cancellation after actual launch. The
initial failed test log is retained.

Final v4 acceptance built and executed **linux/amd64 and linux/arm64**. Each passed
all nine production probes plus actual Contracts typecheck and test verification;
toolchain versions and manifests matched. Platform durations were 69,153 ms and
32,208 ms. All resource deltas were zero; a separate final inspection found zero
Napier containers, networks, temporary tags and scratch directories. The fresh
`docs/artifacts/current-multi-architecture-component-2026-09-14.json` passes the
existing artifact verifier. This is local execution on the macOS Colima host;
registry publication, signing and Windows/Linux host acceptance remain unverified.
Colima was not restarted again and ZTE services were not managed.

Historical release receipts remain byte-identical to Git HEAD. The focused root
receipt/proxy selection still has **4 passed / 1 failed**, with the retained
multiarchitecture receipt rejecting changed implementation bindings. Architecture
still reports the same seven known violations; no limits were raised. Formatting
and diff whitespace checks pass. The previous full Runtime and root-suite totals
predate this digest change and are not fresh full-suite validation.

Changed sources and compiled modules are archived in
`/tmp/napier-streaming-digest-source-v1` (selected files, not a complete executable
environment). Hash bindings, failed attempts, logs and scope limits are recorded in
`docs/artifacts/streaming-workspace-oci-validation-2026-09-14.json`. The existing
durable pre-edit snapshot remains immutable; the current checkout includes this
additional digest change and still has no real-model quality qualification.

## Acceptance contract

- Preserve workspace boundaries, authorization, cancellation, shared budgets,
  durable effects, exact replay, and truthful completion evidence.
- Compare the same serving model, initial workspace, task inputs, memory seeds,
  and independent graders. Introduce graders only after Agent execution.
- A newly failed task or scope violation blocks promotion; token/cost savings
  cannot compensate. Baseline failures remain recorded.
- A disabled implementation alone is not delivery. Exercise candidates in real
  Agent runs, record actual format/tool usage, and qualify only measured scope.
- Preserve historical receipts and immutable campaign snapshots. Host-direct
  execution is not evidence of OS isolation.

## Module status and remaining work

| Module             | Implemented                                                                                                                                                                                                                                                                                                            | Still required                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Edit adaptation    | Run-local snapshot/line references; strict unified diff to EditIntent; atomic CAS/recovery; model/API/task-bound format preference; hash-bound calibration catalog and configuration/campaign selector                                                                                                                 | Broad representative qualification and demonstrated actual format adoption; no automatically promoted catalog entry          |
| Toolchains         | Admitted Node/Python execution and managed process lifecycle; venv identity; bounded output activity; unittest/syntax/installed pytest/mypy/ruff; snapshot-bound diagnostics; bounded transitive affected-test selection with full-suite fallback; CLI/Web real-model activation; image-bound OCI Python DAP transport | Broad provider/selection/lifecycle qualification; historical process pilot regressions remain recorded                       |
| Prompt/cache       | Opt-in stable assembly and request-local tail delivery; fresh context with compaction reservation/recovery/import bindings; exact invocation capsules; system and canonical-message prefix diagnostics; real paired pilot                                                                                              | Broad long-task qualification and controlled cache/cost attribution; no default promotion                                    |
| Task working state | Evidence-derived requests, current hash-bound plan revisions/superseded IDs, artifact versions, verification freshness, failures/pending actions; validated user instruction revisions distinguished from runtime hints; repeated compaction and same-thread recovery ancestry                                         | Broad quality/performance qualification; complete compositions remain unqualified                                            |
| Task-aware memory  | Authorized/reviewed FTS5 relevance; incremental index and source freshness; grouped-v3 source affinity below direct/general priorities; exact text grouping with all source IDs retained; real-model comparison                                                                                                        | Broad semantic recall and long-task qualification; unique irrelevant facts and fixed-budget omissions remain open            |
| Harness policies   | Versioned hash-bound compositions; caller-mutation isolation; durable pre-call binding; recovery inheritance and serving-family limits; three explicit presets with CLI/HTTP/Web activation; exact full-profile file activation in one-shot CLI                                                                                                                            | Representative quality qualification of each composition; no default promotion                                               |
| Failure evaluation | Original fixture/prompt/grader/seed preservation; fresh real-model reproduction; source/model identity and quality gates; actual edit/debugger evidence from invocation capsules; Run-bound environment eligibility, equal-budget gates, serial paired stopping and case prioritization; opt-in initial file capsules and private production export                 | Broader capture/context replay qualification, complete dependency/service restoration, broad statistical and cost guardrails |

## Root gate differential audit (2026-09-14)

A fresh detached audit worktree at `/tmp/napier-root-audit-baseline-v1` was created
from original `c454a155`. Contracts, Runtime, SDK, CLI, Benchmark Kit, Harness Eval,
Server and Web prerequisites were compiled there with its own workspace package
aliases. It remained Git-clean after the builds and tests; the original frozen
baseline and all retained campaign snapshots were untouched. Both root suites ran
without API keys or live-test flags. No model API was invoked.

| Root suite | Passed | Failed | Files |
| --- | ---: | ---: | ---: |
| Original `c454a155` | 420 | 67 | 91 |
| Current checkout | 539 | 71 | 114 |

All 487 original assertions remain present. Of those, 416 pass in both versions,
67 fail in both, and four previously passing assertions now fail. All **123 added
assertions pass**. Matching includes occurrence number within a file, preserving
parameterized cases with identical test names rather than silently collapsing them.
This is a local CI comparison, not the real-model 30-case/three-pair quality gate.

The four newly failing assertions are the retained OCI crash-recovery,
multi-architecture, portable-DAP and portable-LSP receipt checks. Direct calls to
the unchanged verifiers accept the original implementation and reject current
implementation bindings. Mismatched fields identify the actual source changes:

- Crash recovery and multi-architecture: `sandbox-oci.ts`.
- Portable DAP: `sandbox-types.ts` and the corrected live acceptance collector.
- Portable LSP: `sandbox-types.ts` and `lsp-runtime-assets.ts`.

No failed gate is relabeled as passing. The prior current-image Node/Python DAP
and crash-recovery component checks do not replace these historical-image release
receipts. Current-source LSP and multi-architecture now have the separate component
evidence above; replacing historical source hashes alone would not provide it.

Of the 67 assertions failing in both versions, **53 encounter a different first
blocker**: current tests stop at the OCI crash-recovery receipt, while original
tests stop at the Sandbox security Casebook receipt. These include release and S1
fixture setup, so their later tamper checks have not run successfully in this audit.
They cannot be described as 53 unchanged baseline defects. The other 14 share the
first failure line only, which is not proof that their complete causes are identical.

The prompt matrix mismatch was isolated independently: its Browser and sensitive-
target Browser test files are byte-identical between current and original source;
both differ from the old retained hashes. This is existing receipt/source drift,
not evidence of a new prompt-content change. Detailed assertion identities,
first-blocker summaries, source bindings and log hashes are retained in
`docs/artifacts/root-gate-differential-audit-2026-09-14.json`. No receipt, threshold,
source manifest, or product default was refreshed to force the gate green.

## Current-image OCI toolchain acceptance, no model calls (2026-09-14)

The current immutable Python-debugger image
`sha256:9ee6f40ab58e1e022c1ae6771fdf6a6bc60419e7f74e86ccd79aedaa16c4418a`
was rechecked on the existing Colima daemon without restarting it. The older image
bound into the release receipts (`sha256:7dfe2fa46ceb6051d06e4b510e202cc4cbbf8c1eb435c7b21ed22f5cbe480405`)
is not present locally. These new measurements therefore remain separate component
evidence; the historical image provenance and release receipts were not rewritten.

The optional OCI Python debugger test passed **3/3**, including one actual container
scenario. It exercised a breakpoint, stack inspection, evaluation, continuation and
zero exit. Debuggee probes verified denied workspace writes, host-sentinel reads
and outbound TCP; Docker inspection confirmed read-only root/bind mounts, no network
and dropped capabilities. The owned container was removed and sentinel content did
not enter the Run ledger. The other two tests exercise resolver boundaries locally.

Actual Node portable-DAP acceptance first failed because its old collector borrowed
a completed seeded Run. Runtime correctly rejected `workspace.process.started`
admission. `sandbox-portable-dap-live.mjs` now creates a fresh thread and leased Run
for each arm, using the normal Store API with a process-bound owner and 120-second
lease. Admission remains enabled, and all original breakpoint/evaluation/exit and
resource assertions are unchanged. One intermediate attempt used an invalid lease
ID prefix and stopped before debug execution; that failure is retained separately.

The corrected collector passed in both **host-user and portable-user mappings
inside OCI**: same breakpoint frames, expected numeric evaluation, and normal exit.
It verified protocol path mapping and path-escape rejection, removed its temporary
root and restored the exact container/network/scratch baseline. This is not
host-direct execution or a Windows-host result.

Two fresh runtime child processes were then deliberately killed with `SIGKILL`
after their local service was observed healthy. For both cycles the Guardian
removed the owned container, network and scratch directory, the endpoint closed,
and the exact pre-test resource baseline returned. Their endpoint identities were
distinct. Final inspection found **zero Napier containers**, including stopped ones.
These cycles do not requalify every release failure-injection scenario.

The final collector was rerun after formatting so source bindings describe the
executed file bytes. Current Runtime/Contracts source and dist remain identical to
`durable-pre-edit-v1`; no default policy, model setting or ZTE service was changed.
Architecture retains seven known violations. Retained release-receipt tests still
report **4 passed / 2 failed**, because they bind the historical implementation/image;
these failures were not suppressed or relabeled as passing current-image acceptance.
Evidence: `docs/artifacts/toolchain-oci-current-validation-2026-09-14.json`.
No model API was called, and the 30-case/three-pair task-quality gate remains open.

## Web policy confirmation from terminal evidence (2026-09-14)

A local audit found a real strategy-confirmation gap: `stream-harness-policy-evidence.ts`
verified live `harness.policy.bound` events but ignored the final snapshot and `done`.
A hash-valid terminal-only SSE response could therefore complete despite missing,
foreign, duplicate, late or tampered policy binding, including a binding borrowed
from an older Run. The one-use Composer selection also remained set without a live
`run.started`, and a later refresh failure could restore an already submitted prompt.

The Web verifier now retains only policy/start events from the final snapshot. For
the terminal Run, an explicitly selected preset requires exactly one matching,
intact binding and one later start in the same thread. Missing, conflicting,
wrong-Run or wrong-thread evidence fails before `done` is dispatched. A default
request rejects an unsolicited binding for its current Run while allowing older
Runs' historical bindings. Existing event, thread, sequence, snapshot and terminal
hash checks still run; a complete valid snapshot is accepted even without live events.

`isAcceptedPromptRunFrame` gives prompt execution and the one-use policy hook the
same accepted-Run signal: a verified live start or verified terminal `done` for the
submitted thread. Accepted terminal evidence consumes the original choice, and a
subsequent refresh error no longer restores a duplicate prompt. Late responses still
cannot clear a newer thread/selection. This is confirmation and duplicate-input
prevention, not a new retry or model execution path.

Before the fix, six valid SSE regression cases failed because the API resolved
without rejecting invalid evidence; one positive case passed. The first fixture
iteration had two generic sequence-contract failures and is retained separately;
only corrected `before-v2` establishes those six behavioral failures. Tests use the
actual Runtime preset builder and Web SSE parser with local Response bodies, plus
React hook tests in a local DOM. No server, rendered-browser session or real model
was invoked. The final focused set passes **81 tests in five files**; full Web
passes **1155 tests in 270 files**, 12.05 seconds (pre-change audit: 1144 tests).
Production Web build and formatting pass. An initial build caught two test typing
issues; these were corrected before the final build/full-suite pass.

The workspace-view-model line excess was verified unchanged at **2317 lines in
original `c454a155`**, so no unrelated decomposition or budget increase was made.
Architecture retains the same seven recorded violations. Runtime/Contracts remain
byte-identical to `durable-pre-edit-v1`; this Web change does not qualify a new
real-model composition or supersede old failure trials. Source/log bindings are in
`docs/artifacts/web-policy-terminal-validation-2026-09-14.json`.

## Shared API request admission, offline implementation (2026-09-14)

`scripts/harness-api-request-budget.mjs` adds a durable SQLite request allowance
outside Agent workspaces. `run-harness-optimization-suite.mjs` now requires explicit
`--max-api-requests` and `--api-request-interval-ms`, creates one allowance for the
whole suite, and shares it across both arms, all trials and concurrent child
processes. Standalone campaigns require those two options or an existing
`--api-budget` file, never both. Missing budgets fail closed; a zero allowance
starts no campaign. Existing files cannot be recreated to reset usage.

At the actual DeepSeek fetch boundary, each SDK/Runtime retry needs a new admission.
A committed reservation counts even if the process crashes, the request is aborted
just afterward, or transport fails; it is never refunded. SQLite transactions
serialize cross-process admissions and enforce their minimum interval. Waiting is
abortable and cancellation before reservation consumes no slot. No prompt, key,
header or request body is persisted in the budget database. Standard DeepSeek
redirects are rejected to prevent one reservation following multiple endpoints;
unrelated HTTP operations retain their existing fetch behavior. The campaign
checks the model uses the supported `https://api.deepseek.com` origin.

These are conservative **request reservations and admission spacing**, not exact
provider billing, exact network packet timing, or a sandbox for networking from
Agent child processes. The current installed Pi/OpenAI SDK transport was tested;
other providers, custom endpoints and arbitrary campaign drivers are not covered.
The existing per-Run USD limit remains separate. A provider-backed dollar ceiling
has not been established, and live tests remain paused pending an explicitly agreed
small call-count and cost budget. No positive-budget live campaign was started.

Campaign report schema 7 retains before/after shared counters and a hash of the
request policy. Counts are suite-wide and are not attributed as per-Run token usage.
The evidence gate rejects missing, modified, changed-policy or newly denied request
receipts, as well as unequal request policies between arms; historical schema 6
reports remain valid under their original rules. Source/model qualification stays
separate, so an exhausted Run can still be exported as an original failure. Adverse
outcomes and scope violations remain recorded even when the pair is ineligible.
The budget helper is included in driver helper identity, and failure exports retain
the receipt. These future driver identities cannot be pooled with frozen campaigns.

Local validation: **31 passed across six files**. Four real child processes share
seven admissions without overspending, and reopening the database preserves usage.
The actual installed Pi/OpenAI provider is exercised with local transport responses:
retries stop at the allowance, successful SSE retains request content and response,
failed requests remain spent, and unrelated fetch is untouched. A real zero-budget
suite CLI run preserves six missing observations, launches no campaign and returns
`promotionReady:false`. No credential or paid API was used. Architecture retains
seven known violations and dead-code retains the same three known files.
Source/log bindings are in `docs/artifacts/api-request-budget-validation-2026-09-14.json`.
Runtime/Contracts remain on `durable-pre-edit-v1`; their prior full-suite result is
unchanged. This spending control is not whole-composition quality qualification.

## Durable pre-edit ordering, offline implementation (2026-09-14)

The durable pre-edit Runtime/Contracts snapshot is `/tmp/napier-harness-durable-pre-edit-v1`,
with parent `/tmp/napier-harness-contract-first-v1`. No paid model calls were made
for this implementation. The earlier 18 real Runs validate only the experimental
adapter on the parent snapshot, not this integrated implementation.

`ContextPolicy.verificationOrder: "before-first-patch-v1"` is explicit and optional;
profile validation requires `context.validation: "contract-first-v1"`, rejects
unknown values and binds the option into the policy hash. Existing presets remain
unchanged. `agent-runtime.ts` passes it into central governed tool preflight,
after the existing Kernel and progress/lifecycle checks. Blocks use the ordinary
ledger/event stream with `harnessInterventionReason: "pre_edit_verification"`.
Cancellation is checked around the ledger read. This path also serves Code Bridge;
no permission or execution budget is granted by the ordering rule.

`verification-ledger.ts` now retains a whitelisted input `verificationKind`
alongside the existing redacted argument hash. `pre-edit-verification.ts` derives
ordering from Run-local, sequence-ordered ledger events, including failed and denied
test attempts. It needs no cross-request in-memory intent map, so evidence survives
Store reopen and compaction without replay. Pending requests, foreign Run/call IDs
and untyped historical failures do not satisfy the rule. A denied attempt satisfies
attempt ordering only: it never proves execution, passing tests or permission.
Historical completed test details remain compatible.

The first `apply_patch` requires a settled test attempt when `verify_workspace` is
available directly or discoverable through `capability`. If the verifier is absent,
the ordering rule yields without fabricating a test receipt. An already completed
patch does not trigger another first-patch gate. This deliberately bounded policy
does not cover other mutation tools, establish workspace freshness, validate test
assertions, or guarantee contract coverage. It is not enabled by default.

Focused checks: **23 passed across seven files**. Five scripted-model integration
scenarios run the actual AgentRuntime, local filesystem and Node test processes:
failing baseline then passing final test, failed invocation, real Kernel denial,
unavailable verifier, and disabled ordering. They verify the early patch is blocked,
streamed receipts agree with the ledger, and reopened storage reconstructs the
pre-patch decision without replay. A denial produces `tool.blocked` and normalized
`tool.failed` for one call, with zero verifier starts. Host-direct execution provides
no OS isolation, and scripted responses provide no real-model quality evidence.

Contracts build and Runtime compilation pass. Formatting passes for the focused
files; `agent-runtime.ts` retains its existing formatting. Architecture retains
seven previously recorded violations; no budget was raised for this change.
Full Runtime: **2654 passed, 59 skipped, 2 previously recorded failures**, 527
files, 299.93 seconds. The failures are the capability-vector V5 history expectation
and production Skill-loader readiness, also present in the parent full run. The
full suite ran with live flags and API-key environment variables removed; no root
`.env` was loaded by the invocation. Broader root release/source receipt failures
remain unresolved. Validation and source/log hashes are in
`docs/artifacts/durable-pre-edit-validation-2026-09-14.json`.
The required **30 distinct cases × 3 paired trials** and all original failed trials
remain unchanged; this snapshot is not eligible for default promotion.

## Contract-first protocol rejected and terminal audit (2026-09-14)

`contract-verification-protocol.ts` adds explicit optional
`context.validation: "contract-first-v1"`. Its stable system source
`task.contract_verification` asks for source-grounded expectations, existing and
focused checks before edits, and assertion reuse afterward. It grants no tools,
changes no existing preset hashes, and is neither an oracle nor an enforced
execution/completion gate. Runtime/Contracts were frozen before campaigns at
`/tmp/napier-harness-contract-first-v1`; the parent is `memory-grouping-final-v1`.

Read-only audit of the earlier corrected-core queue failure found all relevant
README clauses present from invocation 2 through completion in both arms. The
candidate tested its changed synchronous throwing with `assert.throws`, omitting
supplied null signal. This supports investigating self-confirming expectations;
it does not show that context delivery caused the error.

The first contract-first driver accidentally required HTTP observations for
library cases. All four settled library Runs passed the behavioral grader but
were rejected by that predicate. Its reports are preserved separately in
`contract-first-runner-rejection-2026-09-14.json`; they are not qualification
trials. The corrected frozen driver has an explicit service-observation flag,
binds it in acceptance hashes, and requires it only for the mixed-service case.

Corrected terminal collection retains every result that settled before process
exit, including late NDJSON and mixed-service results:

| Component | Baseline settled | Candidate settled | Complete pairs | Result |
| --- | ---: | ---: | ---: | --- |
| Queue | 2/2 passed | 1/2 passed | 2 | Regressed on trial 2 |
| NDJSON | 0/1 passed | 2/2 passed | 1 | Incomplete |
| Mixed service | 2/2 passed | 1/1 passed | 1 | Incomplete |

Unequal settled totals are not comparable success-rate estimates. Queue stopped
on the paired regression; the other campaigns were stopped on that evidence.
No interrupted trial is passing, and no prior snapshot or invalid-driver trial
is pooled here. The unchanged 30-distinct-case × 3-pair gate remains required.

Candidate queue trial 2 (`run_16de4f2f276441f7b471`) completed but failed the
unchanged grader at `4:309`, the sparse-array rejection assertion. An independent
probe of the unchanged outputs confirms the mechanism: `Array.every` skips holes,
so candidate resolves three records and starts two jobs; paired baseline rejects
TypeError before dispatch. This is a real validation/side-effect violation.
The candidate did preserve async error delivery and reject supplied null signal.

All eight failed-candidate invocations contain the exact protocol in their system
prompt, but no `run_command`/`verify_workspace` request settled before its first
observed `apply_patch`, and none was reused exactly afterward. Passing candidate
trial 1 had 11/11 protocol exposures, three pre-patch settled requests and one
exact reuse. Hash-bound capsule evidence measures this chronology only: arbitrary
inline commands are not automatically tests, ordering does not prove assertion
quality, and other mutation paths may exist. Static guidance was not reliably
followed and is not quality-qualified.

The failed queue Run had no `run.inputs.captured` event. Production initial-input
export is therefore ineligible; no capsule was manufactured retrospectively.
Its original benchmark fixture and report-bound final output were exported to a
private failure bundle. That exposed a separate exporter compatibility defect:
`harness-campaign-evidence.mjs` did not recognize the new service-observation
acceptance binding. The fix validates the explicit Boolean without legacy hash
fallback, rejects changed/deleted/invalid requirements, and preserves the flag
and external-observer replay limitation in the reproduction receipt. The new
regression failed before the fix; all ten evidence/export checks pass afterward.
Frozen campaigns, reports and grading were not changed by this exporter fix.

Protocol checks: 11 passed. Full Runtime: **2643 passed, 59 skipped, 2 original
failures**, 525 files, 301.95 seconds. Compilation passed; architecture retains
seven existing violations with no increased budgets. Six protocol/service audit
helper checks passed separately. Read-only cleanup verification found no running
OCI containers or campaign-owned service processes; Colima was not restarted
again and no ZTE service was managed.

Evidence: `docs/artifacts/contract-first-rejection-2026-09-14.json` and
`docs/artifacts/contract-first-validation-2026-09-14.json`. No default policy is
promoted. A separate Kernel-adapter feasibility experiment is described below;
it cannot qualify quality merely by enforcing that a test attempt occurred.

## Isolated pre-edit ordering experiment (2026-09-14)

`scripts/harness-pre-edit-verification-policy.mjs` uses the existing
`AgentTurnPipeline` policy adapter. The candidate blocks an initial `apply_patch`
until a `verify_workspace(kind=test)` attempt settles. Completed test receipts
are read from the Run ledger; failing invocations without a completed receipt
are matched to actual Kernel preflight arguments held for that Run. Requests
still in flight do not satisfy the ordering requirement. The adapter adds no
execution, permission or completion verdict. It is not installed in product
Runtime defaults and is not qualified for recovery, unavailable verifiers,
noncoding work, or other mutation paths.

Four focused adapter checks pass. An initial test scaffold incorrectly assumed
`tool.started` exposes `verificationKind`; inspection of real ledger receipts
showed only redacted input hashes. This was corrected before any model experiment
was launched. No campaign used that scaffold. The final adapter recognizes actual
completed details and Kernel arguments rather than invented ledger fields.

The initially suspected affected-test summary collision was also ruled out:
`affected-test-verification.ts` already hashes the complete selected target list
into `targetPathSha256`, which the working-state key includes. No Runtime change
was made for that hypothesis. At the time of this adapter experiment, Runtime/
Contracts source and compiled files were byte-identical to `contract-first-v1`.
The later integrated implementation below has its own snapshot and validation.

Queue, NDJSON and mixed-service feasibility campaigns completed under
`~/.cache/napier-seven-quality/pre-edit-verification-{queue,ndjson,mixed}-v1`.
Each has three paired trials. Both arms use frozen `contract-first-v1` Runtime
and the same static protocol; only the candidate adapter enforces ordering.
The frozen driver `/tmp/napier-pre-edit-driver-v1` hashes its adapter helper,
reports its actual turn-pipeline identity, and enables initial-state capture in
both arms. These are new adapter comparisons, not replacement trials for the
rejected static-protocol campaign.

All **18 Runs passed independent task grading**: baseline 9/9 and candidate 9/9.
Actual source-bound invocation evidence shows pre-patch explicit test attempts
in 5/9 baseline Runs and 9/9 candidate Runs. Four candidate Runs triggered seven
real blocks (all three NDJSON Runs and mixed-service trial 3). Queue candidates
followed the protocol voluntarily, so their success does not demonstrate guard
intervention. Timing and counts do not establish full contract coverage, test
oracle correctness, or a causal quality gain.

All six mixed-service Runs passed independent HTTP observations. Managed service
lifecycles settled and all six observed loopback URLs were unreachable after
cleanup; no running OCI container or campaign worker remained. Twelve Runs with
recovered tool failures were exported: their captured initial files were restored
byte-for-byte separately from report-bound observed outputs. No fresh model
replay was substituted for any original trial. Recovery of external adapter code
and complete context/environment replay remain unqualified.

The evidence evaluator now includes an optional experimental Kernel-pipeline
identity in each arm's immutable identity. A regression test showed that changing
adapters behind one Runtime snapshot could previously be pooled; the gate now
blocks that mixture. Failure receipts preserve the adapter identity and explicitly
state that its executable code must be supplied separately. This changes evidence
handling, not the frozen experiment or any observed grade.

The two new protocol/service test files initially used Node's test runner while
root CI uses Vitest. Both failed collection under Vitest before their imports
were corrected; the original six assertions now participate in the normal suite.
Latest targeted corpus/evidence/adapter selection: **32 passed**, nine files.
SDK, CLI, Benchmark Kit, Harness Eval and Server prerequisite builds passed.
At that validation point Runtime source/dist matched `contract-first-v1`, so the
parent full Runtime result applied to the adapter experiment. It does not validate
the later integrated implementation below.

The wider root suite was also run. Its first invocation lacked compiled SDK and
Benchmark Kit prerequisites (501 passed, 38 failed, plus five collection failures).
After building prerequisites, **529 passed and 71 failed**, 113 files. Failures
include stale release/implementation receipts, source manifests, retained SDK
identity evidence, prompt expectations, and repository hygiene. This is not a
passing whole-repository check. A fresh comparison on original `c454a155` passed
OCI crash-recovery and portable-DAP receipt tests, while current source fails
them; those current receipt mismatches must not be labeled original failures.
The original comparison retained two hygiene/public-API failures.

Six Harness CLI entry points are now registered with their invocation, network
and credential requirements. External grader/reference templates are excluded
from the application dead-code graph consistently with fixture/expected source;
the staged corpus and independent-grader tests remain active. Dead-code audit now
has the same three file issues seen on the original baseline, without expanding
unused-code allowances. Public API retains the original 1897-vs-1896 semantic
export boundary; architecture retains seven previously recorded violations.
No release receipt or architecture budget was regenerated to hide a failed gate.

Evidence: `docs/artifacts/pre-edit-verification-components-2026-09-14.json` and
`docs/artifacts/pre-edit-verification-validation-2026-09-14.json`, with individual
queue/NDJSON/mixed artifacts. The quality gate has nine eligible pairs across
three cases and remains **insufficient_evidence**. The required 30-case × 3-pair
whole-composition qualification, product integration and noncoding/unavailable-
verifier/recovery behavior remain open. New paid API testing is paused under the
user's balance constraint; no default or release policy is promoted.

## Corrected core campaign rejection (2026-09-14)

The corrected corpus comparison retained 57 settled observations: baseline
**22/27**, candidate **27/30**, with unequal coverage. Its gate reports 27
comparable pairs, `regressed`, and `promotionReady: false`. Queue trial 1 passed
on the baseline and failed on the candidate despite reported completion. The
candidate changed the original async API to a function that throws synchronously
for invalid concurrency, which fails the frozen Promise-rejection check.

An additional check on both unchanged outputs independently confirms a concrete
contract violation: candidate accepts a supplied `signal: null` and starts a job;
baseline rejects it before dispatch. README requires any supplied signal to be
an AbortSignal and all validation before any job. The rejection therefore does
not depend solely on the synchronous-versus-Promise validation boundary. Candidate
queue trial 3 also skips sparse array holes, and NDJSON trial 3 fails an invalid
input check, but those corresponding baseline trials were incomplete and are
not called additional paired regressions.

The supervisor was stopped after detecting the comparable regression; four
in-flight jobs were cancelled and remaining cases were unscheduled. No failure
was replaced, no grader or source snapshot was edited, and no new campaign has
been started as a retry of the same candidate. Evidence:
`docs/artifacts/core-corrected-quality-rejection-2026-09-14.json`.

## Node verification freshness and rejected paired component (2026-09-14)

`verification-workspace-snapshot.ts` gives Node checks the same whole-workspace
freshness boundary already used by Python. CWD still selects execution, while
before/after snapshots include directories and dependencies elsewhere in the
workspace. A changed or incomplete snapshot cannot attest a stable pass; receipts
and tool output expose snapshot status. Task working state can now distinguish
current and stale subdirectory checks without requiring a root-CWD repeat.
This remains an optimistic bounded scan, not an atomic filesystem lock; large
or incompletely observed workspaces cannot establish stable verification.

Three real-process regression tests all failed before the change and pass after:
subdirectory freshness with an outside-CWD dependency, a verifier-side file
change, and an incomplete workspace snapshot. Related checks: **24 passed,
1 optional OCI test skipped**. Runtime compiled; architecture remains at seven
pre-existing violations. Full Runtime: **2602 passed, 59 skipped, 2 original
failures**, 521 files, 310.63 seconds. No budget or tool-description limit changed.

The frozen `node-freshness-v1` comparison used the unchanged mixed-service case
and HTTP observer, with identical coding-python/tail/request-aware composition
in both arms. Three trials per arm were scheduled. Candidate trial 2 **regressed**:
the Agent converted `raw` with `String(raw)` and therefore accepted numeric input
despite the string-only contract. Public tests, typecheck and real HTTP service
checks passed, but the independent grader rejected the implementation. The
corresponding baseline passed. This is a semantic input-validation omission;
correct freshness metadata is not a guarantee of code correctness.

Collection was stopped. Baseline trial 3 had already finished before its stop
signal (failed Run); candidate trial 3 was terminated. All five settled results
are retained: baseline **2/3**, candidate **1/2**, with two comparable pairs and
`regressed`. For those two pairs, verification calls were 9 vs 6, and actual
capsules contained 17 vs 0 `scope_not_observed` exposures. These observations
demonstrate the metadata mechanism, not a speed/cost gain or quality acceptance.
Across all retained runs the unpaired baseline adds three verification calls
and nine exposures; it is not pooled into the paired comparison.

The first audit only enumerated trials 1–2 and omitted the concurrently settled
third baseline result. The corrected v2 audit includes all five results; original
Run reports, rejected candidate and initial audit remain unchanged. Evidence:
`docs/artifacts/node-verification-freshness-comparison-v2-2026-09-14.json`.
Validation logs and the reviewed-outcome initial-input export are hash-bound in
`docs/artifacts/node-verification-freshness-validation-2026-09-14.json`.

## Mixed TypeScript/Python service acceptance (2026-09-14)

`benchmarks/harness-optimization/mixed-service-v1` now exercises the original
mixed-service acceptance requirement: repair a browser TypeScript form module
and a Python quote API, verify frontend types/tests and Python tests separately,
then start, poll and cancel the real development service. A Node development
server transpiles the frontend in memory and proxies to the Python HTTP backend
inside one OCI container. Only the two implementation files may change.

Corpus preflight rejects the initial defects and either single-sided repair;
the complete reference passes public tests, an independent capacity/validation
oracle, and TypeScript checks. Four checks also pass inside the pinned read-only,
network-none OCI image. A real adapter service preflight passes seven HTTP checks
and verifies that termination closes the loopback projection. Evidence:
`docs/artifacts/mixed-service-preflight-2026-09-14.json`.

Real DeepSeek Run `run_9cfa21571fff49c09975`, frozen `stream-timing-v1` with
`coding-python.v1` / tail / request-aware composition, **passed**. It modified
only `frontend/booking.ts` and `backend/quote.py`, passed the independent grader,
and executed separate frontend typecheck, frontend tests and Python tests.
Capsules bind all verification arguments to their actual receipts. The same
managed process received start/poll/cancel, was already cancelled before harness
cleanup, and its loopback URL was closed afterward. An independent observer
verified served HTML, both compiled browser modules and actual Python API
responses (exact capacity, denied capacity, invalid Boolean) while that service
was alive. The Agent accurately reported that it did not issue the observed
probe traffic and did not claim browser rendering acceptance.

The Run also exposes a conservative projection limitation: successful Node checks
with non-root cwd become `scope_not_observed`, causing repeated checks before a
root-relative target establishes current evidence. One call was rejected because
it combined `affectedBy` with typecheck and a target; another completed-but-failed
check passed a `.ts` source as the tsconfig target. Both are retained, including
the original failure bundle and initial-input export. No Runtime or active core
campaign files were changed to conceal them. This is one component acceptance,
not a paired quality result or browser rendering check. Evidence:
`docs/artifacts/mixed-service-component-2026-09-14.json`.

## Grouped memory v3 and priority correction (2026-09-14)

`task-memory-grouping.ts` implements explicit `task-aware-grouped-v3` using
source-affinity ordering and exact text grouping. All authorized, reviewed,
source-current facts remain candidates under the existing 6000-character budget.
Shared source message identities or exact current file path/hash pairs connect
facts; a shared thread or task title alone does not. Affinity only raises
zero-score candidates above other fallback candidates. It cannot outrank direct
lexical hits or general categories, and an unmatched general category alone does
not seed affinity expansion.

Identical category/content bodies render once, retaining every eligible fact ID
and a content hash in `grouping.renderedGroups`. Different categories, different
content, and conflicting values remain distinct. Freshness and authorization
filtering precede grouping, so a revoked/foreign/stale duplicate cannot enter a
rendered group. The highest-confidence/newest duplicate supplies tie-break
metadata. Startup and per-invocation receipts expose grouping separately from
candidate selection and budget truncation. Existing preset IDs keep memory v1;
the rejected selective-v2 behavior and all its failure evidence remain retained.

The initial grouping implementation could lift a source sibling above weaker
direct hits or general constraints. Two priority tests failed before the fix and
pass afterward. Source-only expansion now scores 0.5, below general categories
at 1 and lexical hits above 2; existing positive priorities remain unchanged.
The corrected focused set passed **57 checks**. Full Runtime: **2641 passed,
59 skipped, 2 original failures**, 524 files, 299.43 seconds. Compilation and
formatting passed; architecture remains at seven original violations without
raised budgets. The parent grouping snapshot separately passed 2639 tests with
the same two original failures; its observations are kept separate.

The measured `memory-priority-v1` comparison used the same DeepSeek Flash model,
initial prompts, memory seed contents/scopes, initial workspace and run budgets.
Both scenarios completed three paired trials against frozen `node-freshness-v1`
with memory v1; other explicit policy fields match. Complete private invocation
capsules were re-read and each rendered memory line was reconstructed from the
stored fact and grouped source IDs.

| Latest measured component                                  |   Baseline v1 | Grouped v3 with bounded priority |
| ---------------------------------------------------------- | ------------: | -------------------------------: |
| Original unlinked bilingual-rule question                  |   3/3 correct |                      3/3 correct |
| Source-linked rules with workspace/agent duplicate context |   0/3 correct |                      3/3 correct |
| Relevant-rule recall in the larger case                    | 3/6 exposures |                    6/6 exposures |
| Actual memory characters per larger-case invocation        |          5997 |                             4474 |
| Rendered unrelated lines per larger-case invocation        |            11 |                                8 |

In the larger case, two related rules share a current `tariffs.txt` source
version. Eight unrelated text bodies each exist at workspace and current-agent
scope, a supported production state. Baseline budget allocation omits the
Chinese member rule and answers 599 cents; candidate retains it and answers
399 cents. Candidate represents all 18 eligible fact IDs in 10 rendered lines.
Memory characters decrease by 25.4% in this scenario. This is not a token,
latency or cost claim, and no general failure-rate estimate follows from it.

The parent `grouping-v3` snapshot also completed three source-transition pairs
(edit, restart and archived-constraint handling): both arms passed all six Runs,
with no stale/unapproved fact delivered. Its 18 baseline versus 19 candidate
invocations still expose unrelated unique context, so grouping does not establish
a general reduction of irrelevant material. The priority-corrected snapshot has
its own bilingual/larger-case runs; parent metrics are not pooled with them.

The first larger-case fixture failed before model execution because repeated
same-scope proposals are already deduplicated by `MemoryRepository`. A new
fixture uses workspace/current-agent duplicates; the failed setup is retained.
The runner's raw-seed `unrelatedDelivered` boolean mismatches trailing whitespace
in this fixture; the final audit ignores it and derives actual line/character
counts from normalized facts and hash-bound capsules. Original reports remain
unchanged. Direct no-tool Runs correctly lack production initial-file capsules
because `read_file` is disabled; no successful file-input export is claimed.

Evidence: `docs/artifacts/memory-grouping-components-2026-09-14.json` and
`docs/artifacts/memory-grouping-validation-2026-09-14.json`. These component
results do not satisfy the required 30-distinct-case × 3 whole-composition gate.
Unique unrelated facts and fixed-budget omissions remain limitations; no default
policy promotion or broad semantic-recall qualification is claimed.

## Memory selection rejected on bilingual rule recall (2026-09-14)

A separate diagnostic scenario asks an English question requiring two reviewed
business rules: an English standard shipping fee of 599 cents below the free
threshold, and a Chinese decision deducting 200 cents for members (floor zero).
The request explicitly requires applying relevant rules regardless of their
recorded language. The correct answer for a member subtotal of 1000 cents is
**399 cents**. All three seeded facts, including one unrelated artwork fact,
are active, authorized and reviewed; there are no source freshness differences.

The first paired trial failed the quality gate. Baseline
`run_41ab8a9d8b954d88b7af` received both rules and returned **399**. Candidate
`run_c051184ce7a448e6902d` received only the English rule and returned **599**,
although its Run status was `completed`. Inspection of the complete hash-bound
invocation context confirms the Chinese rule is absent everywhere. Relevant
fact recall was **2/2 vs 1/2**. Selection recorded one match and excluded two
facts: the unrelated artwork and the necessary Chinese decision.

The campaign planned three paired trials and stopped after this first observed
regression. The earlier successful source-transition component remains retained
and is not pooled with this result. **The selective-v2 policy is rejected for
promotion.** Its no-match fallback does not protect a multilingual or multi-rule
request when one fact matches lexically. A subsequent design must distinguish
absence of lexical evidence from evidence of irrelevance and validate mixed
language recall before repeating broad qualification.

Both Runs explicitly enabled no tools and prohibited file access. Production
initial-file capture was unavailable because `read_file` was not enabled; the
hashed diagnostic matches `capture_file_access_unavailable`. The reviewed-outcome
export correctly refused the missing initial capsule. It did not modify Run
state, ledger events or the result. The external driver's exact prompt, seed
contents, empty initial workspace specification, profile, results and invocation
capsules remain available; no production reconstruction success is claimed.
Evidence: `docs/artifacts/memory-selection-quality-rejection-2026-09-14.json`
and `docs/artifacts/memory-selection-rejection-analysis-2026-09-14.json`.

## Explicit memory selection and component comparison (2026-09-14)

`task-memory-selection.ts` adds opt-in `task-aware-selective-v2`. It selects
lexically matched facts plus eligible preference/constraint/identity/behavior
facts when the authorized, source-current index has a match. Empty queries and
queries without a match retain the original ranked fallback. Selection happens
before the existing character budget; semantic exclusion and budget truncation
are reported separately. Both startup and every model invocation record the
selection mode, query-term count, eligible/matched/candidate/excluded counts and
`sqlite-fts5-selective-v2` retrieval version. The index still reconciles the full
eligible set, including candidates not delivered in that invocation.

The new strategy is bound through an explicit hashed Harness profile. Existing
`coding-node.v1`, `coding-python.v1`, `research.v1` and implicit defaults keep
their previous memory strategies. Runtime-owned tails are removed before
invocation memory query preparation; the latest eight user messages still
provide terms for terse continuations. No lexical match preserves recall for
empty, synonymous or cross-language queries, but **a partial match can still
omit a relevant fact expressed differently**. This strategy is not semantically
qualified, and its fallback deliberately retains the previous precision limit.

Nine new checks failed before implementation. The expanded focused selection
passed **36 checks** covering Chinese terms, source changes, dependency paths,
general categories, terse continuation, no-match fallback, permissions,
corruption/reopening, read-only index behavior and profile binding. Compilation
and formatting passed; architecture remains at seven original violations with
no increased budgets. Full Runtime: **2620 passed, 59 skipped, 2 original
failures**, 522 files, 299.22 seconds. No new failure was observed.

Frozen `memory-selection-v2` versus `node-freshness-v1` completed three paired
repetitions of one two-stage source-transition scenario using the same DeepSeek
Flash model and equal initial inputs/budgets. Each repetition edits a shipping
policy, then restarts the process for a read-only request after archiving a
constraint. **Both arms passed all six Runs**; restart inherits its own prior
trajectory and is not an independent equal-history trial. Actual hash-bound
capsules were re-read, not inferred from event counts.

| Actual invocation measure                     | Baseline v1 | Selective v2 |
| --------------------------------------------- | ----------: | -----------: |
| Agent-turn invocations                        |          18 |           20 |
| Eligible relevant facts recalled / available  |     18 / 18 |      22 / 22 |
| Unrelated / all delivered fact exposures      |     18 / 36 |       6 / 28 |
| Unrelated / all rendered fact-line characters | 1476 / 3306 |   492 / 2778 |
| Stale or unapproved fact deliveries           |           0 |            0 |

Candidate edit invocations excluded the unrelated artwork fact. All six restart
invocations used `fallback_no_match` and still delivered it. Different trajectory
lengths explain different exposure denominators; these are repeated exposures,
not independent memory samples or evidence of speed/cost gains. Unrelated
character share decreased from 44.65% to 17.71% within this component. Automatic
memory extraction generated differing unreviewed proposals after each edit;
the audit checks operator seeds separately and verifies that none of those
proposals was delivered. Original inputs, results and rejected earlier
campaigns are preserved. This result does not satisfy the 30-distinct-case × 3
quality gate and does not promote any composition.

Evidence: `docs/artifacts/memory-selection-comparison-2026-09-14.json` and
`docs/artifacts/memory-selection-validation-2026-09-14.json`.

## Measured memory precision limitation (2026-09-14)

A fresh hash-validated audit of the six source-transition invocation capsules
measures **6/6 eligible relevant fact exposures recalled**, with no stale or
unreviewed/rejected fact delivered. However, **6/12 delivered fact exposures were
unrelated**, accounting for 492/1102 (44.65%) rendered fact-line characters.
After the relevant facts became stale/archived, the two restart invocations still
received the unrelated approved fact. This follows the current spare-budget
fallback and does not demonstrate irrelevant-context reduction. These are repeated
exposures from two existing Runs, not independent new trials; the character ratio
excludes wrapper text and is not a token ratio. Both task outcomes remain correct.
Evidence: `docs/artifacts/memory-exposure-metrics-2026-09-14.json`.

## Current research composition and external-failure export gap (2026-09-14)

`research-current-composition-v1` completed six fresh Runs with original
`c454a155` versus frozen `stream-timing-v1`, using `research.v1`, tail delivery
and request-aware finalization. All inputs and earlier research observations
remain separate. The mechanical result is baseline **0/3**, candidate **1/3**;
all three baseline outputs were relocated under the generated-output directory,
while all candidates wrote the requested root-relative files.

Source review lowers the assessed candidate score to **0/3**. Trials 1 and 2
omit the `xhigh/max` special branch from the citation supporting the complete
level set. Trial 3 passes structured grading but claims that omission is the
wrapper's only way to disable thinking, despite its supported `off` path.
All candidates infer no `reasoning_effort` transmission from an absent metadata
field. The complete SDK file, verified byte-identical to the source provenance,
shows `getCompat` merging a detected default. The supplied excerpts do not
justify the reports' unconditional inference. A token ceiling likewise does not
prove a cost or latency guarantee. Original reports and mechanical grades are
unchanged; manual review is recorded separately. This remains one case, not
research-policy qualification. Evidence:
`docs/artifacts/research-current-composition-2026-09-14.json`.

All six Runs have original-input/final-workspace campaign bundles. Production
capsule export succeeded for candidate trial 3, which contains a recovered tool
failure. The original baseline predates initial capture, so its three exports
correctly report missing capsules. Export also refused the two completed
candidates whose artifacts failed the independent grader without a `tool.failed`
event, despite their available original capsules.
That exposed a failure-evaluation gap, now addressed by the post-run export
change below; the original rejected export receipts remain retained.

## Exporting externally reviewed failures (2026-09-14)

`external-outcome-review.ts` and `exportRunInputReproduction` now support an
optional caller assessment for an already-completed Run. The CLI accepts
`--external-outcome-review <review.json>`. The review binds Run, Thread, captured
configuration, the normalized prompt actually sent, and an external evidence
SHA-256; it must declare a failed outcome, a review method (`external-grader` or
`human-review`), and the canonical review hash. Wrong bindings, altered hashes,
unknown fields, active Runs and missing initial capsules are rejected.

Exports with a review use reproduction schema 2 and retain `originalStatus`.
The review is explicitly marked `caller_assessment`; its hash is not treated as
reviewer authentication or proof of task failure. `qualificationReady` remains
false. Existing exports without a review retain schema 1 and their eligibility
rules. No permission, Run status, model invocation or ledger event is changed.

The two real research Runs previously rejected solely for having no tool failure
now export successfully. All five initial files in each match the frozen inputs,
and complete original state/event snapshots plus original result bytes remain
unchanged. An initial driver used the raw benchmark prompt hash, including its
trailing newline, and was correctly rejected; the corrected driver uses the
actual initial-capsule prompt hash. The failed attempt is retained, and neither
Agent Run was repeated.

Eight focused capture/export tests passed. Runtime compilation passed. The first
architecture check exposed complexity 26 in the exporter; moving optional-review
resolution into its own module restored the original seven violations without
raising limits. Current Runtime source differs from frozen `stream-timing-v1`
only in the exporter and new review module; Contracts source/dist are unchanged.
These are post-run diagnostic changes, not a new Agent quality result.

The complete Runtime suite subsequently finished with **2599 passed, 59 skipped,
2 original failures**, 520 files in 301.14 seconds. The failures remain the
capability-vector and production Skill-readiness expectations. Formatting and
`git diff --check` passed. Evidence:
`docs/artifacts/external-outcome-export-2026-09-14.json`.

## Current format-preference qualification (2026-09-14)

A separate attempt at full-corpus format calibration used frozen `tool-surface-v2`
in **both** arms with identical `coding-python.v1`, tail delivery and request-aware
finalization. The sole profile difference was the model/API/coding-phase preference:
structured replacement versus hashline. A private copy of the suite scheduler
forwarded these existing campaign options and recorded its script hash; no active
campaign helper, Runtime snapshot or case input was changed.

The first fully comparable HTTP pair **regressed**: baseline passed, candidate
reported completion but failed the independent validation grader. Its implementation
omitted mandatory `nowMs` validation and defaulted missing time to zero in a parser
call. Both actual successful edits used `replace`, not `hashline_replace`; therefore
neither hashline adoption nor causation by the hashline executor is established.
Contract-grounding guidance did not prevent this occurrence and is not a semantic
correctness guarantee.

The calibration attempt was stopped after that pair. Both in-flight case jobs
received cancellation and the remaining cases were not scheduled. The immutable
suite result is `regressed`, inputs remain stable, and collection is incomplete.
Original failures, input capsules and observed final files were preserved. Evidence:
`docs/artifacts/hashline-preference-quality-rejection-2026-09-14.json`.
No preferred-format entry was promoted or substituted for the existing default.
The two independently frozen original-baseline campaigns continue separately.

## Corpus conflict and corrected v2 (2026-09-14)

Manual review of the glob failures found an evaluation-input contradiction:
`path-glob-selection-v1/fixture/README.md` declares `_` as the multi-character
wildcard and prohibits `_` in paths, while public tests, reference and independent
grader use `*`. A reference passing those tests did not establish consistency with
the written task. The mismatch is hash-verified in both frozen campaign inputs:
`docs/artifacts/core-corpus-contract-conflict-2026-09-14.json`.

Both affected suite supervisors were stopped, their in-flight jobs cancelled and
all original scores/inputs retained. `core-contract-guidance-suite-v1` retained
135 settled observations (baseline 50/68, candidate 64/67);
`core-tool-surface-suite-v2` retained 47 (baseline 18/22, candidate 25/25).
Coverage is unequal and neither collection is complete. Their mechanical gates
report insufficient evidence and no paired regression, but the conflicting case
also invalidates any claim of full-corpus qualification. These runs are not pooled
or continued under altered inputs.

`harness-core-quality-suite-v2.json` keeps 30 distinct task families and replaces
the glob case with `path-glob-selection-v2`, whose literal wildcard tokens use
Markdown code spans. It also replaces the binary case with
`binary-frame-decoder-v2`: the old grader rejected valid Buffer payloads solely
because their prototype differs from Uint8Array. The new grader checks Uint8Array
membership and bytes, plus fragmented and coalesced input/output ownership. It
accepts owned Buffer results and rejects ordinary arrays and shared input bytes.

Corrected-corpus checks: **38 tests passed**, including reference/public-test
agreement, documented star/underscore behavior, positive Buffer and negative array/
alias counterexamples, and 30 unique snapshotted task inputs. Original v1 files
remain unchanged. A separate reassessment of six hash-bound original binary
outputs retains exactly the original scores: baseline 0/3, candidate 2/3. The failed
Buffer implementation also violates ownership, so fixing the prototype check does
not turn it into a pass. These are unchanged-output checks, not new paired trials:
`docs/artifacts/binary-grade-reassessment-2026-09-14.json`.

Both corrected references also passed their public tests and independent graders
inside the pinned OCI image: **four checks passed**, with a read-only mount/container
and no network. Evidence:
`docs/artifacts/core-corpus-v2-preflight-2026-09-14.json` and
`docs/artifacts/core-corpus-v2-oci-preflight-2026-09-14.json`.
A fresh full comparison now uses original `c454a155` versus frozen `stream-timing-v1`
on the corrected v2 suite, with the same `coding-python.v1`/tail/request-aware
composition and input capture. It retains the 30-case/three-pair gate and shares
no scored observations with earlier candidates or revised case versions.

## Thirty-case core corpus (2026-09-14)

`benchmarks/harness-core-quality-suite-v1.json` now contains **30 distinct task
families**, retaining only one shipping-family representative. Fourteen new
cases cover SemVer, TTL/LRU, HTTP byte ranges, SQL binding, nested savepoints,
JSON Patch, weighted routes, resumable uploads, binary frames, path globs,
streaming CSV, business calendars and Source Map VLQ, plus mutable BM25 search.
Contracts, deliberately defective initial sources, public tests and independent
outcome graders are separate; the Agent sees neither the reference nor grader.

Preflight: **33 tests passed** across corpus/domain/suite checks. Every initial
implementation is rejected and its complete reference accepted. New cases also
pass their public tests. Independent checks include actual SQLite execution,
Python CRC32/date oracles, exhaustive path enumeration, and state/fragmentation
traces. Validation caught a SemVer reference sign error and SQL grader string
escaping error before any model campaign; both were corrected and revalidated.
No original campaign observation or frozen input was changed.

Evidence: `docs/artifacts/core-corpus-preflight-2026-09-14.json` binds the suite,
all case files and the final validation log. This verifies the evaluation corpus;
it does not establish Agent non-regression. The first composition comparison used
original `c454a155` versus frozen `input-capture-v2`, with `coding-python.v1`,
`tail-v1`, `request-aware-v1` and opt-in initial input capture. At that launch,
Runtime and contracts source/dist were verified byte-identical to that snapshot.
The unchanged gate requires three paired trials for each of all 30 cases.

The 14 new references additionally passed their public tests in the actual pinned
OCI image with a read-only mount and no network. This is toolchain compatibility
preflight, not sandbox-adapter or Agent acceptance:
`docs/artifacts/core-corpus-oci-preflight-2026-09-14.json`.

The first full-corpus campaign was **stopped early and rejected** after a completed
paired regression. It retained 15 finished observations: baseline **5/7**, candidate
**7/8**; these totals have unequal coverage and must not be compared as success
rates. On the fully paired HTTP task, baseline **3/3**, candidate **2/3**. Candidate
trial 3 returned null/100 for `nowMs=-1` instead of throwing TypeError on the
nonretryable/absent-header paths. Its public tests passed, but the independent
contract grader failed. This repeats the earlier validation omission; it is not
evidence that the native verifier or finalization changes removed that defect.

All original results, input snapshots and failures are retained. Four in-flight
case jobs were cancelled after the rejection, and remaining cases were not
scheduled; neither is counted as passing. The gate reports seven comparable
pairs, `regressed`, and `promotionReady: false`. Evidence:
`docs/artifacts/core-quality-rejection-2026-09-14.json`.
Candidate failure capsules were exported privately, separately from benchmark
reproduction bundles. Three early exports were verified to restore original file
bytes, modes and normalized prompts exactly. No model replay was substituted for
the failed trial. A general verification/requirement-coverage investigation is next;
no task-specific prompt or grader exception has been added.

## Contract review investigation and observed outputs (2026-09-14)

The failed HTTP Run retained the complete README contract in every Agent
invocation after its first read. Its saved tool calls reveal extensive inline
assertions, including an explicitly incorrect assumption that `nowMs` is optional
without Retry-After. The faulty implementation was written before the finalization
reserve was delivered. This rules out missing contract text and a simple absence
of boundary testing as explanations; no isolated causal effect of finalization
has been demonstrated. The failed task and its original grading remain unchanged.

A fresh-context, read-only review feasibility experiment completed 12 real Runs:
three families, defective/reference variants, two trials each. Original request,
source snapshots and invocation evidence were preserved; variant directory names
were absent from the first model requests. HTTP's actual defect was correctly
identified in one of two reviews. Only one of six reference reviews returned an
empty findings array; the others included withdrawn/non-findings, descriptions
of correct behavior, a contradictory overflow allegation, or invalid quote/schema
bindings. Median duration was 100,656 ms. All workspaces remained unchanged.
`docs/artifacts/contract-review-feasibility-2026-09-14.json` preserves the full
assessment. This reviewer is **not integrated as an automatic completion blocker**:
a quote substring or a nonempty findings array cannot establish a behavioral
violation, and these separate Run budgets cannot be counted as equal-budget
qualification of an integrated reviewer.

Failure capture now also supports an optional **observed output** archive through
`scripts/harness-observed-workspace.mjs`. Campaign report schema 6 binds the full
pre-grader file-hash map to the settled Run. `build-harness-failure-case.mjs` accepts
`--observed-workspace /path/to/settled/workspace`; the resulting bundle retains
original inputs under `fixture/` and report-bound final bytes under `observed/`.
The external grader introduced after execution is excluded. Historical reports
without this receipt cannot have output evidence retroactively fabricated.

Observed export checks Run/hash binding, source file set and bytes, regular-file
identity, ancestor links, excluded private/runtime paths, 2000 filesystem entries,
and a 16 MiB byte limit. It uses private output directories/files and the existing
atomic bundle publication; mismatch removes the unpublished bundle. This captures
file bytes, not permissions, empty directories, dependency bytes or services.
Ten focused evidence/export tests passed. Runtime policies, hard budgets and tool
definition limits are unchanged. Real integration probes are recorded separately
from policy trials; their results do not repair or replace the rejected campaign.

Observed-output integration completed on two fresh real repair Runs (HTTP retry
and SemVer). Both tasks passed; four and two recovered tool failures respectively
were retained. Their bundles preserved original inputs separately from the final
file bytes, matched the report's settlement hashes, excluded the later grader,
and passed independent regrading from the archived output in a new process.
Artifacts: `docs/artifacts/observed-workspace-live-2026-09-14.json` and
`docs/artifacts/observed-workspace-live-v2-2026-09-14.json`. These are component
archive checks, not replacement trials for the earlier failure.

The next candidate changes only `agent-working-state-context.ts`: after a recorded
Node/TypeScript/Python source edit, the working-state context explicitly grounds
self-authored test expectations in the requested contract or established behavior
and calls for checking shared requirements across public entry points and early
returns. It introduces no new tool, mandatory review call, permission or budget.
This is a guidance hypothesis, not an enforced proof of semantic correctness.

Seventeen targeted working-state/requirements/context-delivery tests and Runtime
compilation passed. Architecture retains the same seven pre-existing violations.
Frozen candidate `/tmp/napier-harness-contract-guidance-v1` differs from
`input-capture-v2` in that one Runtime source file. A separate 3-case x 3-pair pilot
completed at `~/.cache/napier-seven-quality/contract-guidance-suite-v1`, with
identical `coding-python.v1` + `tail-v1` + `request-aware-v1` policies in both arms.
This isolates guidance within the rejected composition; the overall 30-case gate
and original-baseline comparison remain required regardless of pilot outcome.

All 18 Runs settled: **baseline 9/9, candidate 9/9**, with nine eligible pairs,
stable inputs and no paired task regression. Private invocation audits verified
the guidance in 60 candidate post-edit requests, none before the first edit and
none in baseline requests. All 18 invocation bindings passed. Recovered tool
failures remain recorded: baseline 11, candidate 15; neither this count nor the
concurrent scheduling establishes a cost or latency improvement. The gate remains
`insufficient_evidence` because there are only three distinct cases. Evidence:
`docs/artifacts/contract-guidance-component-2026-09-14.json`.

A new full-corpus comparison has started at
`~/.cache/napier-seven-quality/core-contract-guidance-suite-v1`: original
`c454a155` baseline versus frozen `contract-guidance-v1`, 30 cases x three paired
trials, with the same candidate composition and opt-in initial-input capture.
Current Runtime/contracts source and compiled files matched that candidate before
launch. The previous rejected campaign and component pilot are separate evidence;
their trials are not pooled into this comparison. No default policy is promoted.

The complete Runtime regression after the guidance change recorded **2590 passed,
59 skipped, three failures**, 518 files, 304.11 seconds. Two failures are the
existing capability-vector/Skill-readiness expectations. The additional extension
package update test expected a lifecycle change even when two signatures had
identical millisecond creation timestamps. An unchanged focused rerun passed all
seven tests; controlled equal-clock probes reproduced the missing lifecycle flag
in both original and candidate frozen Runtimes. Explicitly changing expiry makes
both produce the expected flag. The test fixture now supplies that expiry and
retains all assertions; its seven focused tests passed. No production source or
active snapshot changed, and no second full-suite pass is claimed. The original
failure and probe setup error remain in the hashed logs:
`docs/artifacts/contract-guidance-runtime-validation-2026-09-14.json`.

## Real steering and interrupted-edit scenario (2026-09-14)

`harness-scenario-controller.mjs` drives ordered real Runtime control actions:
observe a completed edit, queue a user revision after a passing verification,
observe that exact control message's delivery, then request interruption after
the next settled edit. It isolates Run/Thread identities, serializes callbacks,
does not repeat triggers and retains observer failures even when the Runtime's
best-effort event sink would swallow them. It never supplies tool results or
edits workspace files for the Agent.

`run-harness-recovery-scenario.mjs` and the separate `steered-fee-policy-v1` case
exercise revised numeric requirements, unchanged validation and allowed paths.
The scenario is deliberately outside the static 30-case suite: its grader checks
a later user amendment. Controller and independent corpus preflight: **seven
tests passed**, including rejection of legacy values and missing validation,
reference/public-test agreement and TypeScript compatibility.

The first real candidate probe executed all four controller stages, but its
AbortSignal produced the legitimate `cancelled` terminal state. The recovery API
correctly refused that Run. This was a driver-design failure, not evidence of
broken unexpected-interruption recovery. It is retained in
`docs/artifacts/steered-recovery-driver-rejection-2026-09-14.json`.

The revised driver uses a dedicated worker that exits after the durable edit
receipt, without Run cancellation/finalization. A supervisor waits for actual
process exit before startup reconciles the unavailable process owner in this
isolated database and invokes manual recovery. Inputs are frozen privately;
no Run state or lease is manufactured. The real probes run separately
from the full-corpus comparison. Recovery acceptance additionally checks parent
binding, delivered amended working state with stale verification, independent
final behavior, permitted paths and a new verification matching final file bytes.
These are component checks; neither repeated/automatic compaction nor broad
quality qualification is established by this scenario.

The second real probe established actual source-process exit (86), a new recovery
Run bound to the interrupted source, retained amended working state with stale
verification, and a fresh check matching final bytes. Its independent behavior
grader passed and only `src/fees.mjs` changed. Nevertheless the Run **failed**:
the final capability guard interpreted "no write targeted any file other than..."
as absent write capability. Both attempted final reports reproduced that false
claim. The failed outcome is retained in
`docs/artifacts/steered-recovery-capability-failure-2026-09-14.json`.

`capability-availability-guard.ts` now distinguishes absent activity through a
completed-action predicate and optional execution-scope phrase. It retains
capability/access qualifiers and modal denials, including "No write in this run
is allowed." The initial regression test failed against the old code; an initial
grammar attempt also missed that modal denial and was corrected. Four focused
guard/publication tests passed. Both original final-report texts now produce no
unavailable-tool claim, bound by their event IDs and text hashes. Runtime compiled.
The full Runtime test completed: **2591 passed, 59 skipped, two original capability
failures**, 518 files, 305.75 seconds. The earlier extension-package clock fixture
failure did not recur. Architecture retains seven existing violations, with no
new violation or increased limit. The new frozen
`/tmp/napier-harness-capability-activity-v1` changes only this Runtime source file
relative to `contract-guidance-v1`.
The still-running 30-case comparison retains its original frozen candidate and
cannot be claimed as qualification of this later grammar change.

The third probe, using the grammar correction, **completed successfully**. Its
dedicated source process exited with code 86; production startup recorded
`run.interrupted`, with no source `run.cancelled`. The new Run inherited the
source, retained the revised requirement and stale verification in its first
actual invocation, and executed a fresh verification matching final file bytes.
The independent grader passed and only `src/fees.mjs` changed. Actual source and
recovery model-response identities were both DeepSeek V4 Flash, invocation
bindings passed, and settled output hashes still match the files. Evidence:
`docs/artifacts/steered-recovery-component-2026-09-14.json`. This one successful
mechanism probe does not replace either original failure or the broad quality gate.

The successful revised-requirement workspace was then copied without its external
grader for **two real manual thread compactions**. Each workbench preview/applyFork
cycle was followed by a fresh Node process and a real read-only Agent Run. Both
first-invocation capsules delivered the checkpoint and working state, passed their
bindings, and both Runs performed a fresh `verify_workspace`. They correctly
reported fee 9, threshold 120, expedited surcharge 3, and that README's old values
were no longer current. No workspace bytes changed. Evidence:
`docs/artifacts/amended-repeated-compaction-2026-09-14.json`.
This establishes repeated manual compaction of this amended task, not natural
automatic same-Run compaction, long-window performance or paired qualification.
The real model context metadata was not lowered to trigger artificial compaction.

## Stable tool surface diagnostics (2026-09-14)

Fixed-phase selection checks cover three serving-model families and six task
prompts, each available ordinary tool individually, accumulated use in both
orders, and reversed registration order. All selected definitions remain identical
within each phase. Plan lifecycle, changed admission and genuine user revisions
remain legitimate reasons to select a different surface; no extra pinning layer
was introduced.

`tool-surface-projection.ts` now supplies Run/purpose-local monotonic revisions
and observed membership/definition/order changes. `prompt-cache-projection.ts`
records these in schema 2 with its existing invocation-envelope hash. It records
observed changes only, not inferred authorization decisions or provider cache hits.
The existing model-harness resolution receipt and Agent request are unchanged.

Remeasuring 18 completed real Runs exposed that the old tool digest also included
runtime-only tool fields omitted by model invocation capsules. Schema 2 projects
only model-visible name, description, parameters and constrained sampling. Tests
show that labels/callbacks cannot invalidate this digest, while constrained sampling
and actual parameter changes do. Source compilation and **43 focused tests** passed;
architecture retains the same seven pre-existing violations without increased limits.

The read-only capsule audit covers **220 invocations**: 202 legacy runtime-tool
hashes differ from the model-visible hashes. All non-hash metrics are reproduced
exactly; 36 first observations start separate Run/purpose streams, and all 184
subsequent observations retain the same tool surface. This is remeasurement of
prior executions, not new model calls or a demonstrated cache/cost improvement.
Evidence: `docs/artifacts/tool-surface-capsule-audit-2026-09-14.json`.

The first two settled new-candidate Runs additionally produced **21 real schema-2
projection events**, all exactly recomputed from their bound model invocation
capsules. Both tasks passed. This fixed interim audit is retained in
`docs/artifacts/tool-surface-live-validation-2026-09-14.json`; those Runs remain
ordinary observations in the ongoing campaign, not additional or replacement trials.

Frozen `/tmp/napier-harness-tool-surface-v2` includes the capability-activity
correction and these diagnostics. Runtime and Contracts source/dist match the
checkout, and both package aliases resolve into this new snapshot. The preliminary
v1 freeze failed on one Contracts `.tsbuildinfo` mismatch; no model campaign used
it. Original audit failure logs and historical projection events remain retained.

A separate original-baseline 30-case x three-paired-trial comparison now runs at
`~/.cache/napier-seven-quality/core-tool-surface-suite-v2`, using `coding-python.v1`
with `tail-v1`, `request-aware-v1` and initial-input capture. The older
`core-contract-guidance-suite-v1` campaign continues unchanged. Results from the
two frozen candidates will not be pooled; neither campaign is yet complete and
no default policy has been promoted.

## Primary model stream timing (2026-09-14)

`model-stream-timing.ts` observes the existing Kernel model-call extension's
`around` boundary. Each primary invocation records monotonic time to the first
nonempty SDK content delta, its kind (thinking/text/tool arguments), first text,
and terminal duration, bound to the actual context envelope and serving model.
Metadata-only/terminal-only streams retain null first-content times. This measures
host-observed SDK chunks, not provider-wire token arrival. No text is retained.

The observer neither prefetches nor changes request parameters, event objects,
result identity or cancellation ownership. Optional observation failures cannot
replace original errors. The event type is registered through Contracts; no task
exception was added to the primary loop. **62 focused tests** passed, and the
four-test Kernel integration rerun additionally verifies real invocation/timing
bindings (overlapping selection). Initial compilation required registering the new
event; an excessive type-only Store dependency was replaced by an event-writer
port. Architecture retains seven original violations without raised limits.

The full Runtime run completed with **2598 passed, 59 skipped, two original
failures**, 519 files, 330.29 seconds. Frozen `/tmp/napier-harness-stream-timing-v1`
matches Runtime/Contracts source and dist and resolves both package aliases into
itself. A real TTL/LRU task completed, passed the independent grader and allowed
path checks, and emitted **13 hash-valid timing receipts**, one per Agent invocation.
Observed first content ranged from 322.136 to 893.512 ms; concurrent activity and
one task do not establish lower latency or cache savings. Six recovered tool
failures remain recorded. Evidence:
`docs/artifacts/model-stream-timing-component-2026-09-14.json`.
Harness-eval, CLI, Server and Web builds also passed after the event registration:
`docs/artifacts/stream-timing-entrypoint-validation-2026-09-14.json`. This is compile
compatibility, not another browser acceptance or full policy qualification.
Earlier frozen-candidate comparisons do not qualify this later source snapshot.

## Source-bound memory across edits and process restart (2026-09-14)

Two additional real component Runs use frozen `tool-surface-v2` with a
`coding-node.v1`/tail/request-aware composition. The first Run updates only
`policy.json`, changing the free-shipping threshold from 5000 to 7000 cents and
preserving the two fees. Its first request receives the relevant source-bound
memory ahead of unrelated approved context. After the actual model edit, both
subsequent invocation capsules omit that fact and record its source as stale;
the independent general constraint remains available. The resulting file and
structured answer match the revised requirement.

A fresh process then archives the general constraint through the public store
API and performs a read-only Run in the same thread. Its two actual invocations
omit both stale and archived facts and return the current source values without
changing files. Unreviewed and rejected synthetic facts are absent from all six
Agent invocation capsules. The persistent index is reconciled and contains none
of the stale, archived, unreviewed or rejected fact IDs.

The initial driver incorrectly asserted that unrelated approved facts must also
be absent. Existing retrieval prioritizes relevant facts but can fill spare space
with other approved context. That driver failure and its original successful task
Run remain preserved; the initial model execution was not replaced. The corrected
assessment and fresh-process continuation are recorded in
`docs/artifacts/memory-source-transition-component-2026-09-14.json`.
This demonstrates source invalidation and archive reconciliation in this small
scenario, not broad memory non-regression, elimination of unrelated context, or
erasure of previously observed conversation history. It is separate from both
running 30-case comparisons and does not qualify another policy composition.

## Production initial input capture (2026-09-14)

`run-input-capture.ts` adds opt-in capture before the first model call through
`RunPromptOptions.captureInitialState` or `NAPIER_CAPTURE_RUN_INPUTS=1`. The explicit
Run option takes precedence over the environment setting. The default remains
unchanged. `recordAgentRunStarted` owns the startup sequence, reducing the large
Runtime module's dependency count; its line budget was lowered by five lines.

`run-input-workspace.ts` captures file bytes, ordinary permission bits and empty
directories, with a 2000-entry / 16 MiB / two-second scan limit and a second scan
for observed drift. It rejects symlinks and special files, checks opened-file
identity, bounds reads even if a file grows, and excludes runtime data, dependency
caches and known sensitive paths such as `.env*`, SSH keys and package credentials.
Exclusions, unsupported entries, limits and observed changes prevent a complete
workspace claim. This is an optimistic local-file capture, not an atomic snapshot
of a concurrently changing filesystem or a service/dependency image.

`run-input-capsule.ts` uses private 0700 directories, 0600 capsule files, content
hash binding, bounded storage and validation of paths, contents and ownership.
Capsules remain under the local data root's `run-inputs` directory. Only status,
counts and hashes enter the Run ledger; raw files do not enter model context.
Missing file authority never grants extra access. Capture/storage errors do not
stop normal task execution; cancellation retains the normal Run behavior. Existing
Run budgets are unchanged.

`run-input-reproduction.ts` binds the capture to the source Run, configuration,
prompt and first Agent invocation. It rejects a missing first invocation even if
a later invocation was captured. Export restores files and directories into a new
private directory, refuses to overwrite an existing output, preserves current
workspace files, and includes the original invocation capsule for context/options
inspection. The exporter requires a settled task failure or recovered tool failure.
It does not automatically restore arbitrary memory histories, installed dependency
bytes or external services, and never fabricates an independent grader.

The operator command uses a read-only SQLite transaction, with no LocalStore
initialization/migration/recovery of the source database:

```sh
node scripts/export-run-input-reproduction.mjs --workspace /path/to/workspace \
  --data-root /path/to/data --thread thread_ID --run run_ID --output /new/private/directory
```

Deterministic capture/recovery checks: **17 passed**. Contracts: **131 passed**.
Suite/evidence helpers: **11 passed**. Compile passed; architecture now has **seven
remaining pre-existing violations**, with no new violation or raised limit.
The full Runtime regression completed: **2591 passed, 59 skipped, 2 original
capability snapshot failures**, 518 files, 299.14 seconds.
Log: `/tmp/napier-input-capture-runtime-full-v1.log`.

A real DeepSeek Flash task read an existing source and a missing file. After its
process closed and the current source changed, the exporter reconstructed the
original 44 bytes. A new Node process then ran a fresh Agent against that fixture;
both Runs accurately reported the original values and the missing file, retaining
the observed tool failure and reconciled usage. Original current files remained
unchanged by export. This establishes one file-based production reconstruction
path, not general context replay or broad task qualification.
Evidence: [production input reconstruction](artifacts/production-input-reconstruction-2026-09-14.json).

A read-only scan of the actual Napier checkout hit both file-count and byte
bounds and correctly reported `partial`: 295 files, 198 directories, 16,777,208
bytes, 117 ms in one local observation. No capsule was persisted for this probe.
The scan deadline is cooperative around filesystem operations. This result
prevents treating a bounded capture of a large repository as complete evidence.
Evidence: [capture bounds](artifacts/production-input-bounds-2026-09-14.json).

Frozen snapshot `/tmp/napier-harness-input-capture-v1` is compared with
`/tmp/napier-harness-native-node-v3` in the separate `input-capture-suite-v1`:
HTTP retry and incremental NDJSON, three paired trials each. Both arms use the
same coding policy, tail context and request-aware finalization. The suite runner's
`--baseline-profile-mode policy` enables this controlled component comparison;
its default baseline behavior is unchanged. All **12 Agent executions** completed: **baseline 6/6, candidate 6/6**, six
comparable pairs with identical policy hashes, stable source inputs and eligible
dependency evidence. All six candidates recorded complete four-file captures;
no baseline recorded a capture. No paired task regression was observed.
Evidence: [input capture v1 qualification](artifacts/input-capture-v1-qualification-2026-09-14.json).

However, exporting the real HTTP candidate exposed a v1 defect: the capture hashed
the 388-byte submitted prompt, while Runtime persisted its 387-byte normalized
prompt. Export correctly rejected the mismatch. The original capsule, Run and
failed-export evidence remain unchanged. A regression test reproduces this failure;
the current Runtime now binds capture to the already validated effective prompt.
All **17** capture/recovery tests pass after the correction. An initial concurrent
compile hit the existing `ENOTEMPTY` dist cleanup issue; after the test process
settled, the separate compile passed. No build-script behavior was changed.

Snapshot `/tmp/napier-harness-input-capture-v2` freezes that correction. Both fresh
real-model HTTP repair Runs passed their independent grader, required tools and
allowed-file checks. The first Run recorded two tool failures, then completed its
repair. Read-only export restored all four original files byte-for-byte and the
normalized effective prompt, without changing the repaired current workspace.
A new process then repaired that restored fixture successfully. This validates
production export without relying on the original benchmark fixture to perform
the export; comparison against that fixture occurred only afterward. These are
separate component observations and do not inherit the v1 paired trials.
Evidence: [production code reconstruction](artifacts/production-code-reconstruction-2026-09-14.json). The full 2591-test pass count above is from before this
one-line prompt-binding correction; the post-fix checks are the 17 targeted tests
and compile. No policy has been promoted.

## Real manual compaction and process restart (2026-09-14)

A copied real HTTP-repair conversation received two additional real-model,
read-only code-inspection turns. `ContextCompactionWorkbenchService` then
compressed four of its six conversation messages and retained the latest two,
materializing a new thread branch. After closing the store, a fresh Node process
opened that branch and asked the Agent to inspect current source and execute the
existing public tests. The actual OCI native verifier receipt is **passed**, exit
0, and the workspace inventory remained unchanged.

The first post-restart model invocation capsule is hash-validated and contains
both `<context_checkpoint>` and the evidence-derived working state. The complete
forked thread passes `assertModelRequestEvidenceBindings`, establishing actual
checkpoint delivery and provenance beyond a successful preview operation.
The original campaign store/workspace was never modified; all fork and preview
mutations occurred in a separate copy. The first attempt, using a single user
turn with many tool calls, was rejected for insufficient conversation messages;
that failed log is retained and was not counted as compaction evidence.

Evidence: [manual compaction and restart](artifacts/manual-compaction-restart-2026-09-14.json)
and [delivered context and verifier receipt](artifacts/manual-compaction-delivery-2026-09-14.json).
This covers manual multi-turn compaction, branch materialization and process
restart with real model calls. It does not establish automatic in-Run compaction,
long-session performance or recovery from an interrupted write, which still need
separate qualification.

## Native Node verification and reconciled usage reports (2026-09-14)

`VerificationRunner` now selects the pinned Node executable's built-in test
runner for unambiguous native test sources. It uses parsed imports/requires,
not a text search: comments, strings and type-only imports do not establish a
native framework. Existing Vitest selection remains for scopes without native
evidence; mixed/indirect scopes are rejected rather than silently omitting part
of the test set. `testRunner=node-test|vitest` provides explicit selection for
wrappers and separately scoped mixed projects. Python retains its own `verifier`
parameter. Native full and selected verification share the existing read-only,
offline process admission, output/time bounds and two-worker limit.

Native receipts bind the actual Node executable hash and, for OCI, the existing
image-bound runtime identity. Test selection is bounded and hashed; changed
selection source is rejected after execution. Selected-test launch and shared
path/scope logic were extracted from the large verification module without
raising its architecture budget. The final architecture check retains the
original nine violations. Direct Node tests run without an installed Vitest CLI,
preserve failing outcomes and retain workspace-path checks.

The real OCI test passed all three checks, including a test that attempted a
workspace write and observed rejection. The first OCI attempt failed because
macOS's temporary directory was not mounted into Colima; its log is retained and
the fixture now uses the existing shared scratch directory. A separate component
comparison used the same correct source and public tests from the original failed
deployment Run: **old full/selected verification both failed, new full/selected
verification both passed**, with unchanged workspace inputs and the same OCI
image. This is real verifier execution, not a model task score.
Evidence: [native verifier comparison](artifacts/native-verifier-comparison-2026-09-14.json).

Campaign schema 5 now records persisted `run.usage` and a separate
`harness-usage-evidence` receipt instead of treating `model.response` totals as
complete Run usage. The receipt reconciles primary, auxiliary, discarded-attempt
and owned subagent usage, excludes mirrored assistant messages, and preserves the
legacy response-only sum for comparison. Missing/estimated discarded receipts,
invalid or foreign usage, duplicate records and persisted-total mismatches block
observed-usage comparison. This does not prove complete external billing, cache
attribution or latency. Failure bundles also retain the receipt, and its helper
is included in the campaign's immutable script identity.

Thinking-loop receipts now distinguish provider terminal usage from reasoning-byte
estimates. Locally synthesized watchdog errors can carry zero usage; they retain
the observed-byte estimate instead of overriding it with that zero. Usage,
campaign, suite, stream cancellation and terminal-recovery checks passed **34
tests** before the native verifier changes. Native verification/provider/selection
checks passed **20 tests**, with **18 conditional tests skipped**; the explicitly
enabled OCI invocation then passed its **three tests**.

The frozen `native-toolchain-suite-v1` campaign completed **18 real Agent
executions** over deployment, incremental NDJSON and bounded asynchronous queues:
**baseline 8/9, candidate 9/9**. All nine pairs have stable, eligible Runtime
dependency evidence. The baseline deployment failure was a contradicted capability
claim despite passing code checks. Eleven original task/recovered-tool failure
bundles were exported. Three cases remain below the unchanged 30-case requirement.
Evidence: [native v1 qualification](artifacts/native-toolchain-v1-qualification-2026-09-14.json).

This candidate snapshot is additionally **ineligible for promotion**: the full
Runtime suite exposed a base tool-definition size of **1748 bytes**, exceeding the
existing **1536-byte** limit. Shortening only the verification description reduced
it to **1519 bytes**, with 15 targeted checks passing and one conditional skip;
no budget was raised. The original full suite had **2582 passed, 59 skipped,
3 failed**: two pre-existing capability snapshots and this fixed tool-size failure.
The final full suite after description and usage-query corrections completed:
**2584 passed, 59 skipped, 2 failed**, 517 files, 306.34 seconds. Both failures
remain the original capability snapshots. Compile and typecheck passed.
Full log: `/tmp/napier-store-usage-runtime-full-v1.log`.

Snapshot `/tmp/napier-harness-native-node-v2` freezes the shorter description.
Its separate `native-toolchain-suite-v2` campaign completed all **18 executions**:
**baseline 6/9, candidate 9/9**, with nine comparable pairs and no paired task
regressions. All frozen inputs and dependency graphs remained stable and eligible.
The three baseline failures were two NDJSON wall-time exhaustions and one queue
capability-claim contradiction; passing code checks did not erase incomplete Runs.
Twelve original task/recovered-tool failure bundles were exported. Seventeen of
18 Runs have reconciled usage receipts; the remaining baseline lacks discarded
usage evidence, so no complete cost benefit is claimed. The 1519-byte tool surface
passes its unchanged 1536-byte limit. The quality gate remains
`insufficient_evidence` because only three cases were tested. These results are
not pooled with v1. Both frozen snapshots predate the usage-query fix below.
Evidence: [native v2 qualification](artifacts/native-toolchain-v2-qualification-2026-09-14.json).

The v1 NDJSON candidate trial 3 exposed a persisted-use discrepancy of **2336
output tokens**. Its discarded-attempt receipt records 9341 observed bytes and
`usageSource=reasoning_bytes_estimate`. Replay included this receipt, but the
SQLite aggregate query omitted both thinking-loop and context-overflow events.
The current source now shares its usage-event selection with replay; a SQLite
close/reopen test and an Agent completion assertion cover the actual persistence
path. Estimated usage still cannot establish provider billing. Original Run totals,
receipts, graders and campaigns are preserved; no historical result is rewritten.
Read-only comparison of the original database reproduces 23,884 output tokens
with the old query and 26,220 with the corrected query, matching replay.
Evidence: [usage query comparison](artifacts/usage-query-comparison-2026-09-14.json).
The store line budget was lowered from 3782 to 3773 after removing the duplicate
query list. The architecture audit again retains only its original nine violations.
The corrected source and compiled output are frozen at
`/tmp/napier-harness-native-node-v3`, with a separate freeze receipt; this version
has not yet been qualified by a new paired Agent campaign.

## Domain repair qualification and reasoning-only terminal recovery (2026-09-14)

Eight new multi-module cases cover HTTP retry scheduling, dependency deployment
waves, access rules, calendar reservations, CSV export, inventory event replay,
weighted monetary allocation and HTTP entity preconditions. Each has a complete
public contract, an original implementation, public tests, a separate reference
and an independent outcome grader. Only the named source files may change.
References and outcome graders stay outside Agent context during execution.
The cases retain the existing 40-turn / 250,000-token / USD 3 / 240-second limits.
The immutable `domain-suite-v1` campaign exercises three paired trials per case
under the existing OCI image and `coding-python.v1` composition with tail context
and request-aware finalization. Its original reports remain authoritative for
that original grading pass; no failed trial is replaced by a later successful one.

All **48 real Agent executions / 24 comparable pairs** completed with stable,
eligible dependency receipts in every Run and unchanged frozen inputs. Original
score: **baseline 20/24, candidate 22/24**, but the gate is **`regressed`** because
two passing baseline pairs have failed candidates. Aggregate improvements do not
offset those regressions. Thirty failed/recovered-tool-error bundles were exported
from the original frozen cases, including their dependency receipts.

| Case                  | Baseline | Candidate |
| --------------------- | -------- | --------- |
| HTTP retry            | 3/3      | 2/3       |
| Dependency deployment | 3/3      | 2/3       |
| Access rules          | 2/3      | 3/3       |
| Calendar reservations | 1/3      | 3/3       |
| CSV export            | 3/3      | 3/3       |
| Inventory projection  | 3/3      | 3/3       |
| Weighted allocation   | 2/3      | 3/3       |
| ETag preconditions    | 3/3      | 3/3       |

Evidence: [original domain qualification](artifacts/domain-repair-qualification-2026-09-14.json).

Separate review of weighted-allocation baseline trial 3 found an undocumented
grader restriction: the implementation correctly rejected boolean weights with
`TypeError`, while the grader required `ValueError` for every validation failure.
The public task specifies `ValueError` only for insufficient capacity. The current
grader accepts either validation class elsewhere and still requires that explicit
capacity error, rejects silently accepted invalid inputs, and preserves all
allocation/ownership checks. The independent six-output reassessment passes 3/3
on both arms, yielding **21/24 vs 22/24** for unchanged whole-suite outputs. This
is not a new Agent execution or a replacement of the original 20/24 vs 22/24 score.
The two candidate regressions remain. Grader/domain/suite checks passed **16 tests**.
Evidence: [allocation reassessment](artifacts/domain-allocation-reassessment-2026-09-14.json).

Candidate HTTP retry trial 1 omitted `nowMs` validation when the Retry-After
header was absent. This violates the public contract and remains a task failure.
Candidate deployment trial 1 repaired the source correctly, but never ran the
requested public/boundary checks or delivered a final answer. The original
terminal response had `stopReason=stop`, 8,434 reasoning characters, no text and
no tool calls; the Runtime nevertheless recorded `completed`. No finalization
reserve was active, so this is a separate premature-termination defect.

`ModelSemanticStallObserver` now recognizes reasoning-only terminal `stop` and
`length` responses, including providers that supply only a final message without
deltas. It checks both streamed progress and final text/tool blocks before
classifying the response. The existing thinking-loop guard handles this case
with at most one short retry and the same 2,048-token retry cap. A second failed
attempt follows the existing resumable failure path. Visible responses, tool
calls, cancellation and truly empty responses without reasoning retain their
existing behavior. Normal model-call reasoning options are unchanged.

The rejected terminal response's complete provider usage is charged before the
retry decision and recorded in the detection receipt. This includes input,
cache and output usage; a short reasoning body cannot hide an exhausted input
budget. Interrupted streams without final provider usage retain estimated
reasoning-byte accounting. `aggregateRunUsage` also includes discarded thinking
and context-overflow receipts in persisted Run usage and replay metrics, while
continuing to exclude assistant-message mirrors of model responses. Legacy campaign `usage` summaries only sum
`model.response` records, so discarded-attempt receipts must also be considered
before making any total cost comparison; this stage makes no cost-saving claim.

The new integration test reproduced silent completion before the fix. Related
checks passed **26 tests**; the final stream-branch consolidation passed another
**11 targeted tests**. After the durable usage correction, the final full Runtime
run passed **2,581 tests**, with **58 skipped** and the same **two original
capability snapshot failures** (515 files, 292.80 seconds). The earlier full
run with 2,580 passing tests is retained as an intermediate check. Runtime compile
passed. The release build still fails the pre-existing product-source manifest
check, and the final architecture audit retains the original nine violations.
No architecture budget was increased.

The corrected Runtime is frozen separately at
`/tmp/napier-harness-thinking-terminal-v2`; both its source and compiled files
were compared against the working checkout. The earlier `v1` snapshot is retained;
its waiting campaign launcher was stopped before any Agent execution to include
the durable usage correction in `v2`. Usage/recovery checks passed **23 tests**.
A separate three-pair deployment case rerun completed after the original campaign:
**baseline 3/3, candidate 3/3**, with six stable, eligible dependency receipts.
All six Runs performed the requested tests and delivered results. The new
reasoning-only terminal branch was not triggered by these fresh calls, so they
establish execution on the corrected Runtime; the branch-specific evidence comes
from deterministic reproduction and integration tests. Five recovered-tool-error
bundles were exported. The gate remains `insufficient_evidence` for one case.
This does not overwrite the original reports, establish a causal model-quality
win, resolve the HTTP validation failure, or qualify all eight cases on the new
Runtime. All **54 real Agent executions** in this stage are now terminal.
Evidence: [terminal recovery qualification](artifacts/thinking-terminal-recovery-2026-09-14.json).

Two additional fixtures cover incremental UTF-8 NDJSON decoding and bounded
asynchronous queues with cancellation. The stream case covers every two-chunk
UTF-8 split, CRLF framing, byte limits, duplicate JSON keys and failed/finalized
decoder lifecycles. The queue case covers actual deferred jobs, started versus
unscheduled cancellation, concurrency, rejection identity and validation before
dispatch, including sparse arrays. All ten domain references pass their public
and independent checks; originals fail their independent outcomes. Combined
domain/suite checks passed **15 tests**. These two new fixtures have not yet been
run with the real Agent. An initial NDJSON reference escaping error was corrected
before freezing or executing any Agent campaign for that fixture.

The original deployment run also exposed the existing automatic linked-test
runner's Vitest assumption for `node:test` fixtures. Such framework errors remain
tool failures; a subsequent explicit `node --test` run is separate evidence.
Native Node test-runner selection is addressed in the subsequent stage above; remaining work includes broad
quality qualification, long-session compaction/restart, production initial-state
capture and complete cost attribution. No default policy is promoted.

## Dependency attribution and source-research qualification (2026-09-14)

`scripts/harness-runtime-dependencies.mjs` resolves the installed production,
optional and peer dependency closure from the actual entry Runtime package.
It follows workspace links at package boundaries and hashes manifests, package
file bytes, executable bits and dependency edges. Nested dependencies, cycles,
missing optional packages and required-package failures are explicit. Internal
links outside a package, special files, changing files, unbounded inventories,
custom Node loaders/preloads and custom package resolution cannot silently
produce qualified evidence. Absolute package locations stay in local graphs;
Run reports carry hash-bound, Run-owned receipts.

Both frozen Runtime arms resolve 129 installed packages. Initial inspection
measured 24,572 files / 217,088,972 bytes for the original baseline and 24,199 files /
211,917,543 bytes for the current candidate. The differing counts are inventory
observations, not evidence of reduced task context or model cost. Workspace links
to earlier snapshots are now explicitly inventoried rather than assumed local.
Each campaign writes a before graph and rechecks it after every Run. Missing,
foreign, altered or changing dependency receipts block comparable-pair admission
and calibration; previously observed task/scope regressions remain visible.

Dependency/suite/campaign/environment/calibration checks passed **21 tests**.
The initial dependency test failed because macOS resolves `/var` through
`/private/var`; the test now compares canonical paths, and that initial log is
retained. A real six-execution smoke completed with stable, eligible 129-package
receipts in every Run: baseline 2/3, candidate 3/3, no paired regression and
`insufficient_evidence`. Original scoring is retained; this is pipeline
integration evidence, not a new diverse task family.

The inventory is deliberately scoped to declared installed package inputs.
Undeclared dynamic imports, OS libraries, credentials, downloaded code and
external services remain outside this graph; OCI/browser identities retain their
separate evidence. Historical reports lack contemporaneous before/after graphs.
Their original gates are retained, but a present-day scan cannot retroactively
qualify dependency stability during those old executions.

`benchmarks/harness-research-suite-v1.json` adds a separate `research.v1`
composition exercise using actual installed Pi SDK 0.82.0 source excerpts.
`SOURCES.json` records original filenames, original file hashes, excerpt hashes
and original line ranges. The Agent derives supported reasoning levels, clamp
behavior, wire behavior and a bounded recommendation, then supplies five exact
line citations and an explicit source-inspection-only verification scope.
No network response or browser capture is simulated. An independent grader
rejects wrong conclusions, budget increases, globally disabled ordinary calls,
false live-test scope, invented/stale quotes and real but irrelevant citations.
References stay outside the Agent workspace. A shorter five-line upward-search
quote is sufficient evidence; a redundant variable-declaration requirement was
removed after the first real observation. The original grader and outputs remain
frozen. The six-execution research campaign completed under `source-research-v1`:
**baseline 0/3, candidate 1/3**, with six stable and eligible dependency receipts.
All three baseline Runs wrote the requested files into generated output
subdirectories instead of their specified root paths. All three candidates used
the correct root paths. The revised structured grader accepts candidate trial 1's
short upward-scan citation, but manual source review identifies two factual prose
errors: `high` is not the highest supported level (`max` exists), and omission is
not the only disabling path (the wrapper also handles supported `off`). That Run
therefore remains a task failure. Trial 2 omits the special `xhigh/max` filtering
branch from its supporting quotation and remains failed. Trial 3 passes the
structured check and source review. The final assessed score remains 0/3 vs 1/3;
neither accurate JSON nor exact quotation alone proves an accurate research brief.

Final combined script checks: **22 passed** across dependency inventory,
comparison/calibration, environment, suite and research-grader tests. Runtime
source and compiled output were not changed in this stage, so the prior full
Runtime result is not represented as a newly executed test suite. Twelve real
Agent executions completed across the pipeline smoke and research case; all
owned campaigns are terminal. Failed and recovered-tool-error Runs were exported
from the corresponding original case snapshots, including dependency receipts.
The independent source research grade and manual review are retained separately
from the immutable original reports.

Evidence: [dependency and research qualification](artifacts/dependency-research-qualification-2026-09-14.json).
Remaining work includes validation of factual prose against cited sources,
native long-session compaction/restart scenarios, production initial-state capture
and the thirty-case qualification for the relevant compositions. This one mixed
research/coding task does not establish live web retrieval or broad research
quality, and its observations are not pooled with the coding-policy campaign.

## Cross-domain qualification and capability-aware thinking retry (2026-09-13–14)

`scripts/run-harness-optimization-suite.mjs` now executes a frozen batch of cases
through the existing real-model campaign runner. `harness-suite.mjs` snapshots
all original case inputs before model execution, rejects duplicate case IDs and
identical task inputs, traversal, symlinks and special files, and validates the
copied bytes. Its bounded scheduler retains failed jobs, stops scheduling after
cancellation and waits for every started child. Each new output directory retains
the schedule, per-arm logs, all trial reports and a separate suite result.
Collection completion is distinct from quality and promotion readiness.

The initial suite contains six cases: configuration layering, cursor pagination,
CSV ledger reconciliation, source-bound shipping memory, requested invoice report
and pricing API migration. The first three are new multi-module repair tasks.
Each has public requirements/tests, an independent hidden grader and an external
reference implementation. References and graders are excluded from Agent context;
the grader enters the workspace only after execution stops. This is still six
cases against the unchanged **30-case, three-paired-trial** qualification gate.
Concurrency four does not qualify latency, provider cache or cost attribution.

The first batch completed all **36 executions / 18 eligible pairs** using the
same immutable OCI image and explicit daemon endpoint as the debugger campaign.
Original result: `regressed`, with all source/case snapshots stable. Twenty-one
task/tool-failure bundles were exported from the original frozen case inputs.
Historical reports and the original gate remain unchanged.

| Case                         | Original baseline / candidate | Reassessment of unchanged outputs                                      |
| ---------------------------- | ----------------------------- | ---------------------------------------------------------------------- |
| Configuration layering       | 2/3 / 2/3                     | Unchanged; different failed trials, including candidate thinking stall |
| Cursor pagination            | 1/3 / 2/3                     | 2/3 / 2/3; candidate wall-time exhaustion remains                      |
| CSV ledger reconciliation    | 1/3 / 2/3                     | 1/3 / 3/3                                                              |
| Source-bound shipping memory | 2/3 / 3/3                     | Unchanged; baseline scope violation retained                           |
| Requested invoice report     | 1/3 / 1/3                     | 3/3 / 3/3                                                              |
| Pricing API migration        | 3/3 / 3/3                     | Unchanged                                                              |

Reassessment fixes three grader assumptions that were not task requirements:
money may include a currency symbol and repeated calculation lines; private
Python records need not implement equality with a deep copy; a validated cursor
decoder need not expose the protocol version in its returned key. The updated
checks retain exact values/precision, final totals in repeated calculations,
invalid version rejection, and structural mutation detection including nested
slot-based records. Grader/suite/campaign checks passed **30 tests**, including
positive alternative representations and negative controls. An intermediate
reassessment that still rejected numeric calculation lines is also retained.
These are separate hash-bound reassessments, not new Agent successes. The second
batch froze the first grader correction before the calculation-line correction;
any later reassessment must disclose that distinction.

Candidate configuration Run `run_075f4a35d5dd4331abe5` exposed a real Runtime
defect: the short thinking-loop retry requested `minimal`, but pinned Pi SDK
DeepSeek metadata advertises only `off`, `high`, `max` and clamps `minimal` to
`high`. Two approximately 90-second attempts emitted 91,488 and 95,304 thinking
bytes before deterministic finalization. No successful edit occurred.

`model-thinking-loop-guard.ts` now selects an actually supported short retry
level (`minimal`, then `low`, then optional off, otherwise the lowest mandatory
level). `agent-model-stream-lifecycle.ts` applies that choice after route options
are merged, using the actual serving candidate. Normal invocation defaults,
maximum attempts, Run limits and the 2,048-token retry cap are unchanged.
Tests cover the real SDK metadata, actual provider payload serialization and
fallback-model retry integration. The original option tests failed before the
fix; focused checks pass after it.

The exact original failed retry capsule was also sent to the real DeepSeek
provider with corrected options. The request used `thinking: disabled`, returned
`apply_patch` in **3.66 seconds**, and recorded 848 output tokens with zero
reasoning tokens. No returned tool was executed: this establishes transport and
response recovery only, not task completion. The immutable corrected Runtime is
`/tmp/napier-harness-thinking-retry-v1`. A second full batch completed under
`cross-domain-suite-v2` with the same tasks, budgets and original baseline.

Second batch original score: **baseline 15/18, candidate 16/18**, with an original
`regressed` gate because its frozen report grader still rejected calculation
lines. Separate reassessment of unchanged outputs with the final grader gives
**15/18 vs 18/18**. All five other candidate cases completed 3/3. Baseline failures
were one capability-claim rejection, one token exhaustion and one wall-time
exhaustion. No Run or model budget was increased.

The report case was then rerun for three complete paired trials with its corrected
grader: **baseline 2/3, candidate 3/3**, with no paired regression. The remaining
baseline report had the correct count followed by parenthetical invoice IDs.
The final grader separates annotations before interpreting calculation equality
signs, accepts sentence punctuation and inline Markdown, and still compares the
whole numeric token and exact monetary precision. Both report arms reassess to
3/3; this is not a new model run or a measured candidate win. Arbitrary prose in
annotations is outside this numeric grader's scope. Every earlier grader result
and intermediate reassessment remains available.

The latest fresh six-case set consists of the five non-report cases from the
second batch plus **both complete report arms** from this corrective rerun; no
individual trials were selected. Its original score is **14/18 vs 18/18**, with
18 eligible pairs, no regressions and `insufficient_evidence`; the final baseline
report reassessment raises the baseline to 15/18. The unchanged 30-case minimum
still blocks promotion. These batches contain **78 real Agent executions** in
total, plus the separate single-call retry diagnostic. Forty-three original
task/tool-failure bundles were exported from the matching frozen case inputs.
No campaign remains running.

Sanitized evidence: [cross-domain qualification](artifacts/cross-domain-qualification-2026-09-13.json).
The six-case set does not establish research-policy quality, repeated long-task
compaction/recovery, complete dependency attribution or cache/cost gains. Existing
research and workflow benchmarks have separate source-capture/restart/approval
contracts and need explicit adapters before they can contribute comparable
Harness-policy evidence. The seven-module goal remains unfinished.

Full Runtime: **2573 passed, 58 skipped, two original failures**, 514 files,
289.06 seconds. Runtime TypeScript compilation passed. The standard build still
fails its pre-existing release source-manifest check; no manifest was regenerated.
Architecture audit retains the same nine original violations, with no raised
budgets. Full-suite log: `/tmp/napier-thinking-retry-runtime-full-v1.log`.

## OCI Python debugger and environment qualification (2026-09-13)

`sandbox-container-python-debugger-runtime.ts` resolves Python and debugpy inside
the selected immutable OCI image. The bounded probe hashes the interpreter and
debugpy package and tests container-local listening. Its own named container is
removed even if the Docker client fails. `python-debugger-provider-runtime.ts`
rejects host path/interpreter overrides for an isolated provider. Session identity
binds the image, Docker client, daemon endpoint, user and package/runtime probe.
Workspace protocol paths map through the existing OCI provider; no host-direct
fallback or native macOS/bwrap network relaxation is introduced.

An optional reproducible image extension is under
`docker/napier-sandbox/python-debugger/`: immutable base image argument, pinned
debugpy 1.8.17 wheel hash, and explicit image selection. The default sandbox image,
release receipts and descriptor/architecture budgets remain unchanged. The built
arm64 image is
`sha256:9ee6f40ab58e1e022c1ae6771fdf6a6bc60419e7f74e86ccd79aedaa16c4418a`,
with Python 3.13.5. Build logs and the wheel remain local under `/tmp`.

The live OCI test passed **3/3** at 22:49. Actual debuggee operations verified
denied workspace writes, denied host sentinel reads and denied outbound TCP;
Docker inspect verified no network, read-only root/mounts and dropped capabilities.
Breakpoint, stack, evaluation, continuation and exit code zero were observed,
and the owned container was removed. Host/boundary regression: **14 passed,
1 skipped**. Full Runtime: **2565 passed, 58 skipped, two original failures**;
Runtime/CLI/Server/Harness-eval TypeScript compilation passed. The nine original
architecture violations and existing public API/release-manifest failures remain.

`benchmarks/harness-optimization/python-debugger-v1` now packages the original
shipping fixture, prompt, independent grader and debugger acceptance. The grader
requires original-source breakpoint observations in one process, one pause and
one frame, including its matching Locals reference and expression evaluation.
Invocation capsule/result hashes, admitted write effects and Run ownership are
checked; a final report alone cannot establish debugging. The previously retained
host-direct diagnostic also passes this stronger same-frame audit.

The first Agent comparison encountered a stopped shared Colima `user-v2` network
process. Both VM host agents were alive, but Docker/SSH were unreachable. All six
Runs correctly degraded to read-only and failed the task. After an authorized
restart of `zte-2027`, a second six-Run comparison exposed a separate inherited
`.env` Docker host pointing at a nonexistent foreign-user socket. Its preflight
had not loaded that environment file. Those twelve original observations remain
unchanged, with failure bundles and separate environment audits. They contribute
**zero** comparable pairs. The global Docker context was restored to its prior
`colima-mma-rag` value; no ZTE project service was manually started or repaired.

`scripts/harness-environment-evidence.mjs` now validates the persisted Run
configuration against `run.started` and hash-validates negotiation receipts.
Missing/foreign/contradictory bindings fail qualification. Valid degradation is
retained as forensic evidence but cannot qualify a policy comparison. The gate
also requires equal Run budgets and preserves adverse scope/task outcomes when
environment evidence prevents attribution. Historical reports without environment
evidence require a separate reassessment, never an in-place rewrite. Failure
export additionally binds `debuggerAcceptance`, including unchanged legacy
compatibility only when no debugger requirement existed.

The final related script checks passed **33 tests**. The initial calibration-test
failure is retained; fixtures were updated to supply the new environment binding,
and missing-environment calibration is separately tested. The production PTY
probe now passes with the same `.env` loading and explicit local Docker socket
used by the fresh v3 campaign. That comparison completed **baseline 0/3 vs
candidate 3/3**, with all six environments eligible and only permitted paths
changed. All eighteen candidate debugger actions were admitted writes with OCI
results; same-frame observations, independent grades and process cleanup passed.
It remains one case, so the gate is `insufficient_evidence`.

A subsequent live-test repeat exposed an intermittent DAP sequence rejection;
the original failure is retained. Inspection of the pinned debugpy wheel shows
that `JsonMessageChannel._send_message` allocates sequence IDs under one lock and
sends under a second lock. Controlled thread scheduling in the real library
produced wire order **2, 1** without any duplicate. The original receiver rejected
that order. `DapProcessSession` now tracks at most 316 unique received IDs,
preserves wire order and still rejects duplicate IDs, unmatched requests,
command mismatches and repeated responses. There is no protocol sorting, replay,
or expanded message/output budget.

Regression tests first reproduced two failures against the old guard and then
passed after the fix. Real OCI and host-direct debugger checks plus protocol
tests passed **16/16**. One initial host-test invocation supplied an incorrect
interpreter path; its five setup failures remain logged and the corrected command
passed. The updated Runtime was frozen at
`/tmp/napier-harness-python-debugger-oci-v2`; fresh candidate v4 trials completed
**3/3**. The three original v3 baseline Runs are reused as a separately identified
comparison, not counted as new executions. A separate sequence-fix comparison
reuses the earlier successful OCI candidate v3 Runs as its before arm: **3/3 vs
3/3**, no new task failures or scope breaches. The final candidates each recovered
one tool error: unsupported Python debugger options, an invalid Plan artifact
transition, and a stale/unobserved frame ID. Their successful final outcomes do
not erase those failures; their reproduction bundles and original capsules remain.
Final full Runtime: **2569 passed, 58 skipped, two original failures**, 513 files,
294.31 seconds. Runtime TypeScript compilation passed; architecture still has
only the nine original violations. The final Docker check found no remaining
running containers from this work.
No default promotion or overall completion is claimed. Broad thirty-case/
three-trial qualification and remaining module gaps stay open.

Sanitized observations, separate comparison gates, original failure bundles,
upstream scheduling reproduction, image identities and hashed verification logs:
[`python-debugger-oci-2026-09-13.json`](artifacts/python-debugger-oci-2026-09-13.json).

## Python debugger toolchain integration (2026-09-13)

The opt-in `node-python-v1` policy now extends the admitted `node_debugger`
tool with explicit `runtime: "python"` on launch and control actions. The
provider preserves the original tool identity and execute/guard chain; it cannot
add a missing debugger or enable the Python branch without the policy scope.
The default Node schema and behavior remain unchanged. Both default and extended
descriptors stay within the existing three-KiB bound.

`PythonDebuggerManager` uses real debugpy DAP over the existing private Process
I/O, ownership and durable input receipts. It binds source content, interpreter,
debugpy package and `pyvenv.cfg`; stale source/runtime identities terminate the
session. Only observed frame/reference IDs are accepted, and resume clears them.
Pending startup has a cancellation owner before the first asynchronous operation,
so Run cancellation cannot miss a session still probing or launching. Protocol
requests/events/output and returned data are bounded. The session closes stdin
and uses managed cancellation on termination, timeout, abort and errors.

`AgentSessionRuntime` includes Python in both Run cleanup and the write barrier.
Python inspection/evaluation may execute user code, so every Python debugger
action is a write effect. Durable debugger tool evidence retains hashes and
status, without paths, expressions or values. Python results use their own
`napier.python-debugger` shape rather than Node inspector fields. Source maps,
breakpoint columns and exception-pause configuration are explicitly unsupported.

Real tests cover breakpoint/locals/evaluation/step/exit, foreign ownership,
private-output redaction, stale frames, source and virtual-environment drift,
startup cancellation, request timeout, aborted resume and the Agent write
barrier. The seven Python tests all passed with debugpy 1.8.17 / Python 3.9.6;
five are explicitly live-gated and two are always on.

A fresh DeepSeek V4 Flash Agent run from immutable snapshot
`/tmp/napier-harness-python-debugger-v1` completed the actual debugging-and-fix
chain: launch at original source line 5, stack/scopes/locals, paused expression
evaluation, cancel, code fix and report. Original hash-validated invocation
capsules prove the observations (`subtotal=50`, `expedited=True`, `base=0`,
evaluation `8`) before the source changed. All six debugger actions passed
admission and were recorded as write effects; no tool failed. The independent
grader passed, only `shipping.py` and `report.json` changed, and no managed
process remained running. Run: `run_7c82243c7dc4449d83cd`. This is one candidate
diagnostic, not a paired quality gate or evidence for default promotion.

Final verification: focused integration **18 passed**; Runtime, CLI, Server and
Harness-eval TypeScript compilation passed. Full Runtime: **2563 passed,
57 skipped, two original failures**, 511 files, 290.30 seconds. The existing
capability-vector and production Skill-readiness failures remain. Architecture
retains nine original violations; public API retains the original 1897/1896
count and compatibility digest mismatch. The full build entry is still blocked
by the existing release product source manifest mismatch. Initial new complexity
and decorator-audit failures were fixed and retained in the artifact; no budget
or release receipt was raised/refreshed to suppress a failure.

Evidence: [`python-debugger-2026-09-13.json`](artifacts/python-debugger-2026-09-13.json).
That snapshot supports only explicit host-direct, with **no OS isolation**.
The subsequent OCI section above records provider-bound transport and reusable
benchmark packaging. Complete dependency attribution and the thirty-case
qualification requirement remain open. The overall seven-module goal remains
unfinished and no default policy was promoted.

## Capability claims and requested output paths (2026-09-13)

`capability-availability-guard.ts` now binds availability predicates to explicit
capability subjects/modifiers and coordinated tool lists. Nearby statements about
another subject (for example, disabled bytecode) no longer deny process access.
Negated availability adjectives and records of absent activity are distinguished
from capability denials. English passive predicates and Chinese coordinated
denials remain covered; actual `tool.blocked` and permanent-unavailability
receipts retain their existing handling. These checks guide recovery and do not
grant tool permissions or replace dispatch admission.

The four original rejected responses from the two tail-delivery failures were
checked against immutable before/after code. All four were false positives before
and none were flagged after. Hashes and Run/event IDs are retained. Deterministic
Runtime checks also verify that genuine unavailable-tool claims still trigger
recovery, while a non-denial answer is published after one primary invocation
without tool calls or a spurious redirect.

The first fresh two-case campaign exposed a separate output-path failure:
interactive candidate trials 1 and 3 created the requested report inside their
Thread output directories. Their original invocation capsules contain both the
unconditional generated-report directory guidance and Plan paths choosing those
directories. This shows conflicting guidance; stochastic paired results alone
do not attribute the scope violation to the capability parser.

`workspace-thread-outputs.ts` now uses the generated directory only when no user
destination is supplied. User-specified relative paths, including a filename
alone, resolve from the workspace root unless the user established a different
destination. Plan paths, writes and links must preserve that destination. Existing
cross-Thread output protection remains unchanged. This is a general destination
precedence rule; no benchmark-specific path allowlist was added.

| Comparison                                           | Baseline | Candidate | Quality result                                             |
| ---------------------------------------------------- | -------- | --------- | ---------------------------------------------------------- |
| Initial predicate binding, interactive Python        | 3/3      | 1/3       | regressed: two path-scope violations and false completions |
| Initial predicate binding, pricing API migration     | 3/3      | 3/3       | no observed regression in this case                        |
| Revised grammar + destination precedence, both cases | 6/6      | 6/6       | insufficient_evidence: two cases, three paired trials each |

Both arms use the same `coding-python.v1` composition with `tail-v1` delivery
and `request-aware-v1` finalization. Baseline snapshot is
`/tmp/napier-harness-finalization-plan-v2`; candidates are
`/tmp/napier-harness-capability-claim-v1` and `v2`. The six baseline Runs are
reused in two separate comparisons, not counted as twelve executions. Candidate
v2 changed only the permitted paths; all independent graders/process checks
passed. Its interactive Plan states matched in 67/67 eligible primary request
capsules. All six runtime-context delivery audits passed. Concurrent runs do not
qualify latency/cost effects. The original scope failures remain exported under
`/tmp/napier-seven-quality/failures/capability-claim-interactive-candidate-v1-*`.

Evidence and separate quality gates:
[`capability-claim-2026-09-13.json`](artifacts/capability-claim-2026-09-13.json).
No default strategy promotion; the thirty-case requirement remains unmet.

Validation: initial complete Runtime pass **2561 passed, 52 skipped, 2 original
failures**, 510 files, 298.49 seconds (`/tmp/napier-capability-claim-full-v1.log`).
Final grammar/path checks: 15 passed; Contracts/Runtime/CLI/Server/Harness-eval
build passed; architecture retains nine original violations without increasing
budgets. Final complete Runtime pass after grammar/path changes: **2561 passed,
52 skipped, 2 original failures**, 510 files, 295.50 seconds
(`/tmp/napier-capability-claim-full-v2.log`). The two failures remain the original
capability-vector and production Skill-readiness expectations; this is not a
fully green suite. `git diff --check` passed.

Python debugger preparation also exercised real debugpy 1.8.17 on Python 3.9.6
in `/tmp/napier-debugpy-probe-v1`: DAP initialize/launch, a verified source
breakpoint, stack/scopes/variables and paused-frame evaluation succeeded.
Disconnect alone left the adapter waiting; closing its stdin after disconnect
produced exit code 0. The initial failure and successful probe are retained in
the evidence artifact. This is host-direct feasibility only, not a Napier tool
implementation, sandbox guarantee or production lifecycle acceptance.

Next: integrate Python debugger ownership, runtime identity, admission,
timeouts/cancellation and cleanup into the toolchain; expand representative
whole-policy qualification and production failure-state capture. The remaining
seven-module gaps in the status table are still active.

## Request-aware finalization and plan state (2026-09-13)

`task-plan-snapshot.ts` binds actual Plan results to their thread, plan ID,
revision, steps, artifact paths/statuses and latest replacement reason/IDs.
`task-plan-revisions.ts` derives the latest observed state from completed core
Plan tool events. Older observations cannot roll it back; conflicting states
at the same revision suppress the actionable snapshot. Counts and truncation
remain explicit. `plan-tool-result.ts` extracts the existing result renderer
without changing its model-facing body and adds the snapshot to event details.
The plan-tools source line override was lowered from 963 to 907 after extraction.

The working-state prompt now carries current Plan state instead of repeated
chronological Plan actions, including IDs consumed by superseded artifacts.
It remains context, not authorization or a task acceptance decision. Actual
Plan mutation tests validate the returned snapshot hash/revision against Store.

Explicit `context.finalization: "request-aware-v1"` uses the maximum raw request
size among the last three primary calls as a conservative uncached estimate.
It reserves at least three such calls within the existing token limit. Legacy
presets remain unchanged. Active finalization now delivers queued steering and
follow-up, preserving instruction lineage; runtime hints are not user revisions.

The initial implementation exposed a discrete request-boundary defect: waiting
for remaining tokens to fall below the reserve can enter one full call too late.
Original candidate Run `run_36d66de4938a4d67b8c5` entered at 203,243 budget tokens
with a 58,302-token reserve but only 46,757 remaining. A plan update, milestone
and final answer consumed three more calls and exhausted the original 250,000
limit. The final implementation checks before the next ordinary request could
spend into that reserve. A regression test demonstrates that 67,000 remaining
with a 20,000-token forecast enters while the 60,000 finishing allowance still
fits. This forecast does not guarantee unknown future request sizes.

All comparisons use the original interactive Python fixture, DeepSeek V4 Flash,
48 turns / 250,000 tokens / $3 / 240 seconds and host-direct execution. Immutable
snapshots: `process-lifecycle-v2`, `finalization-plan-v1`, `finalization-plan-v2`
under `/tmp/napier-harness-*`. Three baseline trials are reused for three
separately identified candidate comparisons; they are not nine baseline Runs.

| Candidate                                          | Baseline | Candidate | Gate / actual evidence                                                                                             |
| -------------------------------------------------- | -------- | --------- | ------------------------------------------------------------------------------------------------------------------ |
| Initial forecast + plan state, system delivery     | 2/3      | 2/3       | regressed: candidate trial 1 failed where baseline passed; 75/75 eligible primary request Plan projections matched |
| Initial forecast + plan state, tail delivery       | 2/3      | 1/3       | regressed: candidate trial 3 failed where baseline passed; 69/69 Plan projections matched                          |
| Request-boundary fix + plan state, system delivery | 2/3      | 3/3       | insufficient_evidence: one case; 61/61 Plan projections matched                                                    |

All nine candidate Runs passed independent code/report and process-lifecycle
checks and preserved allowed paths. Task success additionally requires a
completed Run, so those checks do not turn failed Runs into successes. The tail
failures were final-response capability-guard false positives, reproduced from
the original response: "bytecode disabled" was attributed to `workspace_process`,
and "no network calls" to unavailable network tools. These indicate a remaining
predicate/subject binding defect, not evidence that tail delivery lost Plan
state. Fixing and qualifying that guard remains next work. Original failures
are exported under `/tmp/napier-seven-quality/failures/finalization-plan-*`.

Before this comparison, a single process-v2 tail diagnostic completed at 101,836
budget tokens with 23/23 runtime delivery capsule audits. It remains a diagnostic,
not a replacement for the original failed paired trial or a qualified cost gain.

Sanitized reports, source/profile/budget identities, original response diagnostic
excerpts, Plan capsule audits and separate gates:
[`finalization-plan-2026-09-13.json`](artifacts/finalization-plan-2026-09-13.json).
Concurrent runs and small samples do not qualify latency/cost improvements.
No default promotion. The seven-module goal remains unfinished.

Validation: initial complete Runtime pass **2558 passed, 52 skipped, 2 original
failures**, 509 files, 293.11 seconds (`/tmp/napier-finalization-plan-full-v1.log`).
The subsequent request-boundary fix passed 14 focused budget/Plan checks and
Contracts/Runtime/CLI/Server/Harness-eval build. Architecture retains the original
nine violations; no budget was raised. Final complete Runtime rerun after the
request-boundary fix: **2559 passed, 52 skipped, 2 original failures**, 509 files,
284.90 seconds (`/tmp/napier-finalization-plan-full-v2.log`). The original
capability-vector and production Skill-readiness expectations are still failing;
the suite is not described as fully green. `git diff --check` passed.

The subsequent capability-claim repair and its separate fresh-task comparisons
are recorded above. The original tail failures remain unchanged. Python debugger
and the other module qualification gaps remain in scope.

## Earlier implementation details

`workspace-edit-snapshots.ts` stores bounded, run-local references to exact full
hashes. Inline `L<number>|text` labels are metadata, not source bytes. Truncated
reads never acquire edit references. Unified diff additionally requires a
complete read whose text hashes to the snapshot's full-file digest. It validates
single-file headers, hunk positions/counts, exact context and final-newline
markers, then produces an ordinary content EditIntent. It does not fuzzily
relocate hunks or implicitly create/move/delete files. The original atomic
patch tool remains the only commit path. References expire on recovery.

`edit-format-preference.ts` binds recommendations to an exact provider/model/API
and unambiguous task phase. Every invocation rechecks that scope, including
fallback models and changed tasks. A mismatch restores the existing family
guidance while retaining all admitted edit operations. The preference is part
of the versioned policy and therefore survives recovery without consulting a
new catalog. It never converts an exact replacement into fabricated anchors.

`edit-format-calibration.ts` validates a bounded, hash-bound catalog and selects
the original tested profile only when the current compiled runtime, serving
model/API and task phase match. Entries require at least 30 cases and three
paired trials, no quality blockers/regressions, and actual completed use of the
candidate format in every pair. Missing, stale, ambiguous or insufficient
entries return no override. This is explicit configuration/campaign selection;
workspace files cannot silently activate a new policy. No existing preset
composition or implicit default changes.

`scripts/edit-format-calibration-evidence.mjs` derives entries from original
campaign reports, retaining their set hash, gate hash and exact tested profile.
It checks serving APIs/task phases, reused Runs, duplicate task input sets and
actual operations obtained from validated invocation capsules. The builder CLI
accepts repeated `--report` arguments and writes a new catalog with `--output`.
Campaigns accept `--edit-dialect structured_patch|hashline|unified_diff` with an
explicit policy and `--calibration-catalog <file>` for gated selection. Selection
receipts are recorded in campaign reports; the runtime's ordinary policy binding
records any selected profile before model execution.

The first same-source format comparison covered shipping and multi-file pricing
migration with three trials per format. All 18 Runs completed and respected the
allowed files. Shipping actually exercised exact replacement in 3/3, hashline in
2/3, and unified diff in 0/3; guidance presence alone was not counted as usage.
Pricing exposed the classifier treating the programming term "call site" as a
browser task, so its scoped preference was not active. The classifier now
normalizes that complete term while retaining separate browser instructions.
The historical catalog retains both the small-sample and task-scope blockers.
Three additional real Runs supplied the insufficient shipping catalog and
completed with `profile: null`, proving that rejection retains normal execution.
These observations do not qualify a format or establish a cost improvement.

The corrected `calibration-v2` snapshot reran both tasks for all three formats:
18/18 task completions with the permitted changed files. All three multi-file
diff Runs completed three actual `unified_diff` edits each. Across both tasks,
diff was actually exercised in 4/6 candidate Runs and hashline in 3/6. Exact,
diff and hashline total costs were $0.0219826, $0.0204744 and $0.0211173;
tool failures were 8, 7 and 9. Differences in this small concurrent pilot do
not qualify cost or latency. The catalog remains insufficient with two cases
and incomplete candidate-format adoption. Current candidate catalog:
[`edit-format-calibration-v2-2026-09-13.json`](artifacts/edit-format-calibration-v2-2026-09-13.json).
The earlier catalog and original runs remain preserved separately.

`toolchain-provider.ts` decorates only already-admitted `run_command`,
`verify_workspace` and `workspace_process`. Python retains `.venv` invocation identity rather than
resolving its executable symlink to base Python. Verification uses isolated
Python to avoid workspace `unittest.py` shadowing. Zero tests, unavailable
verifiers, truncated observations and changed workspace snapshots cannot yield
a passing verification receipt. `syntax` is explicitly distinct from tests and
typechecking. Python inline `code` uses the same bounded command/sandbox path.

`affected-test-selection.ts` and `affected-test-verification.ts` add optional
`affectedBy` to admitted test verification. Node reuses the workspace import
graph and retains cross-package dependents. Python parses source ASTs under
`-I -S -B` without importing project code. Selection is bounded to 512 source
files, 2 MiB, 4,096 edges and eight selected test files. Dynamic imports,
search-path mutation, shared pytest configuration, ambiguous imports, limits,
configuration changes or no matches retain full-suite verification. Selection
and execution share whole-workspace snapshot bindings and one timeout budget.
Zero tests, incomplete observations and workspace drift cannot yield a pass.
Static selection does not establish complete behavioral coverage.

Verification receipts retain hash-only selection and result-set identities.
Whole-workspace receipts explicitly declare `workspaceSnapshotScope`; this
prevents nested test roots being treated as unknown and ensures directory
entries use the same snapshot convention as working-state freshness checks.
The compact working-state projection retains selection mode and selected-test
count, so conversational compaction cannot turn a subset receipt into apparent
full-suite coverage.

`agent-invocation-context.ts` prepares working state and memory together before
prompt compilation. These projections do not append synthetic user messages,
replay tools or replace permission/completion authority. Working state follows
only same-thread parent Runs, rejects missing/cyclic/overlong ancestry and
revalidates current filesystem versions. Plan updates cannot expand the user's
scope. The model-facing projection omits repeated internal hashes while keeping
one complete-projection binding and actionable evidence.

`task-requirement-revisions.ts` validates queued/delivered control-message
lineage and distinguishes user instructions, workflow inputs and runtime
continuations. Only actual user instructions increment the revision. Bounded
context retains the original constraints and prioritizes recent user amendments
over continuation hints. A check preceding the latest instruction is marked for
reassessment without declaring source evidence stale. A real runtime integration
test delivers steering, forces provider overflow, compacts context and verifies
both user instructions remain visible without replaying the three reads.

Memory review status, expiration and referenced source hashes are checked for
every invocation. An edit during the Run therefore invalidates a previously
loaded source-dependent fact. `task-memory-index.ts` maintains a derived FTS5
database under the data root, separately keyed by workspace and Agent. Reopening
an unchanged index reuses its rows. Reconciliation removes revoked/stale facts
and searches in one transaction. Restricted read-only execution uses an in-memory
index. Unavailable/corrupt derived storage falls back to in-memory retrieval and
records a hash-only diagnostic; it does not fall back to stale cached facts.
The index is not an authority for factual truth or permission.

`stable_prefix_layers_v1` renders invariant/profile/adapter instructions before
current capabilities and workspace context. Historical layer metadata and the
legacy assembly remain supported and hash-bound. `prompt-cache-projection.ts`
records adjacent exact UTF-8 prefix bytes, ordered schema identity and serving
identity. It never infers provider cache hits from prefix similarity. Actual
cache tokens and costs come from provider usage receipts. A changed schema or
serving identity invalidates the comparable-prefix measurement.

`context.delivery: "tail-v1"` is a separate opt-in strategy requiring `stable-v1`.
`runtime-context-delivery.ts` first compiles the original source selection and
budget, then moves only included memory, working-state, delegation and milestone
data into one trailing request-local message. Permission/capability rules,
import boundaries, checkpoints and tool-loop guards remain in the system prompt.
Fixed system guidance identifies the trailing JSON as reference data, not a
user instruction or grant. Sources retain their original normalized content.
The protocol plus static workspace text and serialized tail must fit the same
workspace-layer budget; otherwise the original full-system compilation is used.
Omitted sources are never restored to exploit a second budget.

The tail is regenerated per invocation, never added to durable user history.
Compaction reserves its tokens but receives only durable/pruned source history;
summaries and checkpoints therefore cannot retain old memory snapshots. Owned
message object identities distinguish runtime data from user-authored lookalikes.
Overflow/thinking-loop retries remove owned tails before fresh context preparation.
The final token governor measures the actual request and protects the original
user requirements. It cannot silently displace them with the synthetic tail.

`context.runtime_context.delivered` records hash-only source metadata, tail and
base-message identities, and token-pressure/system bindings. `context.projected`
binds that receipt separately from compaction. Validation checks event ordering,
compaction's pre-tail base and recovery's stripped previous base. Private capsule
audit reconstructs actual content and base hashes. Imported Runs rebind the new
receipts along with checkpoint lineage. Prompt-source component counts still
describe the compiled system; relocated sources are described in the delivery
receipt. No data is promoted into permission or completion authority.

Prefix diagnostics additionally retain canonical message hashes/byte counts,
never previous raw message bodies. Complete-message prefix comparison requires
the same serving identity, ordered tools and exact system text. These are local
diagnostics; provider cache tokens and cost remain separate usage evidence.
Campaigns accept `--context-delivery system|tail-v1` with an explicit stable
policy, leaving existing preset compositions unchanged.

The immutable `/tmp/napier-harness-runtime-tail-v1` pilot compared both delivery
positions with otherwise identical `coding-node.v1` policies, current-source
memory shipping and multi-file pricing migration, three trials per task/arm.
Both arms passed 6/6 with permitted changes; tool failures were 3 in each arm.
The candidate's 41 delivery receipts passed private-capsule audit. Exact system
and ordered-tool identity held in all 35 candidate adjacent observations versus
28/55 baseline observations; both measurements exclude the first invocation of
each purpose. Total observed cost was $0.0282299 versus $0.0659343, with 57 versus
83 tool calls. Concurrent execution and differing model trajectories prevent
attributing the cost difference solely to caching. The default gate still
requires 30 cases and three paired trials: **insufficient evidence**, no observed
regressions, no default promotion. See
[`runtime-context-delivery-2026-09-13.json`](artifacts/runtime-context-delivery-2026-09-13.json)
for original report hashes, per-trial metrics and full policy bindings.

`harness.policy.bound` persists the canonical profile before `onRunCreated` and
before model execution. Recovery restores that composition, independently of
permission negotiation; edit references are never inherited. Current strategy
IDs include `stable-v1`, `task-aware-v1`, `evidence-v1`, `node-python-v1` and the
optional `toolSurface.unifiedDiff` (which requires edit references).

## Managed process lifecycle and qualification (2026-09-13)

`toolchain-process-provider.ts` extends the admitted Process schema under
`node-python-v1`. It executes the original tool inside a request-local environment
scope, preserving existing input/control guards and tool identity. Python starts
and write previews select the cwd `.venv`; private kernel/protocol launches without
this selector retain their pinned runtime. Interpreter identity is rechecked
immediately before launch. Later input, polling, cancellation and write settlement
continue through the same owned Process or one-use preview ID. Host-direct remains
explicitly without OS isolation; this change supplies no new isolation evidence.

The initial real interactive task exposed Process observations being permanently
neutral to execution activity. `toolchain-process-progress.ts` now classifies only
observed nonempty output as supporting evidence in the opt-in provider. Its content
binding omits cursor/session metadata and merges adjacent same-stream chunks, so
cursor changes, chunk splitting and A-B-A rereads do not create repeated credit.
Input/start/cancel calls do not create supporting credit. Existing activity leases
retain their absolute semantic-stall and elapsed-time bounds. Output cannot count
as product/acceptance progress or double-count a scoped write's settlement.

The campaign runner now initializes the managed process service when admitted tools
need it, records process state before cleanup and closes the manager/store in
`finally`. Acceptance binds required actions to one Process, validates actual JSON
input/replies from private hash-validated invocation capsules, checks no sessions
remain running, and separately runs the external code/report grader. Cleanup cannot
be credited as Agent completion. Reports bind acceptance rules and task budgets;
failure export rejects changed scopes, process requirements or turn budgets.

The original 24-turn pilot is retained: baseline **1/3**, candidate **0/3** task
completions, with no-progress and turn-budget failures. The revised experiment gave
both arms 48 turns, retaining the same 250,000-token, $3 and 240-second limits,
prompt, grader and allowed paths. With the same `coding-python.v1` composition,
the previous tail snapshot completed **1/3** and the new process-v2 snapshot
completed **2/3**. All three new candidates used Python for the interactive worker,
completed the two input/reply exchanges and cancellation, and passed independent
code/report checks. The third Run nevertheless failed at **254,528 / 250,000
tokens** during finalization and remains an end-to-end failure.

Both original and revised paired gates are **regressed**, because each contains
a baseline-success/candidate-failure pair; the sample is also only one case.
The revised candidate's higher aggregate success cannot override that result.
Total v2 cost was $0.0689427 baseline and $0.1080310 candidate; aborted Runs and
different trajectories prevent a causal efficiency claim. No default promotion.
Original report hashes, actual process evidence, budgets, costs and both gates are
in [toolchain-process-lifecycle-2026-09-13.json](artifacts/toolchain-process-lifecycle-2026-09-13.json).

The failed v2 candidate was exported from its original fixture to
`/tmp/napier-seven-quality/failures/process-lifecycle-candidate-v2-trial3`, preserving
the prompt, grader, acceptance and 48-turn budget. One fresh real-model replay on
the same v2 snapshot completed and passed process/outcome checks. The token-budget
failure did not recur in that diagnostic replay; it remains in the original paired
gate. The extra replay is not counted as a replacement or additional paired trial.

- Build: Runtime/Contracts/CLI/Server/Harness-eval passed,
  `/tmp/napier-process-progress-build-final.log`.
- Lifecycle/Node/debugger regression selection: **84 passed**, including live
  `.venv`, interactive I/O, ownership, preview drift, timeout, cancellation and
  shutdown checks. Progress/admission/recovery selection: **34 passed**. These
  selections overlap and are not added together.
- Campaign evidence/grader helpers: **23 passed**,
  `/tmp/napier-process-evidence-final-tests.log`.
- First full pass: **2545 passed, 52 skipped, 3 failed**. Besides the original
  two failures, the structural admission audit required registering the new
  identity-preserving decorator. Its original-guard behavior is independently
  tested; the narrowly scoped decorator entry was added to the existing audit.
- Final full pass: **2549 passed, 52 skipped, 2 failed**, 506 files, 312.01 seconds,
  `/tmp/napier-process-lifecycle-full-final.log`. Only the original capability
  vector and production Skill-readiness failures remain. Live-only lifecycle
  cases are included in the targeted run rather than counted among full-suite
  passes when their environment gate is absent.
- Architecture retains the original 9 violations; Public API retains the
  1897-vs-1896 export/digest failures. No architecture or description budget rose.

Next: diagnose budget-aware finalization/plan overhead using the preserved failed
Run before claiming non-regression, then complete Python debugger and broader
provider/whole-policy qualification. The other six module qualification gaps in
the status table remain open.

## Dynamic context verification (2026-09-13)

- Runtime/Contracts/CLI/Server/Harness-eval TypeScript build passed:
  `/tmp/napier-runtime-tail-build.log`.
- Targeted context, compaction, retry, revoked-memory, capsule, import and
  policy checks: 41 passed (`/tmp/napier-runtime-tail-targeted.log`).
- Campaign evidence helpers: 16 passed; Harness-eval: 10 passed. A preliminary
  `node --test` command used the wrong runner for Vitest tests and failed before
  executing them; the reported helper results use the corrected Vitest command.
- The first full Runtime pass had 2544 passed, 49 skipped and 3 failed in 504
  files (`/tmp/napier-runtime-tail-full.log`). Two were the original capability
  vector/production Skill readiness failures. The additional workflow experiment
  was blocked before creating the report Run (`run_start_failed`, diagnostic
  `de28bcbe995d3662d9a97fcbd3c6c5ec1b45aac315a81fe0a00cb4b979cfca53`).
  A focused rerun passed. Isolated instrumented repetitions against the previous
  calibration snapshot and the current tail snapshot passed 20/20 each, without
  modifying either original snapshot. This does not explain the original
  failure; its evidence remains recorded. The sequential full rerun completed
  with **2545 passed, 49 skipped, 2 failed**, 504 files, 289.21 seconds
  (`/tmp/napier-runtime-tail-full-recheck.log`); only the original two failures
  remained. The workflow issue was not reproduced or relabeled as explained.
- Architecture retains the original 9 violations; Public API retains the
  original 1897-vs-1896 export and digest mismatch. No budget was increased.

## Explicit strategy activation

`coding-node.v1`, `coding-python.v1` and `research.v1` expand to immutable,
versioned experimental compositions. CLI supports `--harness-policy <id>`;
HTTP accepts only these IDs in `harnessPolicyPreset`. Arbitrary request profiles
and unknown versions are rejected. `maxActiveToolsMode: model_default` preserves
the bound profile across fallback/recovery while respecting the serving model's
resolved tool limit. Fixed experimental limits retain strict validation.

The Composer offers “执行策略（实验）” inside Run options. Selection belongs to
the current thread, is consumed only after `run.started`, and survives a rejected
submission. Late responses cannot clear a newer selection. The Web stream checks
the binding/profile/policy hashes and requested preset identity before accepting
the Run. Presets do not grant tools or update the persistent Agent configuration.

Real CLI and browser submissions of the mixed Python/Node case both completed
with `coding-python.v1`, changed only `shipping.py`, and passed the independent
Python boundary/validation and Node regression grader. CLI had no tool failures;
Web corrected one command-argument failure. A subsequent read-only browser Run
used only `read_file`, completed, and had no experimental policy binding.
The 390×844 viewport exposed a floating follow button over the options; the open
Composer now sits above feed controls. Screenshot inspection and a real DOM hit
test confirmed that the strategy selector is visible and clickable.
These host-direct entry-point checks precede the persistent-index addition and
do not establish general policy quality. Sanitized evidence:
[`harness-product-acceptance-2026-09-13.json`](artifacts/harness-product-acceptance-2026-09-13.json).

The persistent index matched the prior disposable implementation byte-for-byte
on 30 queries over 1,000 reviewed facts, including Chinese and general constraints.
Warm local mean retrieval was 7.80 ms vs 5.62 ms while other validation ran; this
is a CPU observation, not a model cost claim. Its fresh real-model pilot was
baseline 3/3 vs candidate 2/3: one candidate passed the behavioral grader but
created an unauthorized `outputs/<thread>/verify-shipping.mjs` helper despite
the user's explicit single-file boundary. The quality gate is `regressed`,
not promotion-ready. Preserved inputs/report are under
`/tmp/napier-seven-quality/failures/persistent-memory-v1-trial2`.
This stochastic outcome alone does not attribute the violation to index
persistence. Output-directory and Plan guidance now explicitly preserve the
user's deliverable/path boundary; inline Node checks are documented. A fresh
same-policy pilot subsequently completed 3/3 in each arm with only the permitted
source file changed. This small sample does not eliminate the earlier quality
defect or justify default promotion.

## Structural defects exposed by real execution

- macOS sandbox probes needed exact root directory metadata/data access.
  Python needed `/dev/urandom`; shell PTY launch needed the exact
  `/private/var/select/sh` selector. The production shell probe now reports
  ready. No broad filesystem/network allowance was added.
- The capability-denial guard misread “host-direct (no OS isolation);
  run_command …” as a denial of the command tool. Clause/grammatical matching
  now preserves actual English/Chinese capability denials without that false
  positive.
- Restoring shell availability increased tool pressure and excluded
  `update_plan_artifact` after a Plan step reopened. Successful Plan operations
  now retain the admitted Plan lifecycle tools within the existing limit;
  unavailable tools are never added.

## Real-model pilots

All comparisons below use DeepSeek `deepseek-v4-flash`. Unless explicitly marked
OS sandbox, they are **host-direct**. Each row is a small pilot, not release
qualification. Concurrent campaigns make latency exploratory. Sanitized run,
source, input, profile, outcome and usage records are retained in
[`harness-optimization-pilots-2026-09-13.json`](artifacts/harness-optimization-pilots-2026-09-13.json).

| Candidate / task                                 | Baseline success      | Candidate success      | Finding                                                                                                            |
| ------------------------------------------------ | --------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Inline references / shipping                     | 3/3                   | 3/3                    | Tool failures 3 vs 0                                                                                               |
| Inline references / pricing migration            | 3/3                   | 3/3                    | Tool failures 3 vs 2; variable latency                                                                             |
| Toolchains v1 / Python + Node                    | 3/3                   | 2/3                    | Capability guard false positive; rejected by quality gate                                                          |
| Toolchains v2 / Python + Node                    | 3/3                   | 2/3                    | Extra verification helper violated allowed changed paths                                                           |
| Toolchains v3 / Python + Node                    | 3/3                   | 3/3                    | No candidate tool failures; candidate latency higher                                                               |
| Toolchains v3 / full Agent OS sandbox            | No paired baseline    | 1/2                    | One correct patch/grader run exhausted 24 turns; one completed                                                     |
| Stable prompt / pricing migration                | 3/3                   | 3/3                    | Total cost $0.022438 vs $0.028612: no demonstrated cost improvement                                                |
| Task-aware memory / shipping                     | 3/3                   | 3/3                    | Total cost $0.014900 vs $0.010821; older relevant/current-source fact prioritized                                  |
| Working state v1 / pricing migration             | 3/3                   | 2/3                    | Extra helper and token exhaustion; gate `regressed`                                                                |
| Compact working state v2 / pricing migration     | 3/3                   | 3/3                    | Total cost $0.026590 vs $0.042401; no cost qualification                                                           |
| Unified diff available / pricing migration       | 3/3                   | 3/3                    | One malformed diff rejected; all successful edits used exact replacement                                           |
| Explicit declared-format exercise / shipping     | 2/3                   | 3/3                    | Candidate actually completed three unified-diff edits, confirmed in invocation capsules                            |
| Scope guidance / single-file shipping            | 3/3                   | 3/3                    | Same memory policy; tool failures 3 vs 1; cost $0.020859 vs $0.006717                                              |
| Affected Python interface / mixed project        | 3/3                   | 3/3                    | All three candidates actually used affectedBy and completed selected tests; cost $0.034121 vs $0.021802            |
| Affected Python v2 / full coding-python preset   | 3/3                   | 3/3                    | Same composition both arms; selected coverage remains current in actual model context; cost $0.045154 vs $0.044294 |
| Scoped edit preference v2 / shipping + migration | 6/6 exact             | 6/6 diff; 6/6 hashline | Actual candidate format in 4/6 diff and 3/6 hashline Runs; no promotion                                            |
| Explicitly requested report / scope guidance     | 2/3 raw; 3/3 regraded | 2/3 raw; 3/3 regraded  | Original grader matched headings; exact numeric-field reassessment accepts all six unchanged reports               |

The declared-format exercise uses the same conditional prompt for both arms:
use unified diff if the tool declares it, otherwise use the existing exact
replacement format. Its baseline failed one behavioral grader despite reporting
completion. This is interface evidence, not a general coding benchmark win.

Working-state v1 failed Run `run_8eadbcd7e2e64e0e8ea3` passed the code grader but
created an extra helper and exhausted the token budget. Its original-input
bundle is `/tmp/napier-seven-quality/failures/working-state-v1-trial3`.
The earlier toolchain v1 failure is preserved under
`/tmp/napier-seven-quality/failures/candidate-python-trial2`; one fresh replay
passed, demonstrating reconstruction without guaranteeing failure recurrence.

The original requested-report failures and grader remain preserved under
`failures/requested-report-{baseline,candidate}-v1-trial2`. The revised grader
ignores headings and explanatory prose, compares whole numeric tokens and
rejects incorrect precision or contradictory summary values. A separate hashed
reassessment links the original reports, unchanged artifacts and revised grader;
historical results and their gate are not rewritten. These are six regraded
outputs, not six fresh model executions.

The first affected-test pilot used the immutable `affected-v1` source snapshot.
Its invocation capsules prove actual `affectedBy=["shipping.py"]` calls and
passing selected-test receipts in all three candidate Runs. It predates the
whole-workspace freshness corrections, dynamic-import hardening and requirement
revision implementation, so it cannot qualify those later changes.

The fresh `affected-python-v2` comparison uses identical `coding-python.v1`
profiles in both arms: `before-affected-v1` vs `affected-v2` source snapshots.
Both completed 3/3 and changed only `shipping.py`. All candidates used the
declared `affectedBy` interface and passed the selected test. Hash-validated
subsequent model-invocation capsules retain `freshness: current`,
`selectionMode: selected` and `selectedTestCount: 1`. Both arms had one tool
failure. Total cost was $0.0451536 vs $0.0442943; the small difference does not
establish a cost benefit. This is one-case integration evidence and remains
`insufficient_evidence`, with no default promotion.

The quality gate still requires 30 cases and 3 paired trials by default.
Non-regressing pilots above remain `insufficient_evidence` with
`promotionReady: false`; regressing v1 results are retained, not overwritten.
Snapshot `context-v1` contains the first context implementation; `context-v2`
contains compact working state and unified diff. Raw invocations remain local
under `/tmp/napier-seven-quality`; they are not included in the sanitized index.

## Earlier verification and next steps

- Original Runtime baseline: 2471 passed, 32 skipped, 2 failed.
- Calibration-stage complete Runtime suite, using the repository's `--maxWorkers=2
--testTimeout=30000`: **2538 passed, 49 skipped, 2 failed**, 503 files,
  312.83 seconds. The two failures remain the baseline capability-vector hash
  and production Skill-readiness expectations. The initial unconfigured root
  invocation was cancelled and is not acceptance evidence.
- Runtime/contracts, CLI and Server TypeScript builds passed. Targeted tests cover atomic edits,
  stale/partial snapshots, recovery, compaction without replay, fresh memory,
  prompt binding and format evidence. Campaign helper tests now use the root
  repository's Vitest runner.
- Calibration-stage full-suite log: `/tmp/napier-calibration-runtime-final.log`.
  Build log: `/tmp/napier-calibration-phase-build.log`.
  Architecture log: `/tmp/napier-calibration-architecture-final.log`.
- Affected-test/requirement/recovery/compaction and grader selection:
  **50 tests passed**, including live OS sandbox execution. Separate campaign
  evidence/grader checks: **13 passed**. These deterministic tests do not
  replace real-model task qualification.
- Edit calibration/policy/recovery integration: **20 passed**; calibration
  evidence helpers: **7 passed**; task-phase correction plus model-profile and
  edit-policy integration: **45 passed** (overlapping targeted selections).
  Harness-eval package: **10 passed**. Runtime/contracts/CLI/Server/harness-eval
  compilation passed. Public API audit still reports the original export-count
  and compatibility digest failures, with no new violation category.
- Web production build and all **1144 tests** passed. CLI: **198 passed,
  5 skipped, 1 failed** (Browser setup readiness). Server: **318 passed,
  1 failed** (recommended model expectation). Both entry-point failures were
  reproduced against the original `c454a155` snapshot. Initial full CLI/Server
  commands repeated existing timeout flags and were rejected before tests;
  the reported counts come from corrected package-configured invocations.
- Web design check passed. Management OpenAPI artifact freshness fails on both
  the original snapshot and current checkout. No baseline was regenerated to
  hide that failure. `git diff --check` passed.
- Latest architecture audit has only 9 pre-existing violations; newly exposed
  working-state complexity and context dependency/coupling violations were
  resolved without raising their limits. Public API audit retains its baseline
  1897-vs-1896 compatibility export/digest mismatch.
- Continue broader edit-format calibration/adoption qualification, provider lifecycle/debugger integration,
  dynamic-context long-task/cache qualification, richer decision revisions, production failure
  capture, and broader quality qualification. The single-file task's earlier
  unauthorized helper has not recurred in the three-trial scope pilot, but
  remains an unqualified risk. No commit,
  push or deployment has occurred.

## Bounded rejected-thinking diagnostics (2026-09-15)

The combined `thinking-trace-v1` snapshot binds 5648 files, including the verified multiline argv repair. `model-thinking-trace.ts` hashes every nonempty reasoning delta and retains a UTF-8-safe 128 KiB prefix, including deltas after the existing 32 KiB commit buffer flush. `model-thinking-trace-store.ts` persists a private capsule bound to thread, Run, turn and actual input envelope; ledger/replay contain only the receipt. The existing private store enforces 0600/0700 permissions and 512-object/64 MiB limits. Storage failure does not replace the guard outcome. Terminal-only reasoning without deltas is explicitly unavailable. This trace is not a provider usage receipt.

32 targeted checks pass, including pinned SDK/local HTTP cancellation, spending denial, post-flush capture, Unicode bounds, source bindings and no raw text in public events/replay. Runtime compile passes. Architecture has the same six pre-existing violations, no new ones; limits were not raised. Watchdog, retries, prompts, output commit and accounting policies are unchanged.

One original candidate-first JSON Patch pair is dispatched to observe actual reasoning that prior cancelled Runs did not preserve; stop on candidate/evidence failure, no later batch queued. The full 30-case/3-trial gate is retained. See [offline evidence](artifacts/thinking-trace-offline-validation-2026-09-15.json) and [immutable plan](artifacts/thinking-trace-bounded-plan-2026-09-15.json). This does not establish the cause of historical stalls or qualify the new source.

## Proportional planning experiment (2026-09-15)

The trace-enabled original JSON Patch candidate failed after 125.2 seconds with no file changes; the baseline was not launched. The private trace retained all 84,349 reasoning bytes across 20,957 deltas, bound to the actual input. It contains repeated design reconsideration and future-tool scheduling before baseline execution, rather than identical repeated blocks. This suggests a planning/action-granularity issue but does not isolate a single cause. Three provider financial reservations correspond to four local admissions: two settled for 3 fen, one cancelled request retains 600 fen, and the next dispatch was denied. See [trace audit](artifacts/thinking-trace-live-audit-2026-09-15.json) and [terminal receipt](artifacts/thinking-trace-stopped-2026-09-15.json).

`ContextPolicy.planning = proportional-v1` is explicitly selected by `current-integrated.v4`. The new `plan-guidance-policy.ts` prioritizes the next known evidence-gathering action, permits focused repairs without optional durable plans, groups plan steps by outcomes, and explains the existing ready-step complete/start behavior. It retains mandatory/user-requested plans, dependency-result ordering, verification and authorization. Defaults and v3 stay unchanged; 64 tool subsets produce byte-identical default guidance against the previous frozen source.

30 targeted tests pass, including the composed Agent path with local execution, before-edit verification denial, fresh verification evidence and recovery policy binding. Contracts/Runtime compilation passes; the six existing architecture failures remain with no new violations. Source `proportional-planning-v1` binds 5653 files. One original candidate-first pair has terminated; no paid job is running or queued. See [offline validation](artifacts/proportional-planning-offline-validation-2026-09-15.json) and [bounded plan](artifacts/proportional-planning-bounded-plan-2026-09-15.json). No default promotion or full quality qualification is claimed.

The v4 candidate `run_b34f6531cdd547cb9bcf` completed the original JSON Patch task and independent grader: 10 settled requests, 64 fen, 265.9 seconds, only the two permitted source files changed, three recovered tool failures, and no thinking-guard event. All nine primary invocation capsules contain the selected guidance. Baseline `run_48f768f478d2472f84ef` failed after 125.2 seconds with semantic stall and no edits; it added 3 settled fen and one 600-fen unreceipted reservation. The local API counter still had 60 admissions remaining, but the new reservation violates the unchanged spending evidence predicate. Thus the cohort has **zero qualifying pairs**, two terminal Runs and 178 unstarted positions. Candidate success does not establish causal improvement or complete qualification.

Cumulative local accounting is 4308 settled fen plus 5400 reserved fen = 9708 fen; 292 fen remains under CNY100. This is below the required 600-fen next-request reservation, so all paid work is stopped with none queued. No historical reservation was released or repriced. See [pair audit](artifacts/proportional-planning-pair-2026-09-15.json), [guidance delivery](artifacts/proportional-planning-delivery-2026-09-15.json), and [final assessment](artifacts/proportional-planning-final-assessment-2026-09-15.json). The full 30-case/3-trial quality gate remains incomplete and defaults are not promoted.

## Operation-specific patch argument diagnostics (2026-09-15)

The successful v4 candidate retained three recovered tool failures. Two original `apply_patch` calls supplied whole-file `content` to `replace`, which requires `edits[]`; the third was a command argument exceeding the unchanged 2048-character limit. The accepted tool definition already describes these constraints. The patch parser's generic error did not identify the expected shape.

`workspace-patch-input-error.ts` now returns static guidance for each of the four existing patch operations, without echoing paths, contents or argument values. Parsing still rejects the same shape before cleanup, observer access or writes. The edit-reference decorator preserves this typed argument error instead of misclassifying its anchor-field wording as a stale snapshot requiring another read. Description/schema, mutation logic, permission/CAS rules and automatic retry behavior are unchanged; invalid content is not coerced into an edit.

19 targeted tests and Runtime compilation pass; architecture retains only the six existing violations. A native replay on a disposable copy of the original fixture rejects both exact historical calls before effects, then commits caller-corrected `oldText/newText` arguments to exactly the intended bytes. Stale replays still reject with the existing snapshot recovery guidance. The first replay helper had an incorrect import path and failed at module loading; corrected v2 produced the final evidence. No model requests were made, and budget state remains 9708/10000 fen occupied. See [source-bound validation and native replay](artifacts/patch-argument-diagnostics-validation-2026-09-15.json). This worktree delta is not frozen and has no new full-Agent quality observation.

## Completion audit and financial block (2026-09-15)

The latest verified patch-diagnostic source is archived as `/tmp/napier-harness-patch-diagnostics-v1`, binding 5658 files. The immutable v4 profile, prior source/results and driver v8 are retained. The new snapshot has no model observations and no scheduled campaign. See [resume snapshot](artifacts/harness-resume-snapshot-2026-09-15.json).

The [seven-module completion audit](artifacts/harness-completion-audit-2026-09-15.json) confirms that implementation presence and scoped tests do not establish complete qualification. Representative actual edit-format adoption, long-task recall/cache attribution and current whole-composition quality remain incomplete. Existing architecture/release evidence failures and replay/environment limitations remain disclosed. No default policy is promoted and the goal is not complete.

The same financial condition has persisted across three goal turns: 9708 fen occupied under the authorized 10000-fen cumulative ceiling, leaving 292 fen against a mandatory 600-fen next-request reservation. Nine missing terminal receipts retain 5400 fen. No complete provider usage evidence supports releasing them. Paid dispatch remains stopped. Reliable missing usage receipts enabling deterministic settlement, or an explicitly revised cumulative budget, are required before further model qualification; then revalidate the frozen source, tariff, environment and candidate-first bounded plan. Speculative additional policies, repeated offline checks and older-source successes cannot replace that evidence.

## User-reported aggregate spending checkpoint and resumed cohort (2026-09-15)

The user reports that the official dashboard shows CNY20 total consumption and authorizes continued work. A separate prospective ledger starts with 2000 fen prior consumption under the unchanged 10000-fen ceiling, giving 8000 fen initial headroom. This is explicit user-reported aggregate evidence, not an independently retrieved invoice or invented individual usage receipt. The original ledger's 728 requests, nine unresolved reservations and all quality exclusions remain unchanged. Do not add the old conservative occupancy to the reconciled starting amount.

The current official pricing page confirms off-peak rates are half the peak rates used by the conservative driver, and says Flash aliases now route to DeepSeek-V4.1-Flash. The old 9708-fen occupancy included 5400 reserved fen and was never actual billed consumption. New calls retain peak-rate reservation/complete-usage settlement. The newly served epoch is not pooled causally with older model observations.

Verified the complete `patch-diagnostics-v1` freeze and started at most two original candidate-first pairs: configuration layers and cursor pagination (50/51, 53/52). These broaden coverage instead of repeating the successful JSON Patch candidate. Source, profile v4, driver v8, original task/grader, 64 admissions, 15-second serial cadence and 15-minute deadline remain fixed. Stop on candidate/evidence failure; no later batch queued. See [checkpoint](artifacts/user-reported-spending-checkpoint-2026-09-15.json) and [bounded plan](artifacts/user-reconciled-bounded-plan-2026-09-15.json).

The resumed two-pair batch completed successfully. Configuration candidate/baseline: 9/25 requests, 159311/407531 ms, 34/70 fen; pagination: 9/20 requests, 203075/326162 ms, 46/61 fen. All four original independent graders returned exit 0 and only the two permitted source files per task changed. Candidate tool failures were 1 and 2; baselines each had 1, all recovered. Both candidate input sets (16 primary capsules) contain the explicit guidance and coding resolutions; no thinking-guard detection occurred. No single-module causal effect or general efficiency claim is made.

The new epoch has 63 fully settled requests, 211 fen new conservative charges and no unresolved reservation. Its cumulative 2211 fen includes the user's reported 2000-fen starting amount; 7789 fen remains. The old ledger's logical hash is unchanged, preserving its 728 historical rows and all previous failed-quality exclusions. Minimum measured admission spacing across the complete four-Run sequence is 15000 ms. The full schedule now has four terminal Runs and 176 unstarted positions; quality counts two valid pairs and remains insufficient for the unchanged 30-case/3-trial gate. All processes have terminated and no later batch is queued. See [complete pair evidence](artifacts/user-reconciled-two-pairs-2026-09-15.json) and [final source/input/financial audit](artifacts/user-reconciled-final-audit-2026-09-15.json).
