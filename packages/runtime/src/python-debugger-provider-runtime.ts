import path from "node:path";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { ToolchainOptions } from "./python-toolchain.js";

/** Provider bindings must be explicit and image-bound; never replace a failed
 * isolated provider with host execution or accept model-supplied executables. */
export async function providerPythonDebuggerRuntime(options: ToolchainOptions) {
  const binding = await options.sandbox.resolvePythonDebuggerRuntime?.();
  if (!binding) return undefined;
  if (
    options.executables?.python !== undefined ||
    (options.runtimeReadPaths?.length ?? 0) > 0
  )
    throw new Error(
      "Image-bound Python debugger does not accept host runtime overrides",
    );
  if (
    binding.runtime !== "python-debugger" ||
    binding.isolation !== "oci" ||
    options.sandbox.id !== "oci-container" ||
    ![binding.executable, binding.debugpyRoot].every(
      (value) =>
        typeof value === "string" &&
        value.length <= 500 &&
        path.posix.isAbsolute(value) &&
        !/[\u0000-\u001f\u007f]/u.test(value),
    ) ||
    ![
      binding.executableSha256,
      binding.packageSha256,
      binding.runtimeIdentitySha256,
    ].every(
      (value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value),
    ) ||
    ![binding.pythonVersion, binding.debugpyVersion].every(
      (value) =>
        typeof value === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,79}$/u.test(value),
    ) ||
    (binding.protocolWorkspaceRoot !== undefined &&
      binding.protocolWorkspaceRoot !== "/workspace")
  )
    throw new Error("Python debugger provider binding is invalid");
  const content = {
    location: "provider" as const,
    sandbox: options.sandbox.id,
    isolation: binding.isolation,
    executable: binding.executable,
    executableSha256: binding.executableSha256,
    pythonVersion: binding.pythonVersion,
    debugpyRoot: binding.debugpyRoot,
    debugpyVersion: binding.debugpyVersion,
    packageSha256: binding.packageSha256,
    ...(binding.protocolWorkspaceRoot
      ? { protocolWorkspaceRoot: binding.protocolWorkspaceRoot }
      : {}),
    providerIdentitySha256: binding.runtimeIdentitySha256,
  };
  return { ...content, identitySha256: sha256(canonicalJson(content)) };
}
