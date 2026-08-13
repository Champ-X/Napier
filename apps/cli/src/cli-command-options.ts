import {
  CAPABILITY_FLAG_OPTIONS,
  CAPABILITY_VALUE_OPTIONS,
} from "./cli-capability-options.js";
import { CHAT_VALUE_OPTIONS } from "./cli-chat-options.js";
import { BROWSER_TASK_VALUE_OPTIONS } from "./cli-browser-task-options.js";
import {
  DOCTOR_FLAG_OPTIONS,
  DOCTOR_VALUE_OPTIONS,
} from "./cli-doctor-options.js";
import { RUN_VALUE_OPTIONS } from "./cli-run-options.js";
import {
  SETUP_FLAG_OPTIONS,
  SETUP_VALUE_OPTIONS,
} from "./cli-setup-options.js";
import {
  WORKFLOW_FLAG_OPTIONS,
  WORKFLOW_VALUE_OPTIONS,
} from "./cli-workflow-options.js";

const COMMANDS = new Set([
  "run",
  "browser-task",
  "chat",
  "tui",
  "capabilities",
  "doctor",
  "setup",
  "resume",
  "branch",
  "experiment",
  "model-experiment",
  "tool-experiment",
  "rpc",
  "workflow",
]);

export function knownCliCommand(command: string): boolean {
  return COMMANDS.has(command);
}

export function commandValueOptions(
  command: string,
  domains: {
    resume: ReadonlySet<string>;
    branch: ReadonlySet<string>;
    experiment: ReadonlySet<string>;
    modelExperiment: ReadonlySet<string>;
    toolExperiment: ReadonlySet<string>;
    rpc: ReadonlySet<string>;
  },
): ReadonlySet<string> {
  if (command === "run") return RUN_VALUE_OPTIONS;
  if (command === "browser-task") return BROWSER_TASK_VALUE_OPTIONS;
  if (command === "capabilities") return CAPABILITY_VALUE_OPTIONS;
  if (command === "doctor") return DOCTOR_VALUE_OPTIONS;
  if (command === "setup") return SETUP_VALUE_OPTIONS;
  if (command === "chat" || command === "tui") return CHAT_VALUE_OPTIONS;
  if (command === "resume") return domains.resume;
  if (command === "branch") return domains.branch;
  if (command === "experiment") return domains.experiment;
  if (command === "model-experiment") return domains.modelExperiment;
  if (command === "tool-experiment") return domains.toolExperiment;
  if (command === "rpc") return domains.rpc;
  return WORKFLOW_VALUE_OPTIONS;
}

export function commandFlagOptions(
  command: string,
  domains: {
    experiment: ReadonlySet<string>;
    modelExperiment: ReadonlySet<string>;
    toolExperiment: ReadonlySet<string>;
  },
): ReadonlySet<string> {
  if (command === "doctor") return DOCTOR_FLAG_OPTIONS;
  if (command === "capabilities") return CAPABILITY_FLAG_OPTIONS;
  if (command === "setup") return SETUP_FLAG_OPTIONS;
  if (command === "workflow") return WORKFLOW_FLAG_OPTIONS;
  if (command === "experiment") return domains.experiment;
  if (command === "model-experiment") return domains.modelExperiment;
  if (command === "tool-experiment") return domains.toolExperiment;
  return new Set();
}
