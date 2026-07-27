import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const defaultSourcePath = "apps/server/src/app.ts";
const defaultArtifactPath = "docs/artifacts/management-openapi-0.1.0.json";

export async function generateManagementOpenApi(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const sourcePath = options.sourcePath ?? defaultSourcePath;
  const absoluteSourcePath = resolveRepoRelativePath(
    repoRoot,
    sourcePath,
    "sourcePath",
  );
  const sourceText = await readFile(absoluteSourcePath, "utf8");
  const packageJson = parseJson(
    await readFile(path.join(repoRoot, "package.json"), "utf8"),
    "package.json",
  );
  const routes = extractManagementRoutes(sourceText);
  const routeSetSha256 = sha256Text(
    stableJson(
      routes.map((route) => ({
        method: route.method,
        path: route.openapiPath,
      })),
    ),
  );
  const paths = {};
  for (const route of routes) {
    paths[route.openapiPath] ??= {};
    paths[route.openapiPath][route.method] = createOperation(route);
  }
  const artifact = {
    openapi: "3.1.0",
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    info: {
      title: "Napier Management API",
      version:
        isRecord(packageJson) && typeof packageJson.version === "string"
          ? packageJson.version
          : "0.0.0",
      description:
        "Generated route-level OpenAPI contract for Napier's local management plane. Request and response schemas are intentionally conservative until endpoint-level schemas are promoted.",
    },
    servers: [
      {
        url: "http://127.0.0.1:8787",
        description: "Local Napier API process",
      },
    ],
    paths,
    components: {
      schemas: {
        ErrorResponse: {
          type: "object",
          required: ["error"],
          additionalProperties: false,
          properties: {
            error: { type: "string" },
          },
        },
      },
      responses: {
        ErrorResponse: {
          description: "Fail-closed JSON error response",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
    "x-napier-artifact-kind": "management-openapi",
    "x-napier-source-path": toRepoRelativePath(repoRoot, absoluteSourcePath),
    "x-napier-source-sha256": sha256Text(sourceText),
    "x-napier-route-count": routes.length,
    "x-napier-route-set-sha256": routeSetSha256,
  };
  return {
    artifact,
    artifactText: `${JSON.stringify(artifact, null, 2)}\n`,
    routeCount: routes.length,
    routeSetSha256,
    sourceSha256: artifact["x-napier-source-sha256"],
  };
}

export function extractManagementRoutes(sourceText) {
  const routePattern =
    /app\.(get|post|put|delete|patch)\(\s*(["'`])(\/api\/[^"'`]+)\2/g;
  const routes = [];
  const seen = new Set();
  for (const match of sourceText.matchAll(routePattern)) {
    const method = match[1].toLowerCase();
    const rawPath = match[3];
    const openapiPath = rawPath.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, "{$1}");
    const key = `${method.toUpperCase()} ${openapiPath}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate management route: ${key}`);
    }
    seen.add(key);
    routes.push({
      method,
      rawPath,
      openapiPath,
      operationId: createOperationId(method, openapiPath),
      pathParams: Array.from(openapiPath.matchAll(/\{([^}]+)\}/g)).map(
        (paramMatch) => paramMatch[1],
      ),
      tag: createTag(openapiPath),
    });
  }
  routes.sort((left, right) => {
    const pathOrder = left.openapiPath.localeCompare(right.openapiPath);
    if (pathOrder !== 0) return pathOrder;
    return left.method.localeCompare(right.method);
  });
  const operationIds = new Set();
  for (const route of routes) {
    if (operationIds.has(route.operationId)) {
      throw new Error(`Duplicate management operationId: ${route.operationId}`);
    }
    operationIds.add(route.operationId);
  }
  if (routes.length === 0) {
    throw new Error("No /api management routes were found");
  }
  return routes;
}

async function runCli() {
  const options = parseCliOptions(process.argv.slice(2));
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const artifactPath = resolveRepoRelativePath(
    repoRoot,
    options.artifactPath ?? defaultArtifactPath,
    "artifactPath",
  );
  const generated = await generateManagementOpenApi(options);
  if (options.check) {
    const current = await readFile(artifactPath, "utf8").catch(() => "");
    if (current !== generated.artifactText) {
      console.error(
        `${toRepoRelativePath(repoRoot, artifactPath)} is stale; run npm run write:management-openapi.`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `Management OpenAPI artifact is current: ${generated.routeCount} routes set ${generated.routeSetSha256.slice(0, 16)}`,
    );
    return;
  }
  if (options.json) {
    console.log(generated.artifactText.trimEnd());
    return;
  }
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, generated.artifactText);
  console.log(
    `Wrote ${toRepoRelativePath(repoRoot, artifactPath)}: ${generated.routeCount} routes set ${generated.routeSetSha256.slice(0, 16)}`,
  );
}

function createOperation(route) {
  return {
    operationId: route.operationId,
    tags: [route.tag],
    summary: `${route.method.toUpperCase()} ${route.openapiPath}`,
    ...(route.pathParams.length > 0
      ? {
          parameters: route.pathParams.map((name) => ({
            name,
            in: "path",
            required: true,
            schema: { type: "string" },
          })),
        }
      : {}),
    ...(route.method === "post" ||
    route.method === "put" ||
    route.method === "patch"
      ? {
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: true,
              },
            },
          },
        }
      : {}),
    responses: {
      200: {
        description: "Successful no-store JSON response",
        content: {
          "application/json": {
            schema: true,
          },
        },
      },
      400: { $ref: "#/components/responses/ErrorResponse" },
      404: { $ref: "#/components/responses/ErrorResponse" },
      409: { $ref: "#/components/responses/ErrorResponse" },
      413: { $ref: "#/components/responses/ErrorResponse" },
    },
    "x-napier-source-route": `${route.method.toUpperCase()} ${route.rawPath}`,
  };
}

function createOperationId(method, openapiPath) {
  const suffix = openapiPath
    .replace(/^\/api\/?/, "")
    .replace(/\{([^}]+)\}/g, "by-$1")
    .split("/")
    .filter(Boolean)
    .map((part) => part.replace(/[^A-Za-z0-9]+/g, "-"))
    .filter(Boolean)
    .join("-");
  return `${method}-${suffix || "root"}`;
}

function createTag(openapiPath) {
  const parts = openapiPath.split("/").filter(Boolean);
  if (parts[1] === "receipt-trust") return "receipt-trust";
  if (parts[1] === "threads") return "threads";
  if (parts[1] === "plan-blueprints") return "plan-blueprints";
  return parts[1] ?? "management";
}

function parseCliOptions(args) {
  const options = { check: false, json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--check") {
      options.check = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--repo-root") {
      options.repoRoot = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--source-path") {
      options.sourcePath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--artifact-path") {
      options.artifactPath = readCliValue(args, index, arg);
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

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
