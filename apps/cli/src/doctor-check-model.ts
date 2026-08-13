export type DoctorCheckStatus = "passed" | "warning" | "failed" | "skipped";

export type DoctorCredentialReferenceStatus = "available" | "missing" | "error";

export interface DoctorCheck {
  id:
    | "runtime"
    | "workspace"
    | "model"
    | "sandbox"
    | "search"
    | "fetch"
    | "browser"
    | "browser_use_local"
    | "browser_use_cloud"
    | "skills"
    | "lsp"
    | "dap"
    | "python"
    | "shell"
    | "verification"
    | "service";
  status: DoctorCheckStatus;
  required: boolean;
  code: string;
  message: string;
  durationMs: number;
  evidence?: Record<string, boolean | number | string>;
}
