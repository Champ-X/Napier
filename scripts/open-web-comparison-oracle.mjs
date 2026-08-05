import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";

const MAX_FINAL_OUTPUT_BYTES = 32 * 1024;
const FACT_KEYS = ["answer", "id", "quote", "sourceUrl"];

export function evaluateOpenWebComparisonOutcome(input) {
  const diagnostics = [];
  const text =
    typeof input.finalText === "string" ? input.finalText.trim() : "";
  const outputBytes = Buffer.byteLength(text, "utf8");
  let parsed;
  if (!text || outputBytes > MAX_FINAL_OUTPUT_BYTES) {
    diagnostics.push(text ? "final_output_oversized" : "final_output_missing");
  } else {
    try {
      parsed = JSON.parse(text);
    } catch {
      diagnostics.push("final_output_not_json");
    }
  }
  const facts = validFacts(parsed) ? parsed.facts : [];
  if (parsed !== undefined && !validFacts(parsed)) {
    diagnostics.push("final_output_shape_invalid");
  }
  const expected = input.benchmarkCase.expectedFacts;
  if (facts.length !== expected.length) {
    diagnostics.push("fact_count_mismatch");
  }
  const expectedIds = expected.map((fact) => fact.id);
  const actualIds = facts.map((fact) => fact.id);
  if (canonicalJson(actualIds) !== canonicalJson(expectedIds)) {
    diagnostics.push("fact_id_mismatch");
  }
  const answerMatch =
    facts.length === expected.length &&
    facts.every(
      (fact, index) =>
        normalizeAnswer(fact.answer) ===
        normalizeAnswer(expected[index].answer),
    );
  if (!answerMatch) diagnostics.push("answer_mismatch");
  const sourceMatch =
    facts.length === expected.length &&
    facts.every(
      (fact, index) =>
        normalizePublicUrl(fact.sourceUrl) ===
        normalizePublicUrl(expected[index].sourceUrl),
    );
  if (!sourceMatch) diagnostics.push("source_url_mismatch");
  const quoteMatch =
    facts.length === expected.length &&
    facts.every((fact, index) => quoteSupportsFact(fact, expected[index]));
  if (!quoteMatch) diagnostics.push("quote_mismatch");
  for (const family of ["search", "fetch", "browser"]) {
    const minimum = input.benchmarkCase.requiredToolCounts[family];
    if (input.toolCounts[family] < minimum) {
      diagnostics.push(`tool_${family}_missing`);
    }
  }
  const evidence = {
    finalOutputSha256: sha256(text),
    finalOutputBytes: outputBytes,
    factCount: facts.length,
    factSetSha256: sha256(
      canonicalJson(
        facts.map((fact) => ({
          idSha256: sha256(fact.id),
          answerSha256: sha256(normalizeAnswer(fact.answer)),
          sourceUrlSha256: sha256(normalizePublicUrl(fact.sourceUrl)),
          quoteSha256: sha256(normalizeQuote(fact.quote)),
        })),
      ),
    ),
    answerSetSha256: sha256(
      canonicalJson(facts.map((fact) => sha256(normalizeAnswer(fact.answer)))),
    ),
    sourceUrlSetSha256: sha256(
      canonicalJson(
        facts.map((fact) => sha256(normalizePublicUrl(fact.sourceUrl))),
      ),
    ),
    quoteSetSha256: sha256(
      canonicalJson(facts.map((fact) => sha256(normalizeQuote(fact.quote)))),
    ),
  };
  return {
    passed: diagnostics.length === 0,
    diagnostics,
    evidence,
  };
}

function quoteSupportsFact(actual, expected) {
  const quote = normalizeQuote(actual.quote);
  const answer = normalizeAnswer(expected.answer);
  if (!quote || !quote.includes(answer)) return false;
  return expected.acceptedQuotes
    .map(normalizeQuote)
    .some(
      (accepted) =>
        quote === accepted ||
        (quote.length >= 6 && accepted.includes(quote)) ||
        quote.includes(accepted),
    );
}

export function expectedOpenWebComparisonEvidence(benchmarkCase) {
  return {
    factCount: benchmarkCase.expectedFacts.length,
    factSetSha256: sha256(
      canonicalJson(
        benchmarkCase.expectedFacts.map((fact) => ({
          idSha256: sha256(fact.id),
          answerSha256: sha256(normalizeAnswer(fact.answer)),
          sourceUrlSha256: sha256(normalizePublicUrl(fact.sourceUrl)),
          acceptedQuoteSetSha256: sha256(
            canonicalJson(
              fact.acceptedQuotes.map((quote) => sha256(normalizeQuote(quote))),
            ),
          ),
        })),
      ),
    ),
  };
}

function validFacts(value) {
  return (
    record(value) &&
    exactKeys(value, ["facts"]) &&
    Array.isArray(value.facts) &&
    value.facts.length >= 1 &&
    value.facts.length <= 4 &&
    value.facts.every(
      (fact) =>
        record(fact) &&
        exactKeys(fact, FACT_KEYS) &&
        safeText(fact.id, 1, 80) &&
        /^[a-z][a-z0-9_]{2,79}$/u.test(fact.id) &&
        safeText(fact.answer, 1, 2_000) &&
        safeText(fact.sourceUrl, 1, 4_096) &&
        normalizePublicUrl(fact.sourceUrl) !== "" &&
        safeText(fact.quote, 1, 4_000),
    )
  );
}

function normalizeAnswer(value) {
  return normalizeText(value)
    .replace(/^[“”"'‘’]+|[“”"'‘’]+$/gu, "")
    .trim();
}

function normalizeQuote(value) {
  return normalizeText(value)
    .replace(/^["“]|["”]$/gu, "")
    .trim();
}

function normalizeText(value) {
  return String(value).normalize("NFC").replace(/\s+/gu, " ").trim();
}

function normalizePublicUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" || url.username || url.password || url.hash) {
      return "";
    }
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return "";
  }
}

function safeText(value, minimum, maximum) {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value)
  );
}

function exactKeys(value, keys) {
  return (
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort())
  );
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
