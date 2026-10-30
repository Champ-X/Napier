# Ordinary child model preparation and capture

Source commit: `1c0dab83f65fe47fe3bc29401733d7c6bbcd313b` (local, not pushed).

Ordinary `subagent_turn` calls now use the Runtime's configured compiler, prepare/finalize/around extensions, harness profile and token meters, on both first launch and continuation. Shared preparation and compiled-capture helpers serve the main and child paths. The child retains its own ModelSession, cancellation, reservation, accounting and recovery ownership.

Before the change, real local first-launch and continuation probes completed without the child hooks, custom meter activity, harness receipt or compiled prompt package that the parent exercised. The retained probe binds 13 selected source files, rather than a frozen whole baseline. An intermediate implementation also allowed an in-place tool mutation from a hook returning void to reach one faux-provider call. The final guards reject both returned and in-place excluded-tool changes before dispatch, isolate mutable request data, and prevent around hooks from changing the captured request.

Auxiliary compaction carries its compiled artifact into child capture. Request-local tool narrowing is bound to the captured envelope and checked against full private checkpoint definitions. Raw role prompts, tools and checkpoint messages remain intact. Child continuation context uses explicit validated predecessor windows, excluding supervisor context and later predecessor events. Compaction and request-aware prompts share a budget tracker that includes inherited turn debt.

## Verification and retained failures

| Evidence | Result | Scope |
| --- | --- | --- |
| Original isolated regression | 27 files / 225 passed | 187 existing and 38 new cases |
| Root integration with committed G07 queries | 9 files / 55 passed | The same 38 plus 17 query/mailbox cases; Runtime/CLI/Server compile passed |
| Corrected test typing, owner | 6 files / 38 passed; strict passed | Same case identities; five test bodies changed, all 28 production files unchanged |
| Corrected test typing, root | 5 files / 20 passed; strict6 passed | A subset of the 38; source and emitted hashes stable |

These counts overlap and must not be added. Root initially found nullable JsonValue accesses, an untyped mock argument and an incomplete event fixture in strict test compilation. That failure is retained. v3 uses checked object/array narrowing, existing envelope/capsule validators and complete fixture metadata; the original 225-case suite was not repeated after these test-only corrections. Earlier v2 removed only two extra EOF blank lines. Root's provider body additionally includes the already committed G07 mailbox query change.

The isolated architecture gate retains seven existing failures; the public API gate retains four. These gates are not passing. The separate `agent-kernel.test.ts` result remains 2 passed / 2 failed, reproduced without this candidate and excluded from the 225. No budgets, compatibility digests or historical release evidence were rewritten. All model traffic used local faux providers; the new integration tests prohibit fetch. The 28 protected user files remained unchanged.

## Evidence and limits

The [archive](artifacts/child-model-lifecycle-2026-10-30.tar.gz) and [member index](artifacts/child-model-lifecycle-evidence-index-2026-10-30.json) preserve original probes, intermediate failures, v1/v2/v3 patches and source manifests, raw tests, strict diagnostics and root integration/commit receipts. Verify hashes and exact case overlap without extracting or executing archive code:

```sh
python3 docs/artifacts/child-model-lifecycle-reconcile-2026-10-30.py
python3 docs/artifacts/child-model-lifecycle-reconcile-2026-10-30.py --workspace .
```

This verifies retained evidence rather than rerunning tests. Original absolute paths in logs/configs are historical provenance. `typed_repair` and `outcome_repair` still use their existing exact-capture path; low-level callers that omit injected services retain legacy behavior. Native child task-memory query usefulness remains unestablished because children do not emit `message.user` events. Native overflow success, coder recovery, remaining cancellation/restart coverage and full G03 acceptance remain open.
