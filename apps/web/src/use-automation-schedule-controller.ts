import { useState } from "react";

import type { AutomationSchedule } from "@napier/contracts";

import { createSchedule, updateSchedule } from "./automation-api";
import type { AutomationOperationController } from "./use-automation-operation";

export type AutomationTriggerType = "interval" | "cron";

export interface AutomationScheduleController {
  scheduleName: string;
  setScheduleName: (value: string) => void;
  prompt: string;
  setPrompt: (value: string) => void;
  triggerType: AutomationTriggerType;
  setTriggerType: (value: AutomationTriggerType) => void;
  intervalMinutes: number;
  setIntervalMinutes: (value: number) => void;
  cronExpression: string;
  setCronExpression: (value: string) => void;
  canCreate: boolean;
  add: () => Promise<void>;
  toggle: (schedule: AutomationSchedule) => Promise<void>;
}

export interface UseAutomationScheduleControllerOptions {
  threadId: string;
  operation: AutomationOperationController;
  refresh: () => Promise<void>;
}

export function useAutomationScheduleController({
  threadId,
  operation,
  refresh,
}: UseAutomationScheduleControllerOptions): AutomationScheduleController {
  const [scheduleName, setScheduleName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [triggerType, setTriggerType] =
    useState<AutomationTriggerType>("interval");
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [cronExpression, setCronExpression] = useState("0 9 * * 1-5");
  const canCreate =
    scheduleName.trim().length > 0 &&
    prompt.trim().length > 0 &&
    (triggerType === "interval"
      ? Number.isInteger(intervalMinutes) && intervalMinutes >= 1
      : cronExpression.trim().length > 0);

  const add = async (): Promise<void> => {
    if (!canCreate || operation.busyId) return;
    const result = await operation.run("new-schedule", async () => {
      await createSchedule({
        name: scheduleName.trim(),
        threadId,
        prompt: prompt.trim(),
        trigger:
          triggerType === "interval"
            ? { type: "interval", everyMs: intervalMinutes * 60_000 }
            : {
                type: "cron",
                expression: cronExpression.trim(),
                timezone: "UTC",
              },
      });
      await refresh();
    });
    if (result.ok) {
      setScheduleName("");
      setPrompt("");
    }
  };

  const toggle = async (schedule: AutomationSchedule): Promise<void> => {
    await operation.run(schedule.id, async () => {
      await updateSchedule(schedule.id, {
        status: schedule.status === "active" ? "paused" : "active",
      });
      await refresh();
    });
  };

  return {
    scheduleName,
    setScheduleName,
    prompt,
    setPrompt,
    triggerType,
    setTriggerType,
    intervalMinutes,
    setIntervalMinutes,
    cronExpression,
    setCronExpression,
    canCreate,
    add,
    toggle,
  };
}
