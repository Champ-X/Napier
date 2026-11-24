# Host model accounting ownership

Local implementation commit `7ce8097fca66f7950e42e018764c7849a3544d27` moves Host-lifetime receipt ownership into Runtime. Server retains capacity and budget policy plus Host SQL updates; `HostModelAccounting` owns the spool, physical observation normalization, scoped source, pending physical lifetimes, replay and acknowledgement. This is a functional ownership change, not an export namespace wrapper. Full G03 remains incomplete.

## Transaction and lifetime

A Host reservation and its attributed source reservation use the same synchronous SQLite transaction. Physical settlement commits the immutable receipt and Host slot/positive debt together. The workspace Store must commit its accounting claim before source ACK; source ACK and Host refund then share one Host transaction. Failure at any step retains the appropriate conservative debt for later replay. A rejected/partial/unknown physical receipt never becomes known merely because a recovery driver waits.

Pending physical work remains owned by the Host until its real physical settlement commits. Cancellation or runtime eviction cannot free it early. Accounting-only restart recovery opens the native Store without execution recovery or model calls; it does not alter settled execution state or revive late text/tools. Trusted Host policy hooks must be synchronous.

## Native authority

Admissions carry a private identity binding rather than a public source DTO. Attributed reserve requires the entered native call and matching workspace/source/model/method; copied or serialized admissions do not carry that authority. A native SQLite receiver is required for attachment.

The Store composition seam captures the actual repository destination and privately binds both Store and repository identities. Startup, drain, live settlement and Host replay all use that captured destination. Undispatched closure calls the private reconciliation implementation. The repository source configuration, Host reference and commit callback are true private fields. Replacing exposed repository methods or shadowing the old field names cannot expose the source or turn a fake return into ACK/refund. Real SQL faults still prevent projection and preserve pending receipts.

These checks cover native identity and exposed accounting capabilities. They do not make trusted policy callbacks or arbitrary in-process replacement of the entire Store object graph untrusted code. Private relative imports used by tests are not additional package exports.

## Interface and retained gates

The five low-level internal exports (`ModelUsageReceiptSpool`, `ModelUsageSource`, `readVerifiedModelUsageDelivery`, `VerifiedModelUsageDelivery`, `normalizeModelPhysicalObservation`) are replaced by the explicit `HostModelAccounting` class and `HostModelAccountingPolicy` type. The Server scoped-source adapter is removed because Runtime owns that behavior.

Internal semantic exports fall from **21 to 18**, still above the reviewed allowance of 16. Root remains **1897/1896**, and both digests remain mismatched. No budget or digest was changed. Seven preexisting architecture findings remain in the isolated snapshot; the mixed user workspace development audit has eight and is a different scope. Historical release-manifest failure remains, without regenerating it as acceptance evidence.

## Verification

The final snapshot is base `df517f56` plus the exact 25 staged paths in tree `eeeb647ef5674631d47f42b5cd69d9abb320ae71`, including one deletion. It excludes preexisting user changes and subsequent G04 periodic reconciliation work. **99 files / 788 tests** passed: Runtime 742 and Server 46, zero failures or skips. Standard built exports were used, including the real loopback/SIGKILL and duplicate-replay process cases.

Contracts/Runtime/CLI/Server compilation, Web/Harness/Benchmark types and changed/new test strict checks passed. The first strict config mixed `/tmp` input paths with canonical `/private/tmp` package resolution and produced five duplicate nominal-brand diagnostics. A follow-up using canonical paths passed with no source or emitted change; the failed log and follow-up remain separate, and behavior tests were not repeated for this verifier-only correction. The existing `agent-runtime.test.ts` 48 strict diagnostics exactly match the normalized original `d2e33ac3` baseline.

All **4,026 source hashes / 5,081 emitted hashes** remained stable, and all 28 protected user files stayed unchanged. Tests cover Host reserve rejection, source/slot rollback, Store claim failure, ACK/refund rollback, unknown/overrun debt, copied authority, native destination replacement, standalone/auxiliary/compaction/child accounting, and native main/child thinking recovery ordering. All model responses were local fixtures or loopback; zero paid/external model calls.

The [final receipt](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/host-model-accounting-boundary-regression-2026-10-30.json) and [hash index](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/host-model-accounting-boundary-evidence-index-2026-10-30.json) preserve the earlier handoff and review findings. Development v4/v5 passes do not cover the later source/configuration/commit and live/startup/drain/undispatched fixes. The v6 source-alias pack excluded three process cases; the final built run above covers them. This slice does not establish full child compiler/overflow/extension parity, concurrent parent token/cost reservations, coder recovery or real-model quality improvement. No remote push was performed.
