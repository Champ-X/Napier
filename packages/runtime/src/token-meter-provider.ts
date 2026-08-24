import type { Api, Model } from "@earendil-works/pi-ai";

import {
  RollingTokenCalibrationRegistry,
  TOKEN_CALIBRATION_RATIO_SCALE,
  type TokenCalibrationIdentity,
  type TokenCalibrationSnapshot,
  type TokenMeterContentClass,
} from "./token-meter-calibration.js";

export const TOKEN_METER_FALLBACK_PROVIDER_ID =
  "napier.conservative-heuristic" as const;
export const TOKEN_METER_FALLBACK_METHOD =
  "calibrated_utf8_bytes_plus_framing_v1" as const;

export type TokenMeterItemKind =
  | "system_prompt"
  | "tool_definition"
  | "message";

export interface TokenMeterVisualItem {
  mimeType: string;
  encodedBytes: number;
  contentSha256: string;
}

export interface TokenMeterProviderInput {
  model: Pick<Model<Api>, "api" | "id" | "provider">;
  contentClass: TokenMeterContentClass;
  itemKind: TokenMeterItemKind;
  /** Canonical text with image payloads replaced by metadata. */
  text: string;
  visualItems: readonly TokenMeterVisualItem[];
  conservativeFallbackTokens: number;
}

export interface TokenMeterProviderMeasurement {
  estimatedTokens: number;
  method: string;
}

export interface TokenMeterProvider {
  readonly id: string;
  supports(input: {
    model: Pick<Model<Api>, "api" | "id" | "provider">;
    contentClass: TokenMeterContentClass;
  }): boolean;
  measure(
    input: Readonly<TokenMeterProviderInput>,
  ): TokenMeterProviderMeasurement | Promise<TokenMeterProviderMeasurement>;
}

export interface TokenMeterBatchMeasurement {
  providerId: string;
  method: string;
  contentClass: TokenMeterContentClass;
  baseEstimatedTokens: number[];
  estimatedTokens: number[];
  calibration: TokenCalibrationSnapshot;
  fallbackApplied: boolean;
}

/** Provider selection and usage-based calibration shared by all model calls. */
export class TokenMeterRegistry {
  private readonly providers: TokenMeterProvider[] = [];

  constructor(readonly calibration = new RollingTokenCalibrationRegistry()) {}

  register(provider: TokenMeterProvider): () => void {
    assertIdentifier(provider.id, "Token meter provider ID");
    if (this.providers.some((candidate) => candidate.id === provider.id)) {
      throw new Error(
        `Token meter provider is already registered: ${provider.id}`,
      );
    }
    this.providers.unshift(provider);
    return () => {
      const index = this.providers.indexOf(provider);
      if (index >= 0) this.providers.splice(index, 1);
    };
  }

  inspect(): string[] {
    return this.providers.map((provider) => provider.id);
  }

  async measure(
    identity: TokenCalibrationIdentity,
    items: readonly TokenMeterProviderInput[],
  ): Promise<TokenMeterBatchMeasurement> {
    const fallback = items.map((item) => item.conservativeFallbackTokens);
    const provider = this.providers.find((candidate) => {
      try {
        return candidate.supports({
          model: items[0]?.model ?? {
            api: "unknown",
            id: identity.model,
            provider: identity.provider,
          },
          contentClass: identity.contentClass,
        });
      } catch {
        return false;
      }
    });
    const selected = provider
      ? await measureProviderSafely(provider, items, fallback)
      : undefined;
    const baseEstimatedTokens = selected?.tokens ?? fallback;
    const calibration = this.calibration.snapshot(identity);
    const estimatedTokens = baseEstimatedTokens.map((tokens) =>
      Math.ceil(
        (tokens * calibration.safetyFactorPpm) / TOKEN_CALIBRATION_RATIO_SCALE,
      ),
    );
    return {
      providerId: selected?.providerId ?? TOKEN_METER_FALLBACK_PROVIDER_ID,
      method: selected?.method ?? TOKEN_METER_FALLBACK_METHOD,
      contentClass: identity.contentClass,
      baseEstimatedTokens,
      estimatedTokens,
      calibration,
      fallbackApplied: !selected || selected.fallbackApplied,
    };
  }
}

async function measureProviderSafely(
  provider: TokenMeterProvider,
  items: readonly TokenMeterProviderInput[],
  fallback: readonly number[],
): Promise<
  | {
      providerId: string;
      method: string;
      tokens: number[];
      fallbackApplied: boolean;
    }
  | undefined
> {
  try {
    const measured = await Promise.all(
      items.map((item) => provider.measure(Object.freeze(item))),
    );
    if (measured.some((item) => !validMeasurement(item))) return undefined;
    const methods = new Set(measured.map((item) => item.method));
    if (methods.size !== 1) return undefined;
    const raw = measured.map((item) => item.estimatedTokens);
    const tokens = raw.map((tokens, index) =>
      Math.max(tokens, fallback[index] ?? tokens),
    );
    return {
      providerId: provider.id,
      method: measured[0]?.method ?? TOKEN_METER_FALLBACK_METHOD,
      tokens,
      fallbackApplied: tokens.some((tokens, index) => tokens > raw[index]!),
    };
  } catch {
    return undefined;
  }
}

function validMeasurement(measurement: TokenMeterProviderMeasurement): boolean {
  return (
    Number.isSafeInteger(measurement.estimatedTokens) &&
    measurement.estimatedTokens >= 0 &&
    /^[a-z][a-z0-9_.-]{2,79}$/u.test(measurement.method)
  );
}

function assertIdentifier(value: string, label: string): void {
  if (!/^[a-z][a-z0-9_.-]{2,79}$/u.test(value)) {
    throw new Error(`${label} is invalid: ${value}`);
  }
}

export type { TokenMeterContentClass } from "./token-meter-calibration.js";
