# Harness corpus provenance and exposure

The catalog records known task/family exposure and binds it into qualification
plans. This implements a G02 mechanism; the current real catalog has **zero
holdout families**. It does not establish unseen-task generalization, live-model
quality or release readiness.

## Task identity and known exposure

The versioned [catalog](../benchmarks/harness-corpus-catalog-v1.json) and
[family map](../benchmarks/harness-corpus-family-map-v1.json) cover 52 source roots
(including 49 optimization roots), 15 suites, 41 exact task identities and 35
canonical families. They retain 184 campaign evidence references and 166 distinct
observed Run IDs. All 25 bound raw reports were available and hash-verified.

The 206 tuning memberships and one regression membership include versioned aliases;
they are not 207 independent tasks. Existing unpartitioned suites are tuning, and
the retained failure remains regression. No existing task is relabeled unseen.
Task identity binds fixture, prompt and memory inputs; changing a grader, case ID
or path does not create a new independent task. Family mapping is explicit curator
provenance, not automatic semantic paraphrase detection.

The code-owned baseline is a minimum known-exposure record. Supplements cannot
remove known facts, remap a known source to a new family, or omit evidence
references to hide exposure. Canonical relative source paths reject dot-prefix,
parent traversal, case and separator aliases.

## Frozen qualification inputs

A new holdout declaration records custodian, source, seal time and tuning-exclusion
scope and binds the full family task/alias membership. Qualification freezes the
declaration's original UTF-8 bytes and checks its digest, JSON pointer and content.
File validation requires bounded regular files and canonical realpaths, rejecting
final and ancestor symlink aliases. Frozen copies use exclusive creation; plan
read and dispatch revalidate the actual declaration artifacts.

Analysis campaigns load the baseline and an optional `--corpus-supplement` through
the `--analysis-protocol` path. Schema 2 plans bind the experiment and corpus;
child reports bind catalog/binding hashes and exact fixture, prompt, memory and
grader identities. Legacy schema 1 reports remain readable as descriptive evidence.

Current release qualification uses `qualifyHarnessExperimentReleaseEvidence`.
New live/production qualification requires corpus provenance under
`corpusPolicyVersion: 1`. A raw historical `promotionReady: true` or caller-written
`partition: holdout` is insufficient. The production release audit, acceptance
generator and verification CLI use this gate. Historical receipt bytes/hashes and
their original fields remain unchanged.

## Verification and retained failures

The final focused regression covers 125 tests across 12 files, including four
executable production-consumer tests: historical promotion rejection, missing
corpus rejection, a synthetic sealed-corpus positive control at the Harness gate,
and acceptance-generator rejection before collectors or artifact writes. The
positive control does not make the overall release pass. Independent final
boundary review passed 16 checks.

The [final regression](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/harness-corpus-regression-2026-10-30.json) records
compilation, strict test types, read-only inventory, historical verification,
source/emitted hashes and preserved user files. The
[evidence index](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/harness-corpus-evidence-index-2026-10-30.json) retains
earlier failed probes and an independently reproduced baseline: all 50 tests in
`check-release-artifacts.test.mjs` fail during unchanged OCI fixture construction,
before consumer assertions. Exact `31e9edb9` reproduces the same names, statuses,
errors and stacks after checkout-path normalization. The attempted temporary OCI
fixture correction was reverted after exposing the next stale receipt. These 50
tests are blocked coverage, not passing G02 acceptance.

The new [0.1.5 contract receipt](artifacts/harness-experiment-contract-evidence-0.1.5.json)
uses 360 local faux-provider Runs with an empty fallback route. It is contract-only,
non-promotable evidence; external model calls are zero. Its source binding describes
the combined checkout, including preserved user changes. It does not refresh the
historical product manifest or certify the complete release artifact set.

## Remaining G02 acceptance

An independent curator must supply genuinely separate task families with provenance,
access/use records, explicit study/candidate tuning-exclusion scope and frozen
inputs/graders. Freeze candidate source/profile and analysis rules before revealing
the cohort. A self-reported seal timestamp only proves internal consistency; the
current mechanism does not authenticate chronology or prove universal non-exposure.
If results inform tuning, retain that exposure and retire the cohort from future
holdout claims. Model pretraining exposure is a separate, generally unproven claim.

Zero external model calls allow deterministic intake, identity/grader checks and
preregistration. They do not provide the required genuine target-model observations.
Real unseen-family and live-quality acceptance, G02 and the overall roadmap remain
incomplete. Synthetic sealed families are mechanism tests only.

Read-only verification:

```sh
node scripts/check-harness-corpus-catalog.mjs
node scripts/create-harness-experiment-release-evidence.mjs --verify docs/artifacts/harness-experiment-release-evidence-0.1.3.json
node scripts/create-harness-experiment-release-evidence.mjs --verify docs/artifacts/harness-experiment-contract-evidence-0.1.5.json
```

Do not overwrite prior catalogs or receipts to obtain a passing gate. The generator
creates 0.1.5 with `wx`; if an interrupted invocation has already written it, inspect
and verify that file before considering another invocation.
