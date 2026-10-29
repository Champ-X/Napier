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
