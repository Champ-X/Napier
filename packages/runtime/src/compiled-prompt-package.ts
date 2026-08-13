export const COMPILED_PROMPT_PACKAGE_EVENT = "context.prompt_package";

export {
  COMPILED_PROMPT_PACKAGE_VERSION_V3,
  createCompiledPromptPackageReceiptV3,
  validateCompiledPromptPackageReceiptV3,
} from "./compiled-prompt-package-v3.js";
export type {
  CompiledPromptLayerReceiptV3,
  CompiledPromptPackageReceiptV3,
  CompiledPromptSourceReceipt,
} from "./compiled-prompt-package-v3.js";
export {
  COMPILED_PROMPT_PACKAGE_VERSION,
  LEGACY_COMPILED_PROMPT_PACKAGE_VERSION,
  validateCompiledPromptPackageReceipt,
} from "./compiled-prompt-package-receipt.js";
export type {
  CompiledPromptLayerReceipt,
  CompiledPromptPackageReceipt,
  CompiledPromptPackageReceiptV2,
  PromptInvariantCoreBinding,
  PromptLayerId,
} from "./compiled-prompt-package-receipt.js";
