import { execFile as execFileWithCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileWithCallback);
const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const DEFAULT_IMAGE = "napier-sandbox:0.1.0";
const DEFAULT_SBOM_PATH = "docs/artifacts/sandbox-image-sbom-0.1.0.cdx.json";
const DEFAULT_RECEIPT_PATH =
  "docs/artifacts/sandbox-image-provenance-0.1.0.json";
const DOCKERFILE_PATH = "docker/napier-sandbox/Dockerfile";
const PACKAGE_JSON_PATH = "docker/napier-sandbox/package.json";
const PACKAGE_LOCK_PATH = "docker/napier-sandbox/package-lock.json";
const COLLECTION_LIMITS = {
  network: "none",
  readOnlyRoot: true,
  pids: 32,
  memoryBytes: 128 * 1024 * 1024,
  cpus: "0.5",
};
const DOCKER_TIMEOUT_MS = 30_000;
const MAX_DOCKER_OUTPUT_BYTES = 2 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/u;
const TOOLCHAIN_SCRIPT = String.raw`
const { spawnSync } = require("node:child_process");
const lock = require("/opt/napier/package-lock.json");
const version = (name) => lock.packages["node_modules/" + name]?.version ?? "";
const command = (executable, args) => {
  const result = spawnSync(executable, args, { encoding: "utf8" });
  if (result.status !== 0) process.exit(2);
  return (result.stdout || result.stderr).trim();
};
const bash = command("/bin/bash", ["--version"]).split("\n")[0];
process.stdout.write(JSON.stringify({
  node: process.versions.node,
  nodeInspector: process.versions.node,
  shell: bash.match(/version ([^ ]+)/)?.[1] ?? "",
  python: command("/usr/bin/python3", ["-c", "import platform; print(platform.python_version())"]),
  git: command("/usr/bin/git", ["--version"]).replace(/^git version /, ""),
  typescript: version("typescript"),
  typescriptLanguageServer: version("typescript-language-server"),
  vitest: version("vitest"),
  prettier: version("prettier"),
}));
`;

export async function collectSandboxImageEvidence(
  options = {},
  dependencies = {},
) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const imageReference = options.image ?? DEFAULT_IMAGE;
  const source = await sandboxImageSourceEvidence(repoRoot);
  const docker = dependencies.docker ?? runDocker;
  const errors = [];
  const environment = options.env ?? process.env;
  const endpoint = await containerEndpoint(docker, environment, errors);
  const inspect = parseJson(
    await docker(["image", "inspect", imageReference]),
    "Docker image inspect",
  )?.[0];
  validateImageInspect(inspect, source, errors);
  const imageId = IMAGE_ID.test(String(inspect?.Id)) ? inspect.Id : "";
  const [debianText, npmText, toolchainText] = imageId
    ? await Promise.all([
        docker(
          containerArgs(imageId, [
            "/usr/bin/dpkg-query",
            "-W",
            "-f=${binary:Package}\\t${Version}\\t${Architecture}\\n",
          ]),
        ),
        docker(
          containerArgs(imageId, [
            "/usr/local/bin/node",
            "-e",
            'process.stdout.write(JSON.stringify(require("/opt/napier/package-lock.json")))',
          ]),
        ),
        docker(
          containerArgs(imageId, [
            "/usr/local/bin/node",
            "-e",
            TOOLCHAIN_SCRIPT,
          ]),
        ),
      ])
    : ["", "{}", "{}"];
  const debian = parseDebianPackages(debianText, errors);
  const npm = parseNpmPackages(npmText, errors);
  const toolchain = parseToolchain(toolchainText, errors);
  const image = imageEvidence(imageReference, inspect, errors);
  const daemon = {
    location: "local",
    endpointSha256: endpoint ? sha256(Buffer.from(endpoint, "utf8")) : "",
  };
  const sbom = createSandboxImageSbom({
    source,
    image,
    debian,
    npm,
    toolchain,
  });
  const receipt = createSandboxImageProvenance({
    source,
    image,
    daemon,
    toolchain,
    sbom,
    sbomPath: options.sbomPath ?? DEFAULT_SBOM_PATH,
    errors,
  });
  return { ok: errors.length === 0, errors, sbom, receipt };
}

export function createSandboxImageSbom({
  source,
  image,
  debian,
  npm,
  toolchain,
}) {
  const components = [
    ...debian.map((component) => ({
      type: "library",
      name: component.name,
      version: component.version,
      "bom-ref": `pkg:deb/debian/${encodeURIComponent(component.name)}@${encodeURIComponent(component.version)}?arch=${encodeURIComponent(component.arch)}`,
      purl: `pkg:deb/debian/${encodeURIComponent(component.name)}@${encodeURIComponent(component.version)}?arch=${encodeURIComponent(component.arch)}`,
      properties: [
        { name: "napier.package.ecosystem", value: "debian" },
        { name: "napier.package.arch", value: component.arch },
      ],
    })),
    ...npm.map((component) => ({
      type: "library",
      name: component.name,
      version: component.version,
      "bom-ref": `pkg:npm/${encodeURIComponent(component.name)}@${encodeURIComponent(component.version)}`,
      purl: `pkg:npm/${encodeURIComponent(component.name)}@${encodeURIComponent(component.version)}`,
      ...(component.license
        ? { licenses: [{ license: { id: component.license } }] }
        : {}),
      ...(component.integrity
        ? {
            hashes: [
              {
                alg: "SHA-512",
                content: sriDigest(component.integrity),
              },
            ],
          }
        : {}),
      properties: [{ name: "napier.package.ecosystem", value: "npm" }],
    })),
    {
      type: "application",
      name: "node",
      version: toolchain.node,
      "bom-ref": `pkg:generic/node@${encodeURIComponent(toolchain.node)}`,
      purl: `pkg:generic/node@${encodeURIComponent(toolchain.node)}`,
      properties: [
        { name: "napier.package.ecosystem", value: "runtime" },
        {
          name: "napier.runtime.node-inspector-version",
          value: toolchain.nodeInspector,
        },
      ],
    },
  ].sort((left, right) => compareText(left["bom-ref"], right["bom-ref"]));
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      component: {
        type: "container",
        name: "napier-sandbox",
        version: "0.1.0",
        "bom-ref": `pkg:oci/napier-sandbox@${encodeURIComponent(image.id)}`,
        properties: [
          { name: "napier.image.reference", value: image.reference },
          { name: "napier.image.os", value: image.os },
          { name: "napier.image.arch", value: image.arch },
          {
            name: "napier.source.context-sha256",
            value: source.contextSha256,
          },
        ],
      },
      properties: [
        { name: "napier.sbom.scope", value: "local-single-platform" },
        { name: "napier.sbom.network", value: "none" },
      ],
    },
    components,
  };
}

export function createSandboxImageProvenance({
  source,
  image,
  daemon,
  toolchain,
  sbom,
  sbomPath,
  errors = [],
}) {
  const componentKinds = componentCounts(sbom.components);
  const componentSetSha256 = sha256(
    Buffer.from(
      sbom.components.map((component) => component["bom-ref"]).join("\n"),
      "utf8",
    ),
  );
  const sbomSha256 = sha256(Buffer.from(artifactJson(sbom), "utf8"));
  const withoutHash = {
    type: "napier.sandbox-image-provenance",
    schemaVersion: 1,
    ok: errors.length === 0,
    scope: "local-single-platform",
    publication: {
      registryPublished: false,
      signed: false,
      attested: false,
    },
    source,
    image,
    daemon,
    toolchain,
    collection: {
      network: COLLECTION_LIMITS.network,
      readOnlyRoot: COLLECTION_LIMITS.readOnlyRoot,
      pids: COLLECTION_LIMITS.pids,
      memoryBytes: COLLECTION_LIMITS.memoryBytes,
      cpus: COLLECTION_LIMITS.cpus,
      capabilitiesDropped: "ALL",
      noNewPrivileges: true,
    },
    sbom: {
      path: sbomPath,
      format: "CycloneDX",
      specVersion: "1.5",
      sha256: sbomSha256,
      componentCount: sbom.components.length,
      debianComponentCount: componentKinds.debian,
      npmComponentCount: componentKinds.npm,
      runtimeComponentCount: componentKinds.runtime,
      componentSetSha256,
    },
    errors,
  };
  return {
    ...withoutHash,
    contentSha256: sha256(Buffer.from(stableJson(withoutHash), "utf8")),
  };
}

export async function verifySandboxImageArtifacts(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const sbomPath = resolveRepoPath(
    repoRoot,
    options.sbomPath ?? DEFAULT_SBOM_PATH,
  );
  const receiptPath = resolveRepoPath(
    repoRoot,
    options.verifyReceiptPath ?? options.receiptPath ?? DEFAULT_RECEIPT_PATH,
  );
  const errors = [];
  const [sbomText, receiptText, source] = await Promise.all([
    readText(sbomPath, "Sandbox image SBOM", errors),
    readText(receiptPath, "Sandbox image provenance receipt", errors),
    sandboxImageSourceEvidence(repoRoot).catch((error) => {
      errors.push(error instanceof Error ? error.message : String(error));
      return undefined;
    }),
  ]);
  const sbom = parseJson(sbomText, "Sandbox image SBOM", errors);
  const receipt = parseJson(
    receiptText,
    "Sandbox image provenance receipt",
    errors,
  );
  validateSbom(sbom, errors);
  validateReceipt(receipt, errors);
  validateSbomReceiptBinding(sbom, receipt, errors);
  if (source && receipt) {
    if (stableJson(receipt.source) !== stableJson(source)) {
      errors.push("receipt source does not match the current Dockerfile");
    }
  }
  if (sbom && receipt) {
    const observedSbomSha256 = sha256(Buffer.from(sbomText, "utf8"));
    if (receipt.sbom?.sha256 !== observedSbomSha256) {
      errors.push("receipt SBOM SHA-256 does not match the SBOM");
    }
    const expectedReceipt = createSandboxImageProvenance({
      source: receipt.source,
      image: receipt.image,
      daemon: receipt.daemon,
      toolchain: receipt.toolchain,
      sbom,
      sbomPath: toRepoPath(repoRoot, sbomPath),
      errors: [],
    });
    if (stableJson(receipt) !== stableJson(expectedReceipt)) {
      errors.push("receipt does not match the current SBOM projection");
    }
  }
  if (options.live && errors.length === 0) {
    const current = await collectSandboxImageEvidence(
      {
        repoRoot,
        image: options.image ?? receipt.image.reference,
        sbomPath: toRepoPath(repoRoot, sbomPath),
      },
      options.dependencies,
    );
    if (!current.ok) errors.push(...current.errors);
    if (stableJson(current.sbom) !== stableJson(sbom)) {
      errors.push("live image SBOM does not match the stored SBOM");
    }
    if (stableJson(current.receipt) !== stableJson(receipt)) {
      errors.push("live image provenance does not match the stored receipt");
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    sbomPath: toRepoPath(repoRoot, sbomPath),
    sbomSha256: sha256(Buffer.from(sbomText, "utf8")),
    receiptPath: toRepoPath(repoRoot, receiptPath),
    receiptSha256: sha256(Buffer.from(receiptText, "utf8")),
  };
}

function containerArgs(imageId, command) {
  return [
    "run",
    "--rm",
    "--network",
    COLLECTION_LIMITS.network,
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    String(COLLECTION_LIMITS.pids),
    "--memory",
    String(COLLECTION_LIMITS.memoryBytes),
    "--cpus",
    COLLECTION_LIMITS.cpus,
    imageId,
    ...command,
  ];
}

export async function sandboxImageSourceEvidence(repoRoot) {
  const [dockerfile, packageJson, packageLock] = await Promise.all([
    readFile(path.join(repoRoot, DOCKERFILE_PATH)),
    readFile(path.join(repoRoot, PACKAGE_JSON_PATH)),
    readFile(path.join(repoRoot, PACKAGE_LOCK_PATH)),
  ]);
  const dockerfileSha256 = sha256(dockerfile);
  const packageJsonSha256 = sha256(packageJson);
  const packageLockSha256 = sha256(packageLock);
  return {
    dockerfilePath: DOCKERFILE_PATH,
    dockerfileSha256,
    packageJsonPath: PACKAGE_JSON_PATH,
    packageJsonSha256,
    packageLockPath: PACKAGE_LOCK_PATH,
    packageLockSha256,
    contextSha256: sha256(
      Buffer.from(
        stableJson({
          dockerfile: DOCKERFILE_PATH,
          dockerfileSha256,
          packageJson: PACKAGE_JSON_PATH,
          packageJsonSha256,
          packageLock: PACKAGE_LOCK_PATH,
          packageLockSha256,
        }),
        "utf8",
      ),
    ),
  };
}

function imageEvidence(reference, inspect, errors) {
  const labels = isRecord(inspect?.Config?.Labels) ? inspect.Config.Labels : {};
  const repoDigests = Array.isArray(inspect?.RepoDigests)
    ? [...inspect.RepoDigests]
        .filter((value) => typeof value === "string")
        .sort()
    : [];
  const value = {
    reference,
    id: String(inspect?.Id ?? ""),
    repoDigests,
    os: String(inspect?.Os ?? ""),
    arch: String(inspect?.Architecture ?? ""),
    sizeBytes: Number(inspect?.Size ?? 0),
    labels: Object.fromEntries(
      Object.entries(labels)
        .filter(([, entry]) => typeof entry === "string")
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
  if (!IMAGE_ID.test(value.id)) errors.push("image ID is not immutable");
  if (value.os !== "linux") errors.push("image OS must be linux");
  if (!["amd64", "arm64"].includes(value.arch)) {
    errors.push("image architecture must be amd64 or arm64");
  }
  if (!Number.isSafeInteger(value.sizeBytes) || value.sizeBytes <= 0) {
    errors.push("image size must be a positive integer");
  }
  return value;
}

function validateImageInspect(inspect, source, errors) {
  if (!isRecord(inspect)) {
    errors.push("Docker image inspect must return one image object");
    return;
  }
  const labels = inspect.Config?.Labels;
  if (
    !isRecord(labels) ||
    labels["io.napier.sandbox.context-sha256"] !== source.contextSha256
  ) {
    errors.push("image context label does not match the current Dockerfile");
  }
}

function parseDebianPackages(text, errors) {
  const packages = [];
  for (const line of text.trim().split("\n").filter(Boolean)) {
    const [name, version, arch, ...extra] = line.split("\t");
    if (!name || !version || !arch || extra.length > 0) {
      errors.push("Debian package inventory is malformed");
      continue;
    }
    packages.push({ name, version, arch });
  }
  packages.sort((left, right) =>
    `${left.name}\0${left.version}\0${left.arch}`.localeCompare(
      `${right.name}\0${right.version}\0${right.arch}`,
    ),
  );
  if (packages.length === 0) errors.push("Debian package inventory is empty");
  return packages;
}

function parseNpmPackages(text, errors) {
  const lock = parseJson(text, "Sandbox npm lockfile", errors);
  const packages = isRecord(lock?.packages) ? lock.packages : {};
  const components = Object.entries(packages).flatMap(([location, value]) => {
    if (!location || !isRecord(value)) return [];
    const name = location.replace(/^node_modules\//u, "");
    return typeof value.version === "string"
      ? [
          {
            name,
            version: value.version,
            license: typeof value.license === "string" ? value.license : "",
            integrity:
              typeof value.integrity === "string" ? value.integrity : "",
          },
        ]
      : [];
  });
  components.sort((left, right) => left.name.localeCompare(right.name));
  if (components.length === 0) errors.push("npm package inventory is empty");
  return components;
}

function parseToolchain(text, errors) {
  const value = parseJson(text, "Sandbox toolchain inventory", errors);
  const names = [
    "node",
    "nodeInspector",
    "shell",
    "python",
    "git",
    "typescript",
    "typescriptLanguageServer",
    "vitest",
    "prettier",
  ];
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join("\n") !== [...names].sort().join("\n") ||
    names.some(
      (name) =>
        typeof value[name] !== "string" ||
        value[name].length === 0 ||
        value[name].length > 100,
    )
  ) {
    errors.push("Sandbox toolchain inventory is malformed");
    return Object.fromEntries(names.map((name) => [name, "unavailable"]));
  }
  return value;
}

async function containerEndpoint(docker, environment, errors) {
  const explicitHost = environment["DOCKER_HOST"]?.trim();
  const explicitContext = environment["DOCKER_CONTEXT"]?.trim();
  const endpoint = (
    explicitHost && !explicitContext
      ? explicitHost
      : await docker([
          "context",
          "inspect",
          "--format",
          "{{.Endpoints.docker.Host}}",
        ])
  ).trim();
  if (
    endpoint.length === 0 ||
    endpoint.length > 500 ||
    /[\u0000-\u001f\u007f]/u.test(endpoint) ||
    !isLocalContainerEndpoint(endpoint)
  ) {
    errors.push("SBOM collection requires a local Docker daemon endpoint");
    return "";
  }
  return endpoint;
}

function isLocalContainerEndpoint(endpoint) {
  if (endpoint.startsWith("unix://")) {
    return endpoint.slice("unix://".length).startsWith("/");
  }
  const lower = endpoint.toLowerCase();
  return (
    lower.startsWith("npipe:////./pipe/") || /^fd:\/\/(?:[0-9]+)?$/u.test(lower)
  );
}

function validToolchain(value) {
  return (
    isRecord(value) &&
    [
      "node",
      "nodeInspector",
      "shell",
      "python",
      "git",
      "typescript",
      "typescriptLanguageServer",
      "vitest",
      "prettier",
    ].every(
      (name) =>
        typeof value[name] === "string" &&
        value[name].length > 0 &&
        value[name].length <= 100,
    )
  );
}

function validateSbom(sbom, errors) {
  if (
    !isRecord(sbom) ||
    sbom.bomFormat !== "CycloneDX" ||
    sbom.specVersion !== "1.5" ||
    sbom.version !== 1 ||
    !Array.isArray(sbom.components) ||
    sbom.components.length === 0
  ) {
    errors.push("SBOM shape is invalid");
    return;
  }
  const refs = sbom.components.map((component) => component?.["bom-ref"]);
  if (
    refs.some((ref) => typeof ref !== "string") ||
    new Set(refs).size !== refs.length ||
    stableJson(refs) !== stableJson([...refs].sort())
  ) {
    errors.push("SBOM component references must be unique and sorted");
  }
}

function validateReceipt(receipt, errors) {
  if (
    !isRecord(receipt) ||
    receipt.type !== "napier.sandbox-image-provenance" ||
    receipt.schemaVersion !== 1 ||
    receipt.ok !== true ||
    receipt.scope !== "local-single-platform" ||
    stableJson(receipt.publication) !==
      stableJson({
        registryPublished: false,
        signed: false,
        attested: false,
      }) ||
    !validSource(receipt.source) ||
    !validImage(receipt.image) ||
    receipt.daemon?.location !== "local" ||
    !isSha256(receipt.daemon?.endpointSha256) ||
    !validToolchain(receipt.toolchain) ||
    stableJson(receipt.collection) !==
      stableJson({
        network: COLLECTION_LIMITS.network,
        readOnlyRoot: COLLECTION_LIMITS.readOnlyRoot,
        pids: COLLECTION_LIMITS.pids,
        memoryBytes: COLLECTION_LIMITS.memoryBytes,
        cpus: COLLECTION_LIMITS.cpus,
        capabilitiesDropped: "ALL",
        noNewPrivileges: true,
      }) ||
    !validSbomReceipt(receipt.sbom) ||
    !isSha256(receipt.contentSha256)
  ) {
    errors.push("Sandbox image provenance receipt shape is invalid");
    return;
  }
  const { contentSha256, ...withoutHash } = receipt;
  if (contentSha256 !== sha256(Buffer.from(stableJson(withoutHash), "utf8"))) {
    errors.push("Sandbox image provenance content hash is invalid");
  }
}

function validateSbomReceiptBinding(sbom, receipt, errors) {
  if (!isRecord(sbom) || !isRecord(receipt)) return;
  const component = sbom.metadata?.component;
  const properties = propertyMap(component?.properties);
  if (
    !isRecord(component) ||
    component["bom-ref"] !==
      `pkg:oci/napier-sandbox@${encodeURIComponent(receipt.image?.id ?? "")}` ||
    properties["napier.image.reference"] !== receipt.image?.reference ||
    properties["napier.image.os"] !== receipt.image?.os ||
    properties["napier.image.arch"] !== receipt.image?.arch ||
    properties["napier.source.context-sha256"] !== receipt.source?.contextSha256
  ) {
    errors.push("SBOM metadata does not match the provenance receipt");
  }
  if (
    receipt.image?.labels?.["io.napier.sandbox.context-sha256"] !==
    receipt.source?.contextSha256
  ) {
    errors.push("receipt image context label does not match source");
  }
  const node = sbom.components?.find(
    (candidate) =>
      propertyMap(candidate?.properties)["napier.package.ecosystem"] ===
      "runtime",
  );
  if (
    node?.name !== "node" ||
    node?.version !== receipt.toolchain?.node ||
    propertyMap(node?.properties)["napier.runtime.node-inspector-version"] !==
      receipt.toolchain?.nodeInspector
  ) {
    errors.push("SBOM Node runtime does not match the toolchain receipt");
  }
}

function validSource(value) {
  return (
    isRecord(value) &&
    value.dockerfilePath === DOCKERFILE_PATH &&
    isSha256(value.dockerfileSha256) &&
    value.packageJsonPath === PACKAGE_JSON_PATH &&
    isSha256(value.packageJsonSha256) &&
    value.packageLockPath === PACKAGE_LOCK_PATH &&
    isSha256(value.packageLockSha256) &&
    isSha256(value.contextSha256) &&
    Object.keys(value).length === 7
  );
}

function validImage(value) {
  return (
    isRecord(value) &&
    typeof value.reference === "string" &&
    value.reference.length > 0 &&
    value.reference.length <= 200 &&
    IMAGE_ID.test(String(value.id)) &&
    value.os === "linux" &&
    ["amd64", "arm64"].includes(value.arch) &&
    Number.isSafeInteger(value.sizeBytes) &&
    value.sizeBytes > 0 &&
    Array.isArray(value.repoDigests) &&
    stableJson(value.repoDigests) ===
      stableJson([...value.repoDigests].sort(compareText)) &&
    value.repoDigests.every(
      (digest) =>
        typeof digest === "string" &&
        /^[a-zA-Z0-9][a-zA-Z0-9._/-]*@sha256:[a-f0-9]{64}$/u.test(digest),
    ) &&
    isRecord(value.labels)
  );
}

function validSbomReceipt(value) {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    value.format === "CycloneDX" &&
    value.specVersion === "1.5" &&
    isSha256(value.sha256) &&
    isSha256(value.componentSetSha256) &&
    [
      "componentCount",
      "debianComponentCount",
      "npmComponentCount",
      "runtimeComponentCount",
    ].every((name) => Number.isSafeInteger(value[name]) && value[name] >= 0) &&
    value.componentCount ===
      value.debianComponentCount +
        value.npmComponentCount +
        value.runtimeComponentCount
  );
}

function propertyMap(properties) {
  return Object.fromEntries(
    Array.isArray(properties)
      ? properties.flatMap((property) =>
          isRecord(property) &&
          typeof property.name === "string" &&
          typeof property.value === "string"
            ? [[property.name, property.value]]
            : [],
        )
      : [],
  );
}

function componentCounts(components) {
  return components.reduce(
    (counts, component) => {
      const ecosystem = component.properties?.find(
        (property) => property.name === "napier.package.ecosystem",
      )?.value;
      if (ecosystem === "debian") counts.debian += 1;
      if (ecosystem === "npm") counts.npm += 1;
      if (ecosystem === "runtime") counts.runtime += 1;
      return counts;
    },
    { debian: 0, npm: 0, runtime: 0 },
  );
}

function sriDigest(integrity) {
  const match = String(integrity).match(/^sha512-(.+)$/u);
  if (!match) return "";
  return Buffer.from(match[1], "base64").toString("hex");
}

async function runDocker(args) {
  const result = await execFile("docker", args, {
    encoding: "utf8",
    timeout: DOCKER_TIMEOUT_MS,
    maxBuffer: MAX_DOCKER_OUTPUT_BYTES,
    windowsHide: true,
    env: dockerEnvironment(),
  });
  return result.stdout;
}

function dockerEnvironment() {
  const names = [
    "DOCKER_CERT_PATH",
    "DOCKER_CONFIG",
    "DOCKER_CONTEXT",
    "DOCKER_HOST",
    "DOCKER_TLS_VERIFY",
    "HOME",
    "PATH",
  ];
  return Object.fromEntries(
    names.flatMap((name) =>
      process.env[name] === undefined ? [] : [[name, process.env[name]]],
    ),
  );
}

async function runCli() {
  const options = parseOptions(process.argv.slice(2));
  if (options.write) {
    const result = await collectSandboxImageEvidence(options);
    if (!result.ok) {
      fail(result.errors);
      return;
    }
    await writeJson(
      resolveRepoPath(options.repoRoot, options.sbomPath),
      result.sbom,
    );
    await writeJson(
      resolveRepoPath(options.repoRoot, options.receiptPath),
      result.receipt,
    );
    console.log(
      `Sandbox image SBOM written: ${result.sbom.components.length} components image ${result.receipt.image.id.slice(0, 20)}`,
    );
    return;
  }
  const verification = await verifySandboxImageArtifacts(options);
  if (!verification.valid) {
    fail(verification.errors);
    return;
  }
  console.log(
    `Sandbox image SBOM verified: ${verification.sbomPath} ${verification.sbomSha256.slice(0, 16)} receipt ${verification.receiptSha256.slice(0, 16)}${options.live ? " live" : ""}`,
  );
}

function parseOptions(args) {
  const options = {
    repoRoot: defaultRepoRoot,
    image: DEFAULT_IMAGE,
    sbomPath: DEFAULT_SBOM_PATH,
    receiptPath: DEFAULT_RECEIPT_PATH,
    verifyReceiptPath: DEFAULT_RECEIPT_PATH,
    write: false,
    live: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--write") options.write = true;
    else if (arg === "--live") options.live = true;
    else if (
      [
        "--repo-root",
        "--image",
        "--sbom-path",
        "--receipt-path",
        "--verify-receipt-path",
      ].includes(arg)
    ) {
      const value = args[index + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      const key = {
        "--repo-root": "repoRoot",
        "--image": "image",
        "--sbom-path": "sbomPath",
        "--receipt-path": "receiptPath",
        "--verify-receipt-path": "verifyReceiptPath",
      }[arg];
      options[key] = arg === "--repo-root" ? path.resolve(value) : value;
      index += 1;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

async function readText(filePath, label, errors) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    errors.push(`${label} cannot be read`);
    return "";
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, artifactJson(value), "utf8");
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

function parseJson(text, label, errors = []) {
  try {
    return JSON.parse(text);
  } catch {
    errors.push(`${label} is not valid JSON`);
    return undefined;
  }
}

function resolveRepoPath(repoRoot, candidate) {
  const absolute = path.resolve(repoRoot, candidate);
  const relative = path.relative(repoRoot, absolute);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("artifact path must remain inside the repository");
  }
  return absolute;
}

function toRepoPath(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

function stableJson(value) {
  return JSON.stringify(sortValue(value));
}

function artifactJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])]),
  );
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isSha256(value) {
  return typeof value === "string" && SHA256.test(value);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fail(errors) {
  console.error("Sandbox image SBOM verification failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  await runCli();
}
