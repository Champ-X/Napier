# Harness preparation profiling

G07 starts with measured preparation costs. The benchmark uses the existing
`LocalStore`/SQLite read worker, complete tool-loop guard replay, and
`prepareAgentInvocationContext` entry. It does not dispatch a provider or claim
model quality, billing, or end-to-end latency improvements.

```sh
node scripts/profile-harness-preparation.mjs \
  docs/artifacts/<new-profile>.json
```

The standard scales are 10,000/100,000 synthetic events and 1,000/10,000 reviewed
synthetic memory facts. `--smoke` uses 100 events and 50 facts. Each phase repeats
three times; memory has a cold index followed by two warm observations. Event
seeding uses production store appends but happens outside timed phases. Source
files, consumed Runtime/Contracts JavaScript trees, the lockfile and both scripts
are hashed before and after capture. Output paths cannot overwrite a prior run.

The event workload contains one model response and matching synthetic read-tool
terminal per 100 events; the rest are text deltas. It exercises a noisy long Run,
not a representative distribution of all user tasks. No tool was physically
executed by those seeded records. Loop replay uses the production detector,
trigger projection and active-guard projection without replacing their logic.

Memory facts share 32 local source files. Ten percent carry an intentionally
stale digest; three additional records are foreign-agent, unreviewed, or expired.
The actual preparation path must exclude them. The benchmark calls the existing
working-state and memory preparation with a real event store; only repository
fact loading is supplied as `structuredClone` of reviewed fixture records. Cold
and warm preparation must produce identical context digests, and stale/forbidden
facts must stay excluded. The production FTS receipt reports updated/reused rows;
this is an index reuse metric, not evidence of dependency-read cache hits.

The observer is local to the benchmark process. It wraps SQLite `all`/`get`,
filesystem reads and JSON decoding, and prepends the same observer to the existing
SQLite worker. SQL statements and returned values remain unchanged. An extra
response field carries worker metrics; Runtime ignores it. Counts represent rows
returned to JavaScript, not SQLite's internal rows visited. Every worker query
also checks event-return and JSON-decode counts agree with its actual result.

JSON decoding samples one in 32 calls per worker query and records executing
thread CPU and wall time. These are sample totals, not exact aggregate decoding
CPU; timer/counter overhead remains included. Phase measurements include observer
overhead. RSS is observed at phase boundaries and every 20 ms; process high-water
RSS includes setup and preceding phases. No operating-system cache flush is
performed. A future before/after comparison must preserve workload, instrumentation
and environment, and retain unfavorable results.

Invocation timings cover working-state and memory preparation. Loop-guard replay
is timed separately. This does not yet measure the entire model-call pipeline,
mailbox processing, live-model policy ablations, or model-specific cache benefits.
An optimization must first preserve replay/context/freshness semantics and then
receive its own current source/build-bound comparison. Broader G02/G07 acceptance
remains open.

## Baseline captured on 2026-10-29

The [bound baseline](artifacts/harness-preparation-baseline-2026-10-29.json)
completed all 12 observations with unchanged selected source/build bindings and
zero model invocations. This is a local worktree snapshot, including compiled
rotation-lifecycle work already present before capture, not a clean release.

| Component | Scale | Observed wall time | Worker event rows per observation | Dependency reads |
| --- | --- | --- | --- | --- |
| Complete loop-guard replay | 10k events | 15.86–20.28 ms | 10,001 | 0 |
| Complete loop-guard replay | 100k events | 192.38–217.36 ms | 100,001 | 0 |
| Invocation state + memory, cold index | 100k events / 1k facts | 398.48 ms | 100,001 | 1,000 |
| Invocation state + memory, warm index | 100k events / 1k facts | 346.93–354.53 ms | 100,002–100,003 | 1,000 |
| Invocation state + memory, cold index | 100k events / 10k facts | 4,301.21 ms | 100,004 | 10,000 |
| Invocation state + memory, warm index | 100k events / 10k facts | 1,255.28–1,277.26 ms | 100,005–100,006 | 10,000 |

The added rows are the initial user event and each durable preparation receipt.
Warm indexes reused all 900/9,000 eligible facts, but dependency validation still
read all 1,000/10,000 references despite only 32 unique paths. The 100/1,000 stale
facts and three unauthorized/unreviewed/expired records remained excluded; each
scale's cold and warm context digests matched.

Sampled process RSS rose from approximately 266 MiB during the first replay to
1,185 MiB at the last memory observation. That process includes seeded data,
prior phases, worker clones and unforced garbage collection. This is neither a
per-component allocation count nor proof of a retained-memory leak. CPU samples,
SQL returned rows and raw per-phase observations remain in the receipt.

The next bounded changes are a Run-scoped typed-event cursor for loop guards and
fresh, invocation-scoped deduplication of repeated file dependencies. Both must
be compared with the unchanged full replay/context path, including late terminal
events, changed file contents, revoked facts and access-boundary failures. No
performance improvement has been claimed from this baseline alone.

## Incremental preparation candidate

Each active Run now owns one loop-guard cursor shared by the model loop and tool
preflight. It reads only new `model.response`, tool terminal/block and loop-guard
trigger events. Query, scope/order validation, detached copying and projection
must all succeed before its watermark advances. The existing full-replay
functions still project the retained relevant history, including late terminal
events and changed policy. This reduces repeated event retrieval; it does not
make replay CPU constant or bound the retained typed history independently of
Run length.

Memory dependency observations last for one invocation. Exact repeated paths
share a digest, but every fact compares its own expected version. Reused paths
receive a second content read after indexing; a changed, missing or inaccessible
source removes every dependent fact and resynchronizes the index before
selection. A path referenced only once retains one read. Eligibility checks
still precede file access, and the existing workspace boundary and UTF-8 checks
remain authoritative. There is no cross-invocation freshness cache. Stable
inputs preserve context and semantic receipts; a source changed during indexing
is intentionally excluded even where the old implementation could retain it.

The [candidate regression receipt](artifacts/incremental-preparation-regression-2026-10-29.json)
records 8 files and 127 passing tests. These cover full-replay equality at each
prefix, late/duplicate terminals, policy changes, failed or malformed deltas,
serialized refreshes, real SQLite query isolation, the production Run/preflight
integration and memory freshness/provenance boundaries. Fixture/demo model
execution in those tests is not a live-model quality evaluation.

## Pinned-reference comparison on 2026-10-29

Run `node scripts/compare-harness-preparation.mjs <new-receipt.json>` after
compiling Runtime and Contracts. `--smoke` uses 300 events, enough to exercise
the actual loop trigger. Every invocation refuses to overwrite its receipt and
retains its private raw directory under ignored `benchmark-results/`.

The [successful comparison](artifacts/harness-preparation-comparison-2026-10-29-v2.json)
uses unchanged Runtime source from `0560f00944804b151086269b190377c6f8a0a7ce`,
materialized with its complete 84-module relative import closure. Original Git
blob IDs, source/emitted hashes and import edges are retained. Both arms share
bound package dependencies and the same fixture bytes, with private ledgers and
indexes. Production bulk bootstrap, reopen/hash verification and delta writes
are outside timing. The earlier baseline receipt is unchanged.

Eight fresh subprocesses execute AB then BA with the probe enabled, followed by
AB then BA without it. All 168 observations completed; 84 paired outputs match
exactly, including the complete invocation receipt except the declared index
metrics and new dependency-validation metrics. Nine separate filesystem/SQLite
cases cover stable and conflicting versions, inter-invocation edits/restoration,
revoked/expired/foreign/unreviewed facts, missing/invalid/escaped sources and the
intentional during-index freshness difference. The latter retains both unsafe
old facts in the reference and excludes both from the candidate and its index.
An [independent verification](artifacts/incremental-preparation-verification-2026-10-29.json)
checks the current source/build/script bindings, Git blobs, worker report hashes,
all paired semantics, all 16 trigger stages and the 28 preserved user files.

The following ranges are the two probe-off processes per arm; warm memory ranges
include two warm observations in each process. Times describe these synthetic
components, not end-to-end Run or model latency.

| Component | Scale/state | Reference wall ms | Candidate wall ms |
| --- | --- | --- | --- |
| Loop guard | 10k events, cold | 17.92–19.94 | 2.75–2.89 |
| Loop guard | 10k events, unchanged warm | 16.16–16.38 | 0.39–0.40 |
| Loop guard | 100k events, cold | 190.78–191.27 | 22.60–23.13 |
| Loop guard | 100k events, unchanged warm | 192.63–194.92 | 1.51–1.57 |
| Invocation state + memory | 100k events / 1k shared facts, cold | 382.51–385.28 | 297.70–303.45 |
| Invocation state + memory | 100k events / 1k shared facts, warm | 330.71–339.59 | 247.91–251.81 |
| Invocation state + memory | 100k events / 10k shared facts, cold | 4,271.10–4,296.42 | 3,365.77–3,371.40 |
| Invocation state + memory | 100k events / 10k shared facts, warm | 1,231.71–1,252.33 | 296.74–309.94 |
| Invocation state + memory | 100k events / 1k unique files, cold | 380.55–383.76 | 386.60–386.99 |
| Invocation state + memory | 100k events / 1k unique files, warm | 330.65–348.68 | 336.90–340.09 |

The unique-file control has no read-count saving and was slightly slower cold;
its warm ranges overlap. It does not support a general speedup for all memory
workloads. Shared facts use 32 paths: measured content reads fall from
1,000/10,000 to 64, including the second freshness read. The unique-file control
remains at 1,000 reads. Invocation working-state/memory still retrieves the full
100,001–100,003 event rows. That path has not gained an incremental event cursor.

For the declared noisy Run corpus, the loop cursor returns 200/2,000 rows cold
instead of 10,001/100,001, zero for unchanged/noise-only refreshes and one for
each trigger/pending/late-terminal delta. Full replay remains the semantic
oracle. These counts are returned rows, not internal SQLite scans; the corpus
contains only two relevant events per hundred and does not measure a dense
all-tool-event workload.

Observed probe-on/off wall ratios range 0.947–1.101 for the reference and
0.885–1.095 for the candidate. Separate process order and warm OS caches prevent
interpreting those ratios as pure instrumentation overhead. Sampled RSS across
all phases ranges about 195–1,516 MiB for reference workers and 198–1,148 MiB for
candidate workers; setup, previous phases and unforced GC remain included. No
per-component retained-memory or statistically significant improvement is
claimed. CPU/JSON samples and unfavorable observations remain in the receipts.
For example, probe-on cold 10k-fact preparation had a larger sampled RSS increase
in the candidate (57.19–57.39 MiB) than in the reference (37.69–38.66 MiB).

The [first full attempt](artifacts/harness-preparation-comparison-2026-10-29.json)
is retained as failed evidence: the fixture assigned a model category to the
system-category loop-trigger event, which the production registry rejected.
After correcting the script and extending smoke coverage to that branch, the
new full receipt passed. This was a harness correction, not selection of a
faster successful trial. Mailbox cursors, broader memory-index maintenance,
complete pre-call profiling and G02-bound model/task-family ablations remain
unfinished; there were zero model requests in this comparison.

Smoke history is also retained: [v1](artifacts/harness-preparation-comparison-smoke-2026-10-29-v1.json)
used a nonexistent store accessor; [v2](artifacts/harness-preparation-comparison-smoke-2026-10-29-v2.json)
had a cleanup exception that obscured its earlier failure. Its 50-fact read-count
expectation was also corrected to account for only 18 reused paths.
[v3](artifacts/harness-preparation-comparison-smoke-2026-10-29-v3.json) passed but
did not exercise a trigger; [v4](artifacts/harness-preparation-comparison-smoke-2026-10-29-v4.json)
uses 300 events and covers it. These development receipts are not additional
independent performance trials.
