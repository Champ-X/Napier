export interface PlanArtifactLedgerEventReceipt {
  ledgerEventId: string;
  ledgerEventSeq: number;
  ledgerEventSha256: string;
}

export function ledgerEventReceiptFromHeaders(
  response: Response,
  path: string,
): PlanArtifactLedgerEventReceipt {
  const ledgerEventId = response.headers.get("X-Napier-Ledger-Event-Id");
  const ledgerEventSeq = Number(
    response.headers.get("X-Napier-Ledger-Event-Seq") ?? Number.NaN,
  );
  const ledgerEventSha256 = response.headers.get(
    "X-Napier-Ledger-Event-SHA256",
  );
  if (
    !ledgerEventId ||
    !/^event_[a-z0-9]+$/u.test(ledgerEventId) ||
    !Number.isSafeInteger(ledgerEventSeq) ||
    ledgerEventSeq <= 0 ||
    !ledgerEventSha256 ||
    !/^[a-f0-9]{64}$/u.test(ledgerEventSha256)
  ) {
    throw new Error(`Response ledger receipt invalid for ${path}`);
  }
  return { ledgerEventId, ledgerEventSeq, ledgerEventSha256 };
}

export async function sha256ArrayBuffer(value: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
