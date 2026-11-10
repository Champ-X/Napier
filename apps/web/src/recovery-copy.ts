import { deepMergeCopy, getLocale, type LocaleOverride } from "./locale";

/** Only the failure-reason disclosure remains on the live Recovery chrome. */
export const recoveryCopyEn = {
  failureReason: "Why this run stopped",
};

export const recoveryCopyZh: LocaleOverride<typeof recoveryCopyEn> = {
  failureReason: "查看停止原因",
};

export const recoveryCopy = deepMergeCopy(
  recoveryCopyEn,
  getLocale() === "zh" ? recoveryCopyZh : {},
);
