import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const defaultOpenApiPath = "docs/artifacts/management-openapi-0.1.0.json";
const defaultFixturePath =
  "docs/artifacts/management-openapi-compatibility-0.1.0.json";

export async function createManagementOpenApiCompatibilityFixture(
  options = {},
) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const openApiPath = options.openApiPath ?? defaultOpenApiPath;
  const openApiEvidence = await readOpenApiArtifact(repoRoot, openApiPath);
  const operations = extractCompatibleOperations(openApiEvidence.artifact);
  const operationSetSha256 = sha256Text(stableJson(operations));
  return {
    type: "napier.management-openapi-compatibility-fixture",
    schemaVersion: 1,
    openapi: {
      path: openApiEvidence.path,
      sha256: openApiEvidence.sha256,
      routeCount: openApiEvidence.artifact["x-napier-route-count"],
      routeSetSha256: openApiEvidence.artifact["x-napier-route-set-sha256"],
    },
    operationCount: operations.length,
    operationSetSha256,
    operations,
  };
}

export async function verifyManagementOpenApiCompatibilityFixture(
  options = {},
) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const fixturePath = options.fixturePath ?? defaultFixturePath;
  const openApiPath = options.openApiPath ?? defaultOpenApiPath;
  const errors = [];
  const openApiEvidence = await readOpenApiArtifact(
    repoRoot,
    openApiPath,
  ).catch((error) => {
    errors.push(error instanceof Error ? error.message : String(error));
    return undefined;
  });
  const fixtureEvidence = await readJsonEvidence(
    repoRoot,
    fixturePath,
    "management OpenAPI compatibility fixture",
    errors,
  );
  const fixture = fixtureEvidence.value;
  if (fixture) validateCompatibilityFixtureShape(fixture, errors);

  const currentOperations = openApiEvidence
    ? extractCompatibleOperations(openApiEvidence.artifact)
    : [];
  const currentByKey = new Map(
    currentOperations.map((operation) => [operation.key, operation]),
  );
  const fixtureOperations =
    isRecord(fixture) && Array.isArray(fixture.operations)
      ? fixture.operations
      : [];
  const compatibleOperations = [];
  const addedOperations = [];
  for (const operation of fixtureOperations) {
    if (!isRecord(operation) || typeof operation.key !== "string") continue;
    const current = currentByKey.get(operation.key);
    if (!current) {
      errors.push(`operation removed: ${operation.key}`);
      continue;
    }
    const expectedJson = stableJson(operation);
    const currentJson = stableJson(current);
    if (expectedJson !== currentJson) {
      errors.push(`operation changed: ${operation.key}`);
      continue;
    }
    compatibleOperations.push(operation.key);
  }
  const fixtureKeys = new Set(
    fixtureOperations
      .filter(
        (operation) => isRecord(operation) && typeof operation.key === "string",
      )
      .map((operation) => operation.key),
  );
  for (const operation of currentOperations) {
    if (!fixtureKeys.has(operation.key)) addedOperations.push(operation.key);
  }

  return {
    valid: errors.length === 0,
    errors,
    fixturePath: fixtureEvidence.path,
    fixtureSha256: fixtureEvidence.sha256,
    openApiPath:
      openApiEvidence?.path ?? toRepoRelativePath(repoRoot, openApiPath),
    openApiSha256: openApiEvidence?.sha256,
    baselineOperationCount: fixtureOperations.length,
    currentOperationCount: currentOperations.length,
    compatibleOperationCount: compatibleOperations.length,
    addedOperationCount: addedOperations.length,
    addedOperations,
  };
}

export function extractCompatibleOperations(openApi) {
  if (!isRecord(openApi) || !isRecord(openApi.paths)) {
    throw new Error("management OpenAPI artifact paths are invalid");
  }
  const operations = [];
  for (const [openapiPath, pathItem] of Object.entries(openApi.paths)) {
    if (!isRecord(pathItem)) continue;
    for (const method of ["get", "post", "put", "delete", "patch"]) {
      const operation = pathItem[method];
      if (!isRecord(operation)) continue;
      const pathParameters = Array.isArray(operation.parameters)
        ? operation.parameters
            .filter(
              (parameter) =>
                isRecord(parameter) &&
                parameter.in === "path" &&
                typeof parameter.name === "string",
            )
            .map((parameter) => parameter.name)
            .sort()
        : [];
      const responses = isRecord(operation.responses)
        ? Object.keys(operation.responses).sort()
        : [];
      const tags = Array.isArray(operation.tags)
        ? operation.tags.filter((tag) => typeof tag === "string").sort()
        : [];
      const requestContentTypes =
        isRecord(operation.requestBody) &&
        isRecord(operation.requestBody.content)
          ? Object.keys(operation.requestBody.content).sort()
          : [];
      const jsonResponseSchemaRefs = {};
      for (const status of responses) {
        const response = operation.responses[status];
        const schemaRef = isRecord(response)
          ? getJsonSchemaRef(response.content?.["application/json"]?.schema)
          : undefined;
        if (schemaRef) jsonResponseSchemaRefs[status] = schemaRef;
      }
      operations.push({
        key: `${method.toUpperCase()} ${openapiPath}`,
        method,
        path: openapiPath,
        operationId:
          typeof operation.operationId === "string"
            ? operation.operationId
            : "",
        tags,
        pathParameters,
        ...(requestContentTypes.some(
          (contentType) => contentType !== "application/json",
        )
          ? { requestContentTypes }
          : {}),
        acceptsJsonRequestBody:
          requestContentTypes.includes("application/json"),
        jsonRequestSchemaRef:
          getJsonSchemaRef(
            operation.requestBody?.content?.["application/json"]?.schema,
          ) ?? null,
        jsonResponseSchemaRefs,
        responseStatuses: responses,
      });
    }
  }
  operations.sort((left, right) => left.key.localeCompare(right.key));
  if (operations.length === 0) {
    throw new Error("management OpenAPI artifact has no operations");
  }
  return operations;
}

async function runCli() {
  const options = parseCliOptions(process.argv.slice(2));
  if (options.verifyFixturePath) {
    const verification = await verifyManagementOpenApiCompatibilityFixture({
      ...options,
      fixturePath: options.verifyFixturePath,
    });
    if (options.json) {
      console.log(
        JSON.stringify(createVerificationReceipt(verification), null, 2),
      );
    }
    if (!verification.valid) {
      if (!options.json) {
        console.error("Management OpenAPI compatibility verification failed:");
        for (const error of verification.errors) console.error(`- ${error}`);
      }
      process.exitCode = 1;
      return;
    }
    if (!options.json) {
      console.log(
        `Management OpenAPI compatibility verified: ${verification.compatibleOperationCount}/${verification.baselineOperationCount} operations fixture ${verification.fixtureSha256.slice(0, 16)}`,
      );
    }
    return;
  }

  const fixture = await createManagementOpenApiCompatibilityFixture(options);
  if (options.fixturePath) {
    await settleFixtureFile({
      fixture,
      fixturePath: options.fixturePath,
      repoRoot: options.repoRoot ?? defaultRepoRoot,
    });
  }
  if (options.json) console.log(JSON.stringify(fixture, null, 2));
  if (!options.json) {
    const suffix = options.fixturePath ? ` fixture ${options.fixturePath}` : "";
    console.log(
      `Management OpenAPI compatibility fixture generated: ${fixture.operationCount} operations set ${fixture.operationSetSha256.slice(0, 16)}${suffix}`,
    );
  }
}

function createVerificationReceipt(verification) {
  return {
    type: "napier.management-openapi-compatibility-verification",
    schemaVersion: 1,
    valid: verification.valid,
    fixture: {
      path: verification.fixturePath,
      sha256: verification.fixtureSha256,
    },
    openapi: {
      path: verification.openApiPath,
      sha256: verification.openApiSha256,
    },
    baselineOperationCount: verification.baselineOperationCount,
    currentOperationCount: verification.currentOperationCount,
    compatibleOperationCount: verification.compatibleOperationCount,
    addedOperationCount: verification.addedOperationCount,
    addedOperations: verification.addedOperations,
    errors: verification.errors,
  };
}

async function readOpenApiArtifact(repoRoot, openApiPath) {
  const evidence = await readJsonEvidence(
    repoRoot,
    openApiPath,
    "management OpenAPI artifact",
    [],
  );
  if (!evidence.value) {
    throw new Error(`${evidence.path} cannot be read`);
  }
  if (
    !isRecord(evidence.value) ||
    evidence.value.openapi !== "3.1.0" ||
    evidence.value["x-napier-artifact-kind"] !== "management-openapi"
  ) {
    throw new Error(`${evidence.path} is not a management OpenAPI artifact`);
  }
  return {
    path: evidence.path,
    sha256: evidence.sha256,
    artifact: evidence.value,
  };
}

async function readJsonEvidence(repoRoot, inputPath, label, errors) {
  const absolutePath = resolveRepoRelativePath(repoRoot, inputPath, label);
  const relativePath = toRepoRelativePath(repoRoot, absolutePath);
  try {
    const text = await readFile(absolutePath, "utf8");
    return {
      path: relativePath,
      sha256: sha256Text(text),
      value: parseJson(text, label, errors),
    };
  } catch (error) {
    errors.push(`${relativePath} cannot be read`);
    return {
      path: relativePath,
      sha256: sha256Text(""),
      value: undefined,
    };
  }
}

async function settleFixtureFile({ fixture, fixturePath, repoRoot }) {
  const absoluteRepoRoot = path.resolve(repoRoot);
  const absoluteFixturePath = resolveRepoRelativePath(
    absoluteRepoRoot,
    fixturePath,
    "--fixture-path",
  );
  if (!fixture || fixture.operationCount < 1) {
    await rm(absoluteFixturePath, { force: true });
    return;
  }
  await mkdir(path.dirname(absoluteFixturePath), { recursive: true });
  await writeFile(absoluteFixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
}

function validateCompatibilityFixtureShape(fixture, errors) {
  if (
    !isRecord(fixture) ||
    fixture.type !== "napier.management-openapi-compatibility-fixture" ||
    fixture.schemaVersion !== 1 ||
    !isRecord(fixture.openapi) ||
    typeof fixture.openapi.path !== "string" ||
    typeof fixture.openapi.sha256 !== "string" ||
    typeof fixture.openapi.routeSetSha256 !== "string" ||
    !Number.isSafeInteger(fixture.openapi.routeCount) ||
    !Number.isSafeInteger(fixture.operationCount) ||
    typeof fixture.operationSetSha256 !== "string" ||
    !Array.isArray(fixture.operations) ||
    fixture.operations.length !== fixture.operationCount ||
    sha256Text(stableJson(fixture.operations)) !== fixture.operationSetSha256
  ) {
    errors.push("fixture shape is invalid");
    return;
  }
  const keys = new Set();
  for (const operation of fixture.operations) {
    if (
      !isRecord(operation) ||
      typeof operation.key !== "string" ||
      typeof operation.method !== "string" ||
      typeof operation.path !== "string" ||
      typeof operation.operationId !== "string" ||
      !Array.isArray(operation.tags) ||
      !Array.isArray(operation.pathParameters) ||
      !(
        operation.requestContentTypes === undefined ||
        (Array.isArray(operation.requestContentTypes) &&
          operation.requestContentTypes.every(
            (value) => typeof value === "string",
          ))
      ) ||
      typeof operation.acceptsJsonRequestBody !== "boolean" ||
      !(
        operation.jsonRequestSchemaRef === null ||
        typeof operation.jsonRequestSchemaRef === "string"
      ) ||
      !isRecord(operation.jsonResponseSchemaRefs) ||
      !Object.values(operation.jsonResponseSchemaRefs).every(
        (value) => typeof value === "string",
      ) ||
      !Array.isArray(operation.responseStatuses) ||
      keys.has(operation.key)
    ) {
      errors.push("fixture operation shape is invalid");
      return;
    }
    keys.add(operation.key);
  }
}

function parseCliOptions(args) {
  const options = { json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--repo-root") {
      options.repoRoot = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--openapi-path") {
      options.openApiPath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--fixture-path") {
      options.fixturePath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--verify-fixture-path") {
      options.verifyFixturePath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function readCliValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function resolveRepoRelativePath(repoRoot, inputPath, label) {
  const absolutePath = path.resolve(repoRoot, inputPath);
  const relativePath = path.relative(repoRoot, absolutePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must stay inside the repository`);
  }
  return absolutePath;
}

function toRepoRelativePath(repoRoot, filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

function parseJson(text, label, errors) {
  try {
    return JSON.parse(text);
  } catch {
    errors.push(`${label} is not valid JSON`);
    return undefined;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getJsonSchemaRef(schema) {
  return isRecord(schema) && typeof schema.$ref === "string"
    ? schema.$ref
    : undefined;
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
