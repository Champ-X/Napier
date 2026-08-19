import { Upload } from "lucide-react";

export interface ReceiptTrustFileActionProps {
  label: string;
  disabled: boolean;
  onFile: (file: File | undefined) => void;
}

export function ReceiptTrustFileAction({
  label,
  disabled,
  onFile,
}: ReceiptTrustFileActionProps) {
  return (
    <label className="receipt-trust-file-action" aria-disabled={disabled}>
      <Upload size={15} aria-hidden="true" />
      <span>{label}</span>
      <input
        type="file"
        accept="application/json,.json"
        disabled={disabled}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          onFile(file);
        }}
      />
    </label>
  );
}
