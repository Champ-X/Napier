# Deferred native operation reinspection

Local commit `663a5f5b45a217d954878b095024daa4f3e53e92` lets the existing RecoveryService revisit a native move whose lost-owner inspection was deferred by exact path-lock contention. A winner's later exit no longer requires another service initialization to reach a new inspection. Full G04 remains incomplete.

## Lifecycle scope

Only actual `move_target_busy` results create scheduling hints. They bind the exact Run, thread, lease generation and native effect boundary; they are not proof or execution authority. Each sweep selects at most eight due hints, with an initial one-second delay and capped exponential backoff to 30 seconds. The existing Store state queue refreshes from SQLite and retains CAS conflict retries. Each attempt independently confirms native owner PID death, checks the current binding, locks the paths and rereads the private intent/filesystem. Changed or terminal generations drop the hint.

The scoped reconciliation does not rerun broad startup cleanup: unrelated opening extensions, deliveries, runs and subagents retain their state. Proof/fence/terminal persistence remains atomic. A busy target stays unknown with no new proof or terminal; successful reconciliation may make the existing automatic recovery policy eligible, but does not itself grant replay. Negative evidence still does not authorize another move. Hints are process-local scheduling state; restart re-discovers the durable active operation and verifies it again.

## Shared path locks

The existing `.lock` pathname convention is retained. A private sibling `file-edit-locks.sqlite` serializes short synchronous metadata acquisition and dead-owner reclamation among updated cooperating processes. There is no await or protected file operation inside that transaction. SQLite busy/locked acquisition produces exact busy deferral immediately (`busy_timeout=0`), rather than synchronously waiting seconds per hint.

New owner records include PID and a random token. A valid legacy PID is still respected; only ESRCH establishes a dead owner. Malformed, empty or ownerless legacy locks no longer become reclaimable merely by age. This intentionally preserves uncertainty if a creator died before recording its owner. Metadata opens reject non-regular descriptors without blocking on a raced FIFO.

Own release checks current PID, token, device/inode and the retained descriptor identity without acquiring the metadata coordinator. Updated peers never reclaim a live PID, so none can replace that owned lock while its release is executing; process death also prevents a late unlink. This avoids the concrete release-BUSY leak found during review. Guarded creation rollback and stale reclamation remain serialized. Old binaries that do not obey this coordinator, arbitrary filesystem writers and universal no-clobber guarantees are outside this claim. Other unlink/storage failures remain best effort and can leave a conservative lock until owner exit; this is not guaranteed cleanup under every I/O failure.

## Verification and retained failures

The final isolated snapshot contains base `7e9dc49b` plus 14 staged paths in tree `e527766429ea7194ab6e2259d84b7c7b47a311d6`. **62 files / 544 tests** passed: Runtime 533 and Server 11, zero failures or skips. Coverage includes real competing process recovery, winner completion/death, owner and generation drift, repeated sweeps, exactly one proof/terminal/continuation, coordinator contention, ordinary release while the coordinator is held, repeated cross-process ownership handoffs, and shared Git/LSP/subagent/capsule/Store lock consumers.

Contracts/Runtime/CLI/Server compilation, Web/Harness/Benchmark types and strict changed tests passed. All **4,032 source / 5,087 emitted hashes** stayed stable; 28 protected user files were unchanged. The existing 48 `agent-runtime.test.ts` strict diagnostics still match original `d2e33ac3` after normalization. All model responses used local fixtures; no paid/external model calls.

The [final receipt](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/deferred-operation-reinspection-regression-2026-10-30.json) and [hash index](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/deferred-operation-reinspection-evidence-index-2026-10-30.json) retain development failures, the first 543-test passing snapshot, its later release-BUSY counterexample, the fixed counterpart, and final verification. The first passing snapshot was not accepted after that counterexample. The held-coordinator responsiveness case is a local functional regression check, not a general latency benchmark.

Seven preexisting architecture findings remain in the isolated scope, alongside root API1897/1896, internal18/16 and both digest mismatches. No budget/digest changes or historical release-manifest replacement was made. Mixed-operation/version chains, replaying a proven unexecuted move, arbitrary external effects and broader G04 classification/acceptance remain unfinished. No remote push was performed.
