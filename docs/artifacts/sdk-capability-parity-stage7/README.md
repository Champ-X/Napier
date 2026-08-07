# SDK capability parity — Stage 7 evidence

This directory proves the bounded addition of a stateless, GET-only
`@napier/sdk/management` client for the existing effective-Agent capability
projection. It does not add SDK mutation, setup, doctor, sandbox, skill-loading,
deployment, or live-model behavior. This slice does not complete overall M0, and
M1–M5 remain out of scope.

The receipts are sanitized and offline. No raw Store contents, response bodies,
absolute temporary paths, child output, generated secret, credential value, or
environment value is retained.

- `four-state-parity.json`: built CLI, real HTTP route, and built SDK equality for
  stale, current, custom-unmanaged, and broken projections, including before/after
  Store and event-manifest digests.
- `production-server-trace.json`: a bounded loopback trace through the actual built
  server entry and the external SDK example using global `fetch`.
- `evidence.json`: causally observed formal-command exits, current source/built-entry
  hashes, artifact links, cleanup receipts, and the frozen acceptance contract.

Capture after building Contracts, Runtime, CLI, SDK, and Server:

```sh
node scripts/capture-sdk-capability-parity.mjs --output-dir docs/artifacts/sdk-capability-parity-stage7
```

Capture executes these formal commands and records their bounded output digests:

```sh
npm exec -- vitest run scripts/agent-capability-projection-equality.test.mjs
npm exec -- vitest run scripts/sdk-capability-production-server.test.mjs
node --import tsx scripts/run-credential-reference-canary.ts
```

Verify exact schemas, links, current identities, and sanitized content without
starting a server or changing artifacts:

```sh
node scripts/capture-sdk-capability-parity.mjs --output-dir docs/artifacts/sdk-capability-parity-stage7 --verify
```

The implementation is additive and has no persistent schema migration. After the
single reviewed topic commit exists, rollback is `git revert <topic-commit>`.
Before that commit, discard only task-owned files; never reset or clean protected
user files.
