import type {
  SandboxLaunchRequest,
  SandboxLocalServiceRequest,
} from "./sandbox-types.js";

export const MIN_LOCAL_SERVICE_PORT = 1_024;
export const MAX_LOCAL_SERVICE_PORT = 65_535;
export const MAX_LOCAL_SERVICE_HEALTH_PATH_CHARS = 256;

export function validateSandboxLocalService(
  request: SandboxLaunchRequest,
): void {
  const service = request.localService;
  const capabilities = new Set(request.approvedCapabilities);
  if (!service) {
    if (capabilities.has("network.listen")) {
      throw new Error("network.listen requires a bounded local service");
    }
    return;
  }
  validateSandboxLocalServiceRequest(service);
  if (!capabilities.has("network.listen")) {
    throw new Error("Local services require approved network.listen");
  }
  if (capabilities.has("network.connect")) {
    throw new Error(
      "Local services cannot combine listening with outbound network access",
    );
  }
  if (request.terminal) {
    throw new Error("Local services cannot use terminal PTY mode");
  }
}

export function validateSandboxLocalServiceRequest(
  service: SandboxLocalServiceRequest,
): void {
  if (
    service.protocol !== "http" ||
    !Number.isSafeInteger(service.containerPort) ||
    service.containerPort < MIN_LOCAL_SERVICE_PORT ||
    service.containerPort > MAX_LOCAL_SERVICE_PORT ||
    typeof service.healthPath !== "string" ||
    service.healthPath.length < 1 ||
    service.healthPath.length > MAX_LOCAL_SERVICE_HEALTH_PATH_CHARS ||
    /[\u0000-\u001f\u007f]/u.test(service.healthPath)
  ) {
    throw new Error("Local service request is invalid");
  }
  let url: URL;
  try {
    url = new URL(service.healthPath, "http://service.invalid");
  } catch {
    throw new Error("Local service health path is invalid");
  }
  if (
    url.origin !== "http://service.invalid" ||
    url.hash !== "" ||
    `${url.pathname}${url.search}` !== service.healthPath
  ) {
    throw new Error("Local service health path is invalid");
  }
}

export function rejectLocalServiceForProvider(
  request: SandboxLaunchRequest,
  providerId: string,
): void {
  if (request.localService) {
    throw new Error(
      `The ${providerId} Sandbox cannot provide an egress-denied loopback local service`,
    );
  }
}
