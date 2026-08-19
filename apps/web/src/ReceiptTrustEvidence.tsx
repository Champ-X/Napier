export interface ReceiptTrustEvidenceProps {
  title: string;
  status?: string | undefined;
  facts?: string[] | undefined;
  value: unknown;
}

export function ReceiptTrustEvidence({
  title,
  status,
  facts = [],
  value,
}: ReceiptTrustEvidenceProps) {
  if (!value) return null;
  return (
    <details className="receipt-trust-evidence">
      <summary>
        <span>
          <strong>{title}</strong>
          {facts.length ? <small>{facts.join(" · ")}</small> : null}
        </span>
        {status ? <mark>{status}</mark> : null}
      </summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}
