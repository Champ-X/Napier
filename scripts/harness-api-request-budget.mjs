import { createHash } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { spendingBudgetEvidenceEligible } from "./harness-spending-budget.mjs";

function validate(maxRequests, minIntervalMs) {
  if (
    !Number.isSafeInteger(maxRequests) ||
    maxRequests < 0 ||
    !Number.isSafeInteger(minIntervalMs) ||
    minIntervalMs < 0 ||
    minIntervalMs > 3_600_000
  )
    throw new Error(
      "Explicit nonnegative API request count and interval are required",
    );
}

/** A shared, durable dispatch allowance, not a provider billing estimate.
 * Reservations survive crashes and are never refunded, even on transport failure.
 * This file must be outside the Agent workspace. No request content is stored. */
export function createApiRequestBudget(file, { maxRequests, minIntervalMs }) {
  validate(maxRequests, minIntervalMs);
  closeSync(openSync(file, "wx", 0o600));
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL");
    db.exec(`CREATE TABLE budget (id INTEGER PRIMARY KEY CHECK(id=1),
      max_requests INTEGER NOT NULL, min_interval_ms INTEGER NOT NULL,
      admitted INTEGER NOT NULL, denied INTEGER NOT NULL, next_at INTEGER NOT NULL);
      CREATE TABLE admissions (seq INTEGER PRIMARY KEY, admitted_at INTEGER NOT NULL)`);
    db.prepare("INSERT INTO budget VALUES (1, ?, ?, 0, 0, 0)").run(
      maxRequests,
      minIntervalMs,
    );
  } finally {
    db.close();
  }
}

export function openApiRequestBudget(file) {
  // SQLite normally creates missing files. Missing or incomplete budgets must fail closed.
  closeSync(openSync(file, "r+"));
  const db = new DatabaseSync(file);
  db.exec("PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL");
  const read = () => db.prepare("SELECT * FROM budget WHERE id=1").get();
  let initial;
  try {
    initial = read();
    validate(initial?.max_requests, initial?.min_interval_ms);
  } catch (error) {
    db.close();
    throw error;
  }
  const checkedRead = () => {
    const r = read();
    if (
      !r ||
      r.max_requests !== initial.max_requests ||
      r.min_interval_ms !== initial.min_interval_ms ||
      !Number.isSafeInteger(r.admitted) ||
      r.admitted < 0 ||
      r.admitted > r.max_requests ||
      !Number.isSafeInteger(r.denied) ||
      r.denied < 0 ||
      !Number.isSafeInteger(r.next_at) ||
      r.next_at < 0
    )
      throw new Error("API budget state is invalid or its policy changed");
    return r;
  };
  const snapshot = () => {
    const r = checkedRead();
    validate(r?.max_requests, r?.min_interval_ms);
    const policy = {
      maxRequests: r.max_requests,
      minIntervalMs: r.min_interval_ms,
    };
    return {
      kind: "napier.harness-api-request-budget",
      schemaVersion: 1,
      ...policy,
      policySha256: createHash("sha256")
        .update(JSON.stringify(policy))
        .digest("hex"),
      admitted: r.admitted,
      denied: r.denied,
      remaining: r.max_requests - r.admitted,
      billingCeilingEstablished: false,
    };
  };
  return {
    snapshot,
    close: () => db.close(),
    async acquire(signal) {
      for (;;) {
        signal?.throwIfAborted();
        let waitMs;
        db.exec("BEGIN IMMEDIATE");
        try {
          const r = checkedRead(),
            now = Date.now();
          if (r.admitted >= r.max_requests) {
            db.exec("UPDATE budget SET denied=denied+1 WHERE id=1; COMMIT");
            return false;
          }
          waitMs = Math.max(0, r.next_at - now);
          if (waitMs === 0) {
            db.prepare(
              "UPDATE budget SET admitted=admitted+1, next_at=? WHERE id=1",
            ).run(now + r.min_interval_ms);
            db.prepare("INSERT INTO admissions VALUES (?, ?)").run(
              r.admitted + 1,
              now,
            );
          }
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        if (waitMs === 0) return true;
        await delay(Math.min(waitMs, 1000), undefined, { signal });
      }
    },
  };
}

export function apiRequestBudgetEvidenceEligible(report) {
  if (!spendingBudgetEvidenceEligible(report)) return false;
  const evidence = report.apiRequestBudget;
  if (evidence === undefined) return !(report.schemaVersion >= 7);
  try {
    const { before, after } = evidence;
    for (const r of [before, after]) {
      validate(r.maxRequests, r.minIntervalMs);
      const policy = {
        maxRequests: r.maxRequests,
        minIntervalMs: r.minIntervalMs,
      };
      if (
        r.kind !== "napier.harness-api-request-budget" ||
        r.schemaVersion !== 1 ||
        r.policySha256 !==
          createHash("sha256").update(JSON.stringify(policy)).digest("hex") ||
        !Number.isSafeInteger(r.admitted) ||
        r.admitted < 0 ||
        r.admitted > r.maxRequests ||
        !Number.isSafeInteger(r.denied) ||
        r.denied < 0 ||
        r.remaining !== r.maxRequests - r.admitted ||
        r.billingCeilingEstablished !== false
      )
        return false;
    }
    return (
      before.policySha256 === after.policySha256 &&
      after.admitted >= before.admitted &&
      after.denied === before.denied
    );
  } catch {
    return false;
  }
}

/** Install before constructing provider SDK clients: SDK and Runtime retries
 * each reach this transport boundary. Other origins retain ordinary fetch.
 * DeepSeek redirects are rejected to prevent one admission dispatching twice.
 * This is a campaign transport guard, not a sandbox for child-process networking. */
export function installDeepSeekRequestBudget(budget) {
  const original = globalThis.fetch;
  const guarded = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin !== "https://api.deepseek.com") return original(input, init);
    const signal =
      init?.signal ?? (input instanceof Request ? input.signal : undefined);
    if (!(await budget.acquire(signal))) {
      return new Response(
        JSON.stringify({
          error: {
            message:
              "Local Harness API request budget exhausted; no provider request was sent",
            type: "harness_api_budget_exhausted",
            code: "harness_api_budget_exhausted",
          },
        }),
        { status: 402, headers: { "content-type": "application/json" } },
      );
    }
    signal?.throwIfAborted();
    return original(input, { ...init, redirect: "error" });
  };
  globalThis.fetch = guarded;
  return () => {
    if (globalThis.fetch === guarded) globalThis.fetch = original;
  };
}
