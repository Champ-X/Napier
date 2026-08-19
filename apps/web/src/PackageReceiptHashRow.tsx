import "./package-receipts.css";

export interface PackageReceiptHashRowProps {
  label: string;
  value: string;
}

export function PackageReceiptHashRow({
  label,
  value,
}: PackageReceiptHashRowProps) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <code title={value}>{value.slice(0, 12)}</code>
      </dd>
    </div>
  );
}
