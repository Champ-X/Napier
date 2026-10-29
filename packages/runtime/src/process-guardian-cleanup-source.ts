export const PROCESS_GUARDIAN_CLEANUP_SOURCE = String.raw`
function validCleanup(value, targetCommand) {
  return (
    value &&
    typeof value === "object" &&
    value.kind === "oci-container" &&
    value.command === targetCommand &&
    isAbsolute(value.command) &&
    typeof value.commandSha256 === "string" &&
    /^[a-f0-9]{64}$/.test(value.commandSha256) &&
    typeof value.containerName === "string" &&
    /^napier-[a-f0-9]{32}$/.test(value.containerName) &&
    (value.networkName === undefined ||
      (typeof value.networkName === "string" &&
        /^napier-network-[a-f0-9]{32}$/.test(value.networkName))) &&
    typeof value.scratchHome === "string" &&
    isAbsolute(value.scratchHome) &&
    /^napier-process-sandbox-[A-Za-z0-9]{6}$/.test(
      basename(value.scratchHome),
    ) &&
    typeof value.environmentSha256 === "string" &&
    /^[a-f0-9]{64}$/.test(value.environmentSha256) &&
    value.env &&
    typeof value.env === "object" &&
    !Array.isArray(value.env) &&
    Object.entries(value.env).every(
      ([key, item]) =>
        /^[A-Z_][A-Z0-9_]{0,127}$/.test(key) &&
        typeof item === "string" &&
        !/[\u0000-\u001f\u007f]/.test(item),
    )
  );
}


function cleanupTargetResource() {
  if (!spec.cleanup) return true;
  let executableSha256;
  try {
    executableSha256 = createHash("sha256")
      .update(readFileSync(spec.cleanup.command))
      .digest("hex");
  } catch {
    cleanupScratchHome();
    return false;
  }
  if (executableSha256 !== spec.cleanup.commandSha256) {
    return cleanupScratchHome() && false;
  }
  const remove = spawnSync(
    spec.cleanup.command,
    ["container", "rm", "--force", spec.cleanup.containerName],
    cleanupOptions(spec.cleanup.env),
  );
  const containerClean = successfulCleanupCommand(remove) || containerMissing();
  const networkClean = !spec.cleanup.networkName || cleanupNetworkResource();
  const scratchClean = cleanupScratchHome();
  return containerClean && networkClean && scratchClean;
}

function cleanupNetworkResource() {
  const networkRemove = spawnSync(
    spec.cleanup.command,
    ["network", "rm", spec.cleanup.networkName],
    cleanupOptions(spec.cleanup.env),
  );
  return successfulCleanupCommand(networkRemove) || networkMissing();
}

function cleanupScratchHome() {
  const scratchHome = spec.cleanup.scratchHome;
  const environmentPath = join(scratchHome, "environment.list");
  const tombstone =
    scratchHome + "." + randomBytes(8).toString("hex") + ".guardian-remove";
  try {
    if (!validScratchHome(scratchHome, environmentPath)) return false;
    renameSync(scratchHome, tombstone);
    const tombstoneEnvironment = join(tombstone, "environment.list");
    if (!validScratchHome(tombstone, tombstoneEnvironment)) return false;
    unlinkSync(tombstoneEnvironment);
    rmdirSync(tombstone);
    return true;
  } catch (error) {
    return error && typeof error === "object" && error.code === "ENOENT";
  }
}

function validScratchHome(directoryPath, environmentPath) {
  const directory = lstatSync(directoryPath);
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    (directory.mode & 0o777) !== 0o700 ||
    readdirSync(directoryPath).join("\n") !== "environment.list"
  ) {
    return false;
  }
  let descriptor;
  try {
    descriptor = openSync(
      environmentPath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const environment = fstatSync(descriptor);
    if (
      !environment.isFile() ||
      (environment.mode & 0o777) !== 0o600 ||
      environment.size < 0 ||
      environment.size > 64 * 1024
    ) {
      return false;
    }
    return (
      createHash("sha256").update(readFileSync(descriptor)).digest("hex") ===
      spec.cleanup.environmentSha256
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function containerMissing() {
  const remaining = spawnSync(
    spec.cleanup.command,
    [
      "container",
      "ls",
      "--all",
      "--filter",
      "name=^/" + spec.cleanup.containerName + "$",
      "--format",
      "{{.ID}}",
    ],
    cleanupOptions(spec.cleanup.env),
  );
  return successfulCleanupCommand(remaining) && remaining.stdout.trim() === "";
}

function networkMissing() {
  const remaining = spawnSync(
    spec.cleanup.command,
    [
      "network",
      "ls",
      "--filter",
      "name=^" + spec.cleanup.networkName + "$",
      "--format",
      "{{.ID}}",
    ],
    cleanupOptions(spec.cleanup.env),
  );
  return successfulCleanupCommand(remaining) && remaining.stdout.trim() === "";
}

function cleanupOptions(env) {
  return {
    encoding: "utf8",
    env,
    timeout: CLEANUP_TIMEOUT_MS,
    killSignal: "SIGKILL",
    maxBuffer: CLEANUP_MAX_BYTES,
    windowsHide: true,
  };
}

function successfulCleanupCommand(result) {
  return !result.error && result.status === 0 && result.signal === null;
}

`;
