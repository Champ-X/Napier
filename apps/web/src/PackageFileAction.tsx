import type { ReactNode } from "react";

import "./package-management.css";

export interface PackageFileActionProps {
  accept: string;
  disabled: boolean;
  icon: ReactNode;
  label: string;
  onFile: (file: File) => void;
}

export function PackageFileAction({
  accept,
  disabled,
  icon,
  label,
  onFile,
}: PackageFileActionProps) {
  return (
    <label
      className="package-file-action"
      aria-disabled={disabled ? "true" : "false"}
    >
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) onFile(file);
        }}
      />
      {icon}
      {label}
    </label>
  );
}
