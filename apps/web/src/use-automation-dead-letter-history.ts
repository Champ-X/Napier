import { useCallback, useState } from "react";

import type {
  InboundChannel,
  InboundDeadLetterRetryHistory,
  InboundDeadLetterRetryHistoryVerification,
} from "@napier/contracts";

import {
  downloadDeadLetterHistory,
  verifyDeadLetterHistory,
  verifyDeadLetterHistoryFile,
} from "./automation-dead-letter-history-actions";
import type { AutomationOperationController } from "./use-automation-operation";
import { useDeadLetterHistoryPreload } from "./use-dead-letter-history-preload";

export interface AutomationDeadLetterHistoryController {
  histories: Record<string, InboundDeadLetterRetryHistory>;
  verifications: Record<string, InboundDeadLetterRetryHistoryVerification>;
  setHistory: (
    channelId: string,
    history: InboundDeadLetterRetryHistory,
  ) => void;
  clearVerification: (channelId: string) => void;
  verify: (channelId: string) => Promise<void>;
  download: (channelId: string) => Promise<void>;
  verifyFile: (channelId: string, file: File) => Promise<void>;
}

export interface UseAutomationDeadLetterHistoryOptions {
  channels: InboundChannel[];
  operation: AutomationOperationController;
}

export function useAutomationDeadLetterHistory({
  channels,
  operation,
}: UseAutomationDeadLetterHistoryOptions): AutomationDeadLetterHistoryController {
  const [histories, setHistories] = useState<
    Record<string, InboundDeadLetterRetryHistory>
  >({});
  const [verifications, setVerifications] = useState<
    Record<string, InboundDeadLetterRetryHistoryVerification>
  >({});
  const setHistory = useCallback(
    (channelId: string, history: InboundDeadLetterRetryHistory) => {
      setHistories((current) => ({ ...current, [channelId]: history }));
    },
    [],
  );
  const clearVerification = useCallback((channelId: string): void => {
    setVerifications((current) => omitChannel(current, channelId));
  }, []);
  const context = {
    operation,
    histories,
    onHistory: setHistory,
    onVerification: (
      channelId: string,
      value: InboundDeadLetterRetryHistoryVerification,
    ) => setVerifications((current) => ({ ...current, [channelId]: value })),
    onVerificationCleared: clearVerification,
  };
  useDeadLetterHistoryPreload(channels, setHistory);
  return {
    histories,
    verifications,
    setHistory,
    clearVerification,
    verify: (channelId) => verifyDeadLetterHistory(context, channelId),
    download: (channelId) => downloadDeadLetterHistory(context, channelId),
    verifyFile: (channelId, file) =>
      verifyDeadLetterHistoryFile(context, channelId, file),
  };
}

function omitChannel<T>(current: Record<string, T>, channelId: string) {
  const updated = { ...current };
  delete updated[channelId];
  return updated;
}
