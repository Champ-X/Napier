import type { projectReceiptTrustController } from "./receipt-trust-controller-projection";
import type {
  ReceiptTrustControllerState,
  ReceiptTrustPanelProps,
} from "./receipt-trust-controller-types";
import type { ReceiptTrustOperationController } from "./use-receipt-trust-operation";

export interface ReceiptTrustActionContext {
  props: ReceiptTrustPanelProps;
  state: ReceiptTrustControllerState;
  projection: ReturnType<typeof projectReceiptTrustController>;
  operation: ReceiptTrustOperationController;
  patch: (value: Partial<ReceiptTrustControllerState>) => void;
  update: (
    updater: (
      current: ReceiptTrustControllerState,
    ) => ReceiptTrustControllerState,
  ) => void;
}

export function patchReceiptTrustState(
  current: ReceiptTrustControllerState,
  value: Partial<ReceiptTrustControllerState>,
): ReceiptTrustControllerState {
  return { ...current, ...value };
}
