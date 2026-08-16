import { sha256 } from "./ed25519.js";
import type {
  ModelThinkingLoopEvidence,
  ModelThinkingLoopReason,
} from "./model-thinking-loop-policy.js";

const MAX_BUFFER_CHARS = 24_000;
const MIN_OBSERVED_BYTES = 1_024;
const ANCHOR =
  /(?:^|[\s`"'(])(?:[A-Za-z0-9_.@-]+\/){1,}[A-Za-z0-9_.@/-]+|(?:class|const|function|interface|method|symbol|type)\s+[`"'A-Za-z_$]|https?:\/\/|line\s+\d+|[a-f0-9]{64}/iu;
const HEADING =
  /^(?:#{1,6}\s+|(?:step|phase|plan|analysis)\s+\d+[:.)-]?|(?:步骤|阶段|计划|分析)[一二三四五六七八九十\d]*[:：.)、-]?)/iu;

export class ModelThinkingLoopDetector {
  private text = "";
  private observedThinkingChunks = 0;

  observe(
    delta: string,
    attempt: 1 | 2,
  ): ModelThinkingLoopEvidence | undefined {
    if (!delta) return undefined;
    this.observedThinkingChunks += 1;
    this.text = `${this.text}${delta}`.slice(-MAX_BUFFER_CHARS);
    const observedBytes = Buffer.byteLength(this.text, "utf8");
    if (observedBytes < MIN_OBSERVED_BYTES) return undefined;
    const normalized = normalize(this.text);
    return (
      repeatedSentence(
        normalized,
        attempt,
        observedBytes,
        this.observedThinkingChunks,
      ) ??
      repeatedParagraph(
        normalized,
        attempt,
        observedBytes,
        this.observedThinkingChunks,
      ) ??
      repeatedTail(
        normalizeUnit(normalized),
        attempt,
        observedBytes,
        this.observedThinkingChunks,
      ) ??
      overplanning(
        normalized,
        attempt,
        observedBytes,
        this.observedThinkingChunks,
      ) ??
      lowNovelty(
        normalized,
        attempt,
        observedBytes,
        this.observedThinkingChunks,
      )
    );
  }
}

function repeatedSentence(
  text: string,
  attempt: 1 | 2,
  observedBytes: number,
  chunks: number,
): ModelThinkingLoopEvidence | undefined {
  const sentences = text
    .split(/(?<=[.!?。！？])\s+/u)
    .map(normalizeUnit)
    .filter((sentence) => sentence.length >= 48);
  const latest = sentences.at(-1);
  if (!latest || sentences.length < 3) return undefined;
  const repeated = sentences
    .slice(-8)
    .filter((sentence) => similarity(latest, sentence) >= 0.96);
  return repeated.length >= 3
    ? evidence("literal_repetition", latest, attempt, observedBytes, chunks)
    : undefined;
}

function repeatedParagraph(
  text: string,
  attempt: 1 | 2,
  observedBytes: number,
  chunks: number,
): ModelThinkingLoopEvidence | undefined {
  const paragraphs = text
    .split(/\n\s*\n/u)
    .map(normalizeUnit)
    .filter((paragraph) => paragraph.length >= 160);
  if (paragraphs.length < 3) return undefined;
  const latest = paragraphs.at(-1)!;
  const similar = paragraphs
    .slice(-6, -1)
    .filter((paragraph) => similarity(latest, paragraph) >= 0.72);
  return similar.length >= 2
    ? evidence("near_paragraph_cluster", latest, attempt, observedBytes, chunks)
    : undefined;
}

function repeatedTail(
  text: string,
  attempt: 1 | 2,
  observedBytes: number,
  chunks: number,
): ModelThinkingLoopEvidence | undefined {
  for (const size of [512, 384, 256, 192, 128]) {
    if (text.length < size * 3) continue;
    const latest = text.slice(-size).trim();
    if (latest.length < Math.floor(size * 0.65)) continue;
    const before = text.slice(0, -size);
    const previous = before.slice(-size).trim();
    const older = before.slice(-size * 2, -size).trim();
    if (
      similarity(latest, previous) >= 0.94 &&
      similarity(latest, older) >= 0.94
    ) {
      return evidence(
        "literal_repetition",
        latest,
        attempt,
        observedBytes,
        chunks,
      );
    }
  }
  return undefined;
}

function overplanning(
  text: string,
  attempt: 1 | 2,
  observedBytes: number,
  chunks: number,
): ModelThinkingLoopEvidence | undefined {
  if (ANCHOR.test(text)) return undefined;
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const headings = lines.filter((line) => HEADING.test(line));
  if (headings.length < 8) return undefined;
  return evidence(
    "overplanning_headings",
    headings.slice(-8).join("\n"),
    attempt,
    observedBytes,
    chunks,
  );
}

function lowNovelty(
  text: string,
  attempt: 1 | 2,
  observedBytes: number,
  chunks: number,
): ModelThinkingLoopEvidence | undefined {
  if (text.length < 4_096 || ANCHOR.test(text)) return undefined;
  const tokens = text.match(/[\p{L}\p{N}_-]{2,}/gu) ?? [];
  if (tokens.length < 240) return undefined;
  const recent = tokens.slice(-240).map((token) => token.toLowerCase());
  const novelty = new Set(recent).size / recent.length;
  return novelty <= 0.12
    ? evidence(
        "low_novelty_without_anchor",
        recent.join(" "),
        attempt,
        observedBytes,
        chunks,
      )
    : undefined;
}

function evidence(
  reason: ModelThinkingLoopReason,
  unit: string,
  attempt: 1 | 2,
  observedBytes: number,
  observedThinkingChunks: number,
): ModelThinkingLoopEvidence {
  return {
    reason,
    attempt,
    observedBytes,
    observedThinkingChunks,
    repeatedUnitBytes: Buffer.byteLength(unit, "utf8"),
    repeatedUnitSha256: sha256(unit),
  };
}

function normalize(value: string): string {
  return value.replace(/\r\n?/gu, "\n");
}

function normalizeUnit(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .replace(/[^\p{L}\p{N}_/@.:-]+/gu, " ")
    .trim();
}

function similarity(left: string, right: string): number {
  if (left === right) return 1;
  const leftSet = shingles(left);
  const rightSet = shingles(right);
  if (leftSet.size === 0 || rightSet.size === 0) return 0;
  let intersection = 0;
  for (const value of leftSet) {
    if (rightSet.has(value)) intersection += 1;
  }
  return intersection / (leftSet.size + rightSet.size - intersection);
}

function shingles(value: string): Set<string> {
  const words = value.split(" ").filter(Boolean);
  const result = new Set<string>();
  for (let index = 0; index + 2 < words.length; index += 1) {
    result.add(words.slice(index, index + 3).join(" "));
  }
  return result;
}
