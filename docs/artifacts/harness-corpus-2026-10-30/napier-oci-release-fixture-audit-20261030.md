# OCI release-fixture setup failure investigation — 2026-10-30

All 50 failed assertions in `/tmp/napier-harness-corpus-frozen-tests-20261030.json` fail inside `createFixture` while collecting S1 readiness, before their intended assertions. The common error is `OCI crash recovery failed: OCI crash recovery artifact shape is invalid`.

The cause is a stale implementation hash binding. `validateOciCrashRecoveryArtifact` includes exact equality of the retained artifact implementation map and current implementation map in its generic shape predicate. The release fixture copies the historical stage11 artifact and current source, but previously did not rebind this artifact before collecting S1 readiness.

Four recorded fields disagree with both HEAD and current worktree source: guardianContractSha256, guardianWorkerSha256, launchPolicySha256, and ociAdapterSha256. The receipt, validator, affected source files, readiness collector, and original test file were byte-identical to HEAD 31e9edb96c022358008c1e3877697af0c2341980 at investigation start. The first three recorded hashes match source before 6ea6638e; the OCI adapter recorded hash is older still.

The narrow baseline failure is demonstrated: isolated unchanged HEAD validator logic, using copied HEAD TypeScript hash/policy helpers instead of shared dist, rejects the HEAD retained artifact with the same shape error. The artifact validates against its retained implementation map. A diagnostic implementation rebind plus canonical rehash validates against HEAD. This is a pure validator reproduction, not a full HEAD test-suite run or a live OCI acceptance claim.

Authorized correction: only `scripts/check-release-artifacts.test.mjs` was changed, adding the OCI implementation import, a fixture-only rebind helper using the existing canonical serializer/hash pattern, and its call before S1 readiness setup. Historical artifacts and production validation were not changed. The new helper itself was extracted and executed against the isolated fixture; validation returned no errors. Syntax and diff-whitespace checks pass. Parent now owns this test file and will rerun/adapt the remaining suite.

Evidence:
- `/tmp/napier-oci-fixture-head-proof-20261030.json` records exact HEAD/current/artifact hashes, mismatches, and validator outputs.
- `/tmp/napier-oci-fixture-head-proof-20261030.mjs` reproduces the isolated HEAD check.
- `/tmp/napier-oci-fixture-rebind-check-20261030.json` and `.mjs` execute the actual new helper in the isolated fixture.

No builds, runtime tests, model calls, or shared-dist reads/writes were used during this investigation. The only workspace write was the authorized 14-line test-fixture correction.
