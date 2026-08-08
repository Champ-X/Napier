export type DoctorCheckStatus = "passed" | "warning" | "failed" | "skipped";

export interface DoctorCheck {
  id:
    | "runtime"
    | "workspace"
    | "model"
    | "sandbox"
    | "search"
    | "fetch"
    | "browser"
    | "skills"
    | "lsp"
    | "dap"
    | "python"
    | "shell";
  status: DoctorCheckStatus;
  required: boolean;
  code: string;
  message: string;
  durationMs: number;
  evidence?: Record<string, boolean | number | string>;
}
