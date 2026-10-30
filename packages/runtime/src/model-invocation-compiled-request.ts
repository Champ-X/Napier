import { captureExactModelInvocation, type ExactModelInvocationCaptureInput } from "./model-invocation-exact-capture.js";
import { createCompiledPromptPackageReceiptV3 } from "./compiled-prompt-package.js";
import type { CompiledPromptArtifact } from "./prompt-compiler.js";

/** Shared exact capture with owner-selected receipt routing. Child execution
 * keeps its canonical settlement and supervisor receipt ownership. */
export function captureCompiledModelRequest(input: Omit<ExactModelInvocationCaptureInput, "afterAdapter"> & {
  compiledPrompt: CompiledPromptArtifact;
  recordCompiledPackage(receipt: ReturnType<typeof createCompiledPromptPackageReceiptV3>): Promise<void>;
}) {
  return captureExactModelInvocation({
    ...input,
    context: { ...input.context, systemPrompt: input.compiledPrompt.systemPrompt },
    afterAdapter: ({ envelope, adapter }) => input.recordCompiledPackage(createCompiledPromptPackageReceiptV3({
      compiled: input.compiledPrompt, envelope, adapter, purpose: input.purpose,
    })),
  });
}
