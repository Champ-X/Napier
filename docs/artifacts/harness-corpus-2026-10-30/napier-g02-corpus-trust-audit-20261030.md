# G02 corpus trust-boundary audit

Read-only audit of implementation in progress, 2026-10-30 Asia/Shanghai. No production edits and no model calls. The implementation owner received findings immediately and may already be fixing them; this report describes the exact source digests in the retained reproduction output, not an assertion that all findings remain present after those fixes.

Inputs: `/tmp/napier-harness-partition-design-20261030.md`, current corpus modules/contracts/catalog/scripts, campaign plan/bind/report path, generic release validation and consumers.

Evidence:

- Reproduction: `/tmp/napier-g02-corpus-audit-20261030.mjs`.
- Results and audited source digests: `/tmp/napier-g02-corpus-audit-20261030.json`.
- Rehashed conflicting plan: `/tmp/napier-g02-corpus-plan-repro-MG7KRo/forged-plan.json`.
- Missing-provenance loader input: `/tmp/napier-g02-missing-provenance-catalog.json`.
- Inventory checker result: `/tmp/napier-g02-corpus-inventory-audit-20261030.json`.

## P1 — frozen plan case identities are not cross-bound to selected corpus tasks

Location: `scripts/harness-campaign-analysis-plan.mjs`, `validateCampaignAnalysisPlan` and `bindCampaignAnalysisJob`.

The plan validator checks each `plan.cases[].inputSha256` against the experiment, but checks prompt/fixture/memory/grader digests only for syntax. It never recomputes the task identity and compares it to the corpus selection or matches the grader to the selected alias. The child then compares actual input digests against `plan.cases`, independently of the corpus task.

Confirmed: create a valid sealed synthetic plan, replace its first case's fixture/prompt/memory/grader digests with the exposed pricing-options task, leave the selected synthetic task and inputSha256 unchanged, and recompute only the plan hash. Both validation and `bindCampaignAnalysisJob` accept. The selected task and actual exposed task have different task digests in the retained JSON.

Impact: a self-consistent plan hash can conceal a semantically contradictory holdout binding at the exact child pre-dispatch gate. No claim that a previously issued external expected hash can be changed undetected: the bug is acceptance of a freshly rehashed contradictory plan.

Fix: validate plan case fixture/prompt/memory against `corpus.selection.taskSha256` and its catalog task; validate outcome digest and input digest against the exact alias. At child binding, recompute task identity from actual bytes and repeat the selection check. Do not trust only the plan's parallel case projection. Add a zero-child-counter test for a rehashed conflict.

## P1 — changed inputs can reuse a known case ID/path under a new holdout family

Location: `packages/harness-eval/src/harness-corpus.ts`, `validateTask` / merge validation.

Definition uniqueness is keyed by `caseId:inputSha256`. Changing inputs makes that key new, while no cross-task rule binds a previously known source path or case ID to its canonical family. Keeping all original baseline rows intact therefore does not prevent a new sealed row from reusing a known alias and assigning another family.

Confirmed: a new synthetic task under `audit-sealed-family` reuses case ID `coding_pricing_options_migration_v1` and path `benchmarks/coding/pricing-options-migration-v1`, with changed input/grader digests. Additive merge and holdout binding accept it although the retained task is in exposed `pricing-policy`.

Fix: enforce stable alias-to-canonical-family mappings independently of exact task/input identity. Known case IDs and normalized source paths cannot move to a new family when fixture/prompt/grader changes. Preserve exact-identity deduplication as a separate rule. Semantic similarity between wholly new names and inputs cannot be proven by hashes; document that remaining review boundary.

## P1 — family exposure can be hidden by omitting evidence from evidenceIds

Location: `packages/harness-eval/src/harness-corpus.ts`, `validateFamily` / `validateTask` / evidence validation.

A sealed family requires its referenced evidenceIds to be holdout provenance. The validator does not look for other catalog evidence carrying that familyId. Task refusal only checks non-holdout evidence with the exact selected taskSha256.

Confirmed: add `kind: source` evidence with `familyId: audit-sealed-family` but omit it from the family's evidenceIds and omit taskSha256. The sealed family and holdout selection still validate.

Fix: treat familyId-linked exposure anywhere in the catalog as authoritative, or require bidirectional evidence membership and reject orphan/contradictory evidence. Validate evidence family/task references and their consistency. A catalog's optional index array must not erase declared exposure.

## P1 — provenance seal is not bound to a frozen task/family set

Location: `packages/contracts/src/harness-corpus.ts`, holdoutProvenance; `validateFamily` / `validateSelection`.

The seal contains custodian/source/time/scope/artifact/evidence ID, but no frozen family or task-set digest. The artifact evidence row need not bind a family or task either.

Confirmed: after constructing a sealed family, replace its task fixture/input/task digests and rehash the catalog. The exact original seal still validates and permits holdout. This does not prove a custodian lied; it proves the schema cannot establish what the seal covers.

Fix: bind a versioned canonical family/task-definition set digest into the provenance assertion and evidence record, then validate exact selected membership. The digest must include the intended scope/identity components and prevent adding or substituting tasks under an earlier seal. Preserve legitimate grader-only identity rules explicitly.

## P1 — filesystem preflight accepts nonexistent holdout evidence

Location: `scripts/harness-corpus-catalog.mjs`, `loadHarnessCorpusCatalog`.

The loader parses/merges catalog JSON but never reads the declared provenance artifact, checks its raw bytes digest, or resolves the declared JSON pointer. Pure validation only compares the declared artifactSha256 to the declared evidence.fileSha256.

Confirmed: `loadHarnessCorpusCatalog('/tmp/napier-g02-missing-provenance-catalog.json')` accepted 30 sealed families referencing absent `synthetic/*.json` files. Its first reference is `synthetic/auditfamily-0.json`, file hash `16dddc9b257c5dde85b2943406d1188e49843a891091b2bd95260e9187a1b614` as printed by the command; consult the JSON input for the exact hash bytes.

Fix: the filesystem-owning preflight must verify required source/provenance artifacts and pointers before accepting a new catalog-bound campaign. Pure schema validation can remain deterministic, but needs a bound verification receipt at the real dispatch boundary. Fixture declarations should be visibly test-only and non-promotable, not silently exempt production evidence checks. Hash-valid artifacts still attest consistency, not universal non-exposure or truth of the custodian's claims.

## P1 — historical readability still feeds current release readiness consumers

Locations: `harness-experiment-release-evidence.ts` historical policy switch; `scripts/check-release-artifacts.mjs:858`; `scripts/create-agent-harness-acceptance-evidence.mjs:108` as audited.

Omitting corpusPolicyVersion selects legacy rebuild behavior. The historical payload remains readable, which is required, but the two consumers inspect only its embedded promotionReady rather than current policy qualification. The modified standalone verifier CLI already distinguished policy version at audit start; that did not cover these consumers.

Confirmed: retained `docs/artifacts/harness-experiment-release-evidence-0.1.3.json` validates with promotionReady true, no corpus, no corpusPolicyVersion and no claimScope. Both audited consumer branches would pass their Harness promotion check on that value. Other full-release source-manifest/artifact gates may still fail, so this is a local qualification bypass, not a claim that a full release succeeds.

Fix: preserve historical bytes and validation, and add one shared current-policy qualification helper used by every release/acceptance consumer. Missing corpus policy, missing live/production scope, and failed corpus qualification must remain explicit blockers. Do not rewrite the historical receipt's hash just to force promotionReady false. The owner began adding such a helper during this audit; rerun after all consumers are wired.

## Inventory evidence that did pass

`node scripts/check-harness-corpus-catalog.mjs` passed read-only:

- 52 source roots, including all 49 optimization roots.
- 15 suites, 41 distinct input identities, 35 canonical families.
- 184 campaign evidence entries, 166 distinct observed Run IDs.
- 25 raw report references verified; zero unavailable raw reports in this checkout.
- Catalog digest `1e8decce5c781a6ba5e2f373bc3e88f8e122c55a041425e8c090d5f07ed6db44`.

Current baseline contains no sealed holdouts. Exact exposed input identities and retained historical task digests are already checked independently of grader identity. The additive floor retains baseline rows. These protections are useful; the findings concern the missing cross-bindings and downstream qualification paths around them.

## Required focused follow-up

After owner fixes/builds, rerun the retained reproduction with the new type requirements, then execute real child preflight tests with a counter that remains zero for contradictory plans/provenance. Add separate controls proving retained legacy evidence still validates but current qualification refuses it, and valid new synthetic contract evidence still cannot qualify live quality. Do not use successful synthetic provenance validation as evidence that a real untouched cohort exists.
