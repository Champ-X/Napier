export const TOKEN_CALIBRATION_RATIO_SCALE = 1_000_000 as const;
export const TOKEN_CALIBRATION_MAX_SAMPLES = 128 as const;

export type TokenMeterContentClass = "text" | "structured" | "multimodal";

export interface TokenCalibrationIdentity {
  provider: string;
  model: string;
  contentClass: TokenMeterContentClass;
}

export interface TokenCalibrationSnapshot extends TokenCalibrationIdentity {
  sampleCount: number;
  safetyFactorPpm: number;
  p95UnderestimateRatio: number;
}

export interface TokenCalibrationObservation extends TokenCalibrationIdentity {
  baseEstimatedInputTokens: number;
  estimatedInputTokens: number;
  actualInputTokens: number;
}

interface StoredCalibrationSample {
  safetyFactorPpm: number;
  underestimateRatio: number;
}

/**
 * Bounded, provider/model/content-class calibration. It can only raise an
 * estimate: a provider observation never weakens the conservative fallback.
 */
export class RollingTokenCalibrationRegistry {
  private readonly samples = new Map<string, StoredCalibrationSample[]>();

  constructor(readonly maxSamples = TOKEN_CALIBRATION_MAX_SAMPLES) {
    if (!Number.isSafeInteger(maxSamples) || maxSamples < 1) {
      throw new Error("Token calibration sample limit must be positive");
    }
  }

  snapshot(identity: TokenCalibrationIdentity): TokenCalibrationSnapshot {
    const samples = this.samples.get(calibrationKey(identity)) ?? [];
    return {
      ...identity,
      sampleCount: samples.length,
      safetyFactorPpm: Math.max(
        TOKEN_CALIBRATION_RATIO_SCALE,
        percentile95(samples.map((sample) => sample.safetyFactorPpm)),
      ),
      p95UnderestimateRatio: percentile95(
        samples.map((sample) => sample.underestimateRatio),
      ),
    };
  }

  observe(observation: TokenCalibrationObservation): TokenCalibrationSnapshot {
    assertPositiveTokenCount(
      observation.baseEstimatedInputTokens,
      "base estimate",
    );
    assertPositiveTokenCount(
      observation.estimatedInputTokens,
      "effective estimate",
    );
    assertPositiveTokenCount(observation.actualInputTokens, "actual input");
    const safetyFactorPpm = Math.max(
      TOKEN_CALIBRATION_RATIO_SCALE,
      Math.ceil(
        (observation.actualInputTokens * TOKEN_CALIBRATION_RATIO_SCALE) /
          observation.baseEstimatedInputTokens,
      ),
    );
    const underestimateRatio = roundRatio(
      Math.max(
        0,
        (observation.actualInputTokens - observation.estimatedInputTokens) /
          observation.actualInputTokens,
      ),
    );
    const key = calibrationKey(observation);
    const samples = this.samples.get(key) ?? [];
    samples.push({ safetyFactorPpm, underestimateRatio });
    if (samples.length > this.maxSamples) {
      samples.splice(0, samples.length - this.maxSamples);
    }
    this.samples.set(key, samples);
    return this.snapshot(observation);
  }
}

function calibrationKey(identity: TokenCalibrationIdentity): string {
  return [
    identity.provider.trim().toLowerCase(),
    identity.model.trim().toLowerCase(),
    identity.contentClass,
  ].join("\u0000");
}

function percentile95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)]!;
}

function assertPositiveTokenCount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Token calibration ${label} must be a positive integer`);
  }
}

function roundRatio(value: number): number {
  return (
    Math.round(value * TOKEN_CALIBRATION_RATIO_SCALE) /
    TOKEN_CALIBRATION_RATIO_SCALE
  );
}
