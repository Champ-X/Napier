import type { CliCapabilityOptions } from "./cli-capability-options.js";
import type { CliDoctorOptions } from "./cli-doctor-options.js";
import type { CliSetupOptions } from "./cli-setup-options.js";

export type CliFirstUseAction =
  | { kind: "doctor"; options: CliDoctorOptions }
  | { kind: "capabilities"; options: CliCapabilityOptions }
  | { kind: "setup"; options: CliSetupOptions };
