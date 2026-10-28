# Harness experiment analysis protocol

New definitions produced by `createHarnessExperiment` bind an `analysis`
protocol into the experiment digest before execution. The protocol declares each
metric's unit, direction, absolute non-inferiority margin, and minimum effective
difference. Callers should set domain-specific margins rather than reuse one
numeric tolerance across metrics with different units.

The default evidence class is `contract_fixture`. A caller must declare
`deterministic_integration`, `live_model`, or `production_task` explicitly when
appropriate, and each trial must carry the matching class. Missing trial classes
are treated as fixtures, never inferred to be live from a model name.

## Decisions and uncertainty

The analysis resamples paired **case means** (or task-family means when explicitly
selected), keeping all seeds in their cluster. Every cluster has equal weight.
The default is 2,000 deterministic bootstrap samples, 95% family-wise confidence,
and at least 10 independent clusters. Bonferroni-adjusted percentile intervals
cover all declared primary and guardrail metrics. These are empirical intervals,
not proof of generalization beyond the represented task distribution. In
particular, identical observations yield a degenerate bootstrap interval.

Candidate-minus-baseline intervals are stored in the original unit. For decisions
they are oriented so positive means better:

| Condition | Metric decision |
| --- | --- |
| Lower bound exceeds the minimum effective difference | `improved` |
| Upper bound is below the negative non-inferiority margin | `regressed` |
| Lower bound is at or above the negative non-inferiority margin | `non_inferior` |
| Interval crosses the non-inferiority boundary | `inconclusive` |
| Missing pairs, metrics, or independent clusters | `insufficient` |

An experiment improves only if at least one primary improves and every other
primary and guardrail establishes non-inferiority. A point estimate in the right
direction is insufficient. The 90/90 → 89/90 example with a 0.02 margin is
`inconclusive`, because its clustered interval crosses the margin. Uniform small
declines whose intervals remain inside the margin are `non_inferior`.

## Execution and reporting

The executor alternates AB and BA for consecutive case/seed pairs. The ordered
trial list records the dispatch order; failed execution cells are retained without
automatic replacement. A failed cell keeps the paired result insufficient. A
duplicate run or duplicate cell is rejected rather than selecting a best result.

Cases declare a `taskFamily` and a `tuning`, `regression`, or `holdout` partition.
A family cannot span partitions within an experiment. The system cannot prove a
family was never seen in an external tuning process: campaign provenance must
record that history. Default cases are regression cases, not a blind holdout.

Per-family/partition/arm summaries report success rate, total spend divided by
successful tasks (including failed-task spend), P95 duration, the fraction of
tasks requiring intervention, and independently scored false-completion rate.
Absent metrics or missing trials produce `null`, not zero. Currency costs and
false completion must be supplied by qualified billing/grader evidence; a Run's
terminal status alone is not an independent task outcome.

## Evidence and historical compatibility

| Evidence class | Supported claim scope |
| --- | --- |
| `contract_fixture` | Contract behavior only |
| `deterministic_integration` | Deterministic integration behavior only |
| `live_model` | Scoped real-model quality, with all qualification gates |
| `production_task` | Scoped production-task quality, with all qualification gates |

New release evidence includes `claimScope`; fixture/integration evidence cannot
set `promotionReady`. Live promotion also requires untuned-family evidence,
source/configuration/environment/grader bindings, no fixture credentials, stable
release controls, and conclusive metric decisions. These checks do not turn
caller-supplied hashes into an independent audit of their underlying artifacts.

Historical definitions without `analysis` remain readable. Their old receipts are
verified without rewriting bytes or hashes; a historical `promotionReady` is
contract-era metadata and **does not establish live quality**. Current verifier
output exposes the scope and does not report historical receipts as eligible for
live promotion. The direction bug is corrected even for legacy evaluation.

The fixture evidence generator now writes
`docs/artifacts/harness-experiment-contract-evidence-0.1.4.json`, leaving the
retained `0.1.3` receipt untouched. To check that retained receipt:

```sh
node scripts/create-harness-experiment-release-evidence.mjs --verify docs/artifacts/harness-experiment-release-evidence-0.1.3.json
```

## Existing real-model campaign integration

`run-harness-optimization-suite.mjs --analysis-protocol PATH` uses the same
analysis engine, existing AB/BA scheduler, snapshot preparation, budget guards,
independent grader and failure retention. The protocol file declares the model
lock and metric rules; both arms must supply explicit profile files, and each
suite case must declare `taskFamily` and `partition`. The suite freezes profiles,
task inputs, rules, evaluator code digest and the complete schedule in `analysis-plan.json` before any
child launches. Each child validates its address, input digests, model and profile
before making model calls, then includes the plan binding in its report.

The final `suite-result.json` includes the clustered analysis and original
report/source/profile/environment/grader bindings. Every missing, failed or
changed report remains visible. Recorded usage must reconcile before token/USD
metrics are included; unreconciled data stays unknown. USD is observed model
usage cost, not an independently verified external bill. Family reports include
P95 time, intervention rate and completed-Run/failed-independent-outcome rate.

`evaluateCampaignQuality` schema v2 names its existing 30-case/3-trial predicate
`qualityGatePassed`. Its `promotionReady` is always false: the sample gate cannot
replace predeclared statistics and evidence qualification. Convergence and
missing-usage recovery still use the sample gate for collection decisions; they
do not manufacture live-quality claims. The suite can promote only when both the
old quality gate and the new bound analysis qualify. Tuning partitions may be
reported but cannot qualify for promotion. Runs without a protocol
remain useful descriptive evidence and cannot promote.

[harness-analysis-protocol-v1.json](../benchmarks/harness-analysis-protocol-v1.json)
is a conservative starting rule set: no quality/latency/intervention regression,
more than 100 fewer input tokens, 30 cases × 3 trials, and at least 10 independent
task families. It is not an executed experiment or a statement that any candidate
passes. A new study must freeze its own suitable rules before observing results.
Existing regression tasks cannot be relabelled as unseen holdout tasks merely to
pass the gate.

The regression suite includes a hash-verified historical false completion; see
[retained failures](../benchmarks/harness-failures/README.md). Passing contract
tests or replaying historical output is not evidence of a current model-quality
improvement.
