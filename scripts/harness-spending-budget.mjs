import { closeSync, openSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

// Official Flash peak CNY prices, 2026-09-14. Treat all prompt tokens as cache
// misses; never use the SDK's older USD catalog for an admission decision.
export const FLASH_SPENDING_POLICY = Object.freeze({
  modelAliases: ["deepseek-flash", "deepseek-v4-flash"],
  inputFenPerMillion: 200,
  outputFenPerMillion: 800,
  maxInputTokens: 1_000_000,
  maxOutputTokens: 384_000,
  reservationFen: 600,
  source: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing",
  checkedOn: "2026-09-14",
});

// Same peak tariff and maximum reservation. Discount only a complete provider
// cache split; this is never inferred from local prefix similarity or SDK USD cost.
export const FLASH_CACHE_SPENDING_POLICY = Object.freeze({
  ...FLASH_SPENDING_POLICY,
  cacheHitFenPerMillion: 4,
  settlement: "provider-cache-split-v1",
});

function knownPolicy(policy) {
  return [FLASH_SPENDING_POLICY, FLASH_CACHE_SPENDING_POLICY].some(
    (known) => JSON.stringify(known) === JSON.stringify(policy),
  );
}

/** Accounting precision can change between pairs; the underlying peak tariff
 * remains fixed. Exact accounting policies must still match inside each pair. */
export function spendingTariffIdentity(policy) {
  return knownPolicy(policy) ? FLASH_SPENDING_POLICY : policy;
}

export function spendingCharge(usage, policy = FLASH_SPENDING_POLICY) {
  if (!knownPolicy(policy)) throw new Error("Unknown spending policy");
  const { prompt_tokens: input, completion_tokens: output } = usage ?? {};
  if (
    !Number.isSafeInteger(input) ||
    input <= 0 ||
    input > policy.maxInputTokens ||
    !Number.isSafeInteger(output) ||
    output < 0 ||
    output > policy.maxOutputTokens
  )
    return undefined;
  const hit = usage.prompt_cache_hit_tokens,
    miss = usage.prompt_cache_miss_tokens;
  const cacheSplit =
    policy.settlement === "provider-cache-split-v1" &&
    Number.isSafeInteger(hit) &&
    hit >= 0 &&
    Number.isSafeInteger(miss) &&
    miss >= 0 &&
    hit + miss === input;
  const fen = Math.ceil(
    ((cacheSplit ? miss : input) * policy.inputFenPerMillion +
      (cacheSplit ? hit * policy.cacheHitFenPerMillion : 0) +
      output * policy.outputFenPerMillion) /
      1_000_000,
  );
  return fen <= policy.reservationFen
    ? {
        fen,
        input,
        output,
        cacheHitTokens: cacheSplit ? hit : null,
        cacheMissTokens: cacheSplit ? miss : null,
        accountingMode: cacheSplit
          ? "provider_cache_split"
          : "all_cache_miss_upper_bound",
      }
    : undefined;
}

export function createSpendingBudget(
  file,
  { maxFen, priorSpendFen = 0, cacheAware = false },
) {
  if (
    ![maxFen, priorSpendFen].every(Number.isSafeInteger) ||
    maxFen < 1 ||
    priorSpendFen < 0 ||
    priorSpendFen > maxFen ||
    typeof cacheAware !== "boolean"
  )
    throw new Error("Invalid spending allowance in CNY fen");
  closeSync(openSync(file, "wx", 0o600));
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL");
    db.exec(`CREATE TABLE budget(id INTEGER PRIMARY KEY CHECK(id=1), max_fen INTEGER NOT NULL, prior_fen INTEGER NOT NULL, policy TEXT NOT NULL, denied INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE requests(id INTEGER PRIMARY KEY, charged_fen INTEGER NOT NULL, status TEXT NOT NULL, prompt_tokens INTEGER, completion_tokens INTEGER, cache_hit_tokens INTEGER, cache_miss_tokens INTEGER, accounting_mode TEXT)`);
    db.prepare(
      "INSERT INTO budget(id,max_fen,prior_fen,policy) VALUES(1,?,?,?)",
    ).run(
      maxFen,
      priorSpendFen,
      JSON.stringify(
        cacheAware ? FLASH_CACHE_SPENDING_POLICY : FLASH_SPENDING_POLICY,
      ),
    );
  } finally {
    db.close();
  }
}

export function openSpendingBudget(file) {
  closeSync(openSync(file, "r+"));
  const db = new DatabaseSync(file);
  db.exec("PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL");
  const read = () => db.prepare("SELECT * FROM budget WHERE id=1").get();
  const initial = read();
  let policy;
  try {
    policy = JSON.parse(initial?.policy);
  } catch {
    /* rejected below */
  }
  if (!initial || !knownPolicy(policy)) {
    db.close();
    throw new Error("Unknown spending policy");
  }
  Object.freeze(policy.modelAliases);
  Object.freeze(policy);
  if (policy.settlement === "provider-cache-split-v1") {
    const columns = db
      .prepare("PRAGMA table_info(requests)")
      .all()
      .map((row) => row.name);
    if (
      !["cache_hit_tokens", "cache_miss_tokens", "accounting_mode"].every(
        (name) => columns.includes(name),
      )
    ) {
      db.close();
      throw new Error(
        "Cache accounting schema is missing; migrate only after active callers stop",
      );
    }
  }
  const snapshot = () => {
    const row = read();
    if (
      row.max_fen !== initial.max_fen ||
      row.prior_fen !== initial.prior_fen ||
      row.policy !== initial.policy
    )
      throw new Error("Spending policy changed");
    const sum = db
      .prepare(
        "SELECT coalesce(sum(charged_fen),0) AS amount, count(*) AS requests, coalesce(sum(status='reserved'),0) AS reserved FROM requests",
      )
      .get();
    const committedFen = row.prior_fen + sum.amount;
    if (
      !Number.isSafeInteger(committedFen) ||
      committedFen > row.max_fen ||
      committedFen < 0
    )
      throw new Error("Invalid spending ledger");
    return {
      kind: "napier.harness-spending-budget",
      schemaVersion: 1,
      currency: "CNY",
      maxFen: row.max_fen,
      priorSpendFen: row.prior_fen,
      committedFen,
      remainingFen: row.max_fen - committedFen,
      requests: sum.requests,
      reservedRequests: sum.reserved,
      denied: row.denied,
      policy: structuredClone(policy),
    };
  };
  return {
    snapshot,
    close: () => db.close(),
    reserve() {
      db.exec("BEGIN IMMEDIATE");
      try {
        const state = snapshot();
        if (state.remainingFen < FLASH_SPENDING_POLICY.reservationFen) {
          db.exec("UPDATE budget SET denied=denied+1 WHERE id=1; COMMIT");
          return undefined;
        }
        const result = db
          .prepare(
            "INSERT INTO requests(charged_fen,status) VALUES(?,'reserved')",
          )
          .run(FLASH_SPENDING_POLICY.reservationFen);
        db.exec("COMMIT");
        return Number(result.lastInsertRowid);
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    settle(id, usage) {
      const charge = spendingCharge(usage, policy);
      if (!charge) return false; // Incomplete usage retains the entire reserve.
      const { fen, input, output } = charge;
      if (policy.settlement === "provider-cache-split-v1")
        return (
          db
            .prepare(
              "UPDATE requests SET charged_fen=?,status='settled',prompt_tokens=?,completion_tokens=?,cache_hit_tokens=?,cache_miss_tokens=?,accounting_mode=? WHERE id=? AND status='reserved'",
            )
            .run(
              fen,
              input,
              output,
              charge.cacheHitTokens,
              charge.cacheMissTokens,
              charge.accountingMode,
              id,
            ).changes === 1
        );
      return (
        db
          .prepare(
            "UPDATE requests SET charged_fen=?,status='settled',prompt_tokens=?,completion_tokens=? WHERE id=? AND status='reserved'",
          )
          .run(fen, input, output, id).changes === 1
      );
    },
  };
}

/** Explicit settled-boundary migration. Caller must first stop all dispatchers.
 * Preserve every historical request/charge, ceiling and prior spending. */
export function upgradeSpendingBudgetCacheAccounting(file, expectedSnapshot) {
  closeSync(openSync(file, "r+"));
  const db = new DatabaseSync(file);
  db.exec("PRAGMA busy_timeout=5000; BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT * FROM budget WHERE id=1").get();
    const sum = db
      .prepare(
        "SELECT coalesce(sum(charged_fen),0) AS fen,count(*) AS requests,coalesce(sum(status!='settled'),0) AS unresolved FROM requests",
      )
      .get();
    if (
      row.policy !== JSON.stringify(FLASH_SPENDING_POLICY) ||
      JSON.stringify(expectedSnapshot.policy) !== row.policy ||
      row.max_fen !== expectedSnapshot.maxFen ||
      row.prior_fen !== expectedSnapshot.priorSpendFen ||
      row.denied !== expectedSnapshot.denied ||
      sum.requests !== expectedSnapshot.requests ||
      sum.fen + row.prior_fen !== expectedSnapshot.committedFen ||
      sum.unresolved !== 0 ||
      expectedSnapshot.reservedRequests !== 0 ||
      expectedSnapshot.remainingFen !== row.max_fen - row.prior_fen - sum.fen
    )
      throw new Error(
        "Spending boundary changed, unsettled, or already migrated",
      );
    const columns = db
      .prepare("PRAGMA table_info(requests)")
      .all()
      .map((column) => column.name);
    for (const [name, type] of [
      ["cache_hit_tokens", "INTEGER"],
      ["cache_miss_tokens", "INTEGER"],
      ["accounting_mode", "TEXT"],
    ])
      if (!columns.includes(name))
        db.exec(`ALTER TABLE requests ADD COLUMN ${name} ${type}`);
    db.exec(
      "CREATE TABLE IF NOT EXISTS accounting_policy_changes(id INTEGER PRIMARY KEY,created_at TEXT NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,committed_fen INTEGER NOT NULL,requests INTEGER NOT NULL)",
    );
    const after = { ...expectedSnapshot, policy: FLASH_CACHE_SPENDING_POLICY };
    const inserted = db
      .prepare(
        "INSERT INTO accounting_policy_changes(created_at,before_json,after_json,committed_fen,requests) VALUES(?,?,?,?,?)",
      )
      .run(
        new Date().toISOString(),
        row.policy,
        JSON.stringify(FLASH_CACHE_SPENDING_POLICY),
        expectedSnapshot.committedFen,
        sum.requests,
      );
    db.prepare("UPDATE budget SET policy=? WHERE id=1").run(
      JSON.stringify(FLASH_CACHE_SPENDING_POLICY),
    );
    db.exec("COMMIT");
    return {
      authorizationId: Number(inserted.lastInsertRowid),
      before: expectedSnapshot,
      after,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

export function spendingBudgetEvidenceEligible(report) {
  if (report.spendingBudget === undefined) return !(report.schemaVersion >= 8);
  try {
    const { before, after } = report.spendingBudget;
    for (const state of [before, after]) {
      if (
        state.kind !== "napier.harness-spending-budget" ||
        state.schemaVersion !== 1 ||
        state.currency !== "CNY" ||
        !knownPolicy(state.policy)
      )
        return false;
      for (const field of [
        "maxFen",
        "priorSpendFen",
        "committedFen",
        "remainingFen",
        "requests",
        "reservedRequests",
        "denied",
      ])
        if (!Number.isSafeInteger(state[field]) || state[field] < 0)
          return false;
      if (
        state.maxFen < 1 ||
        state.committedFen < state.priorSpendFen ||
        state.remainingFen !== state.maxFen - state.committedFen ||
        state.reservedRequests > state.requests
      )
        return false;
    }
    return (
      before.maxFen === after.maxFen &&
      JSON.stringify(before.policy) === JSON.stringify(after.policy) &&
      before.priorSpendFen === after.priorSpendFen &&
      after.requests > before.requests &&
      after.denied === before.denied &&
      after.reservedRequests === before.reservedRequests &&
      after.committedFen >= before.committedFen
    );
  } catch {
    return false;
  }
}
