export const MAX_TRUSTED_RECEIPT_FILE_BYTES = 10 * 1024 * 1024 + 64 * 1024;
export const MAX_RECEIPT_TRUST_DIRECTORY_FILE_BYTES = 2 * 1024 * 1024;

export function formatDirectoryAge(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

export function downloadReceiptTrustJson(
  value: unknown,
  filename: string,
): void {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(value, null, 2)}\n`], {
      type: "application/json",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function readReceiptTrustJson(file: File): Promise<unknown> {
  return JSON.parse(await file.text()) as unknown;
}
