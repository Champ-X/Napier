export const NODE_DEBUGGER_SOURCE_MAP_CONTROLLER_SOURCE = String.raw`
const MAX_SOURCE_MAP_MAPPINGS = 8192;
const BASE64_VALUES =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const PROGRAM_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".mts",
  ".cts",
]);
const SOURCE_EXTENSIONS = new Set([...PROGRAM_EXTENSIONS, ".jsx", ".tsx"]);

function validateLaunch(argumentsValue) {
  if (
    !exactRecord(argumentsValue, [
      "program",
      "workspaceRoot",
      "sourcePath",
      "sourceSha256",
      "programPath",
      "programSha256",
      "sourceMapPath",
      "sourceMapSha256",
      "args",
    ]) ||
    !visibleString(argumentsValue.program, 2_000) ||
    !path.isAbsolute(argumentsValue.program) ||
    !visibleString(argumentsValue.workspaceRoot, 2_000) ||
    !path.isAbsolute(argumentsValue.workspaceRoot) ||
    !visibleString(argumentsValue.sourcePath, 500) ||
    path.isAbsolute(argumentsValue.sourcePath) ||
    !/^[a-f0-9]{64}$/.test(argumentsValue.sourceSha256) ||
    !visibleString(argumentsValue.programPath, 500) ||
    path.isAbsolute(argumentsValue.programPath) ||
    !/^[a-f0-9]{64}$/.test(argumentsValue.programSha256) ||
    ((argumentsValue.sourceMapPath === undefined) !==
      (argumentsValue.sourceMapSha256 === undefined)) ||
    (argumentsValue.sourceMapPath !== undefined &&
      (!visibleString(argumentsValue.sourceMapPath, 500) ||
        path.isAbsolute(argumentsValue.sourceMapPath) ||
        !/^[a-f0-9]{64}$/.test(argumentsValue.sourceMapSha256))) ||
    !Array.isArray(argumentsValue.args) ||
    argumentsValue.args.length > 16 ||
    argumentsValue.args.some((argument) => !visibleString(argument, 500))
  ) {
    throw new Error("Launch arguments are invalid");
  }
  const root = fs.realpathSync(argumentsValue.workspaceRoot);
  const program = fs.realpathSync(argumentsValue.program);
  const sourceTarget = fs.realpathSync(
    path.resolve(root, argumentsValue.sourcePath),
  );
  if (
    root !== path.resolve(argumentsValue.workspaceRoot) ||
    program !== path.resolve(argumentsValue.program) ||
    !inside(program, root) ||
    path.relative(root, program) !== argumentsValue.programPath ||
    !inside(sourceTarget, root) ||
    path.relative(root, sourceTarget) !== argumentsValue.sourcePath ||
    !PROGRAM_EXTENSIONS.has(path.extname(program).toLowerCase())
  ) {
    throw new Error("Launch target is outside the bound workspace");
  }
  const sourceMapMode =
    argumentsValue.sourceMapPath === undefined ? "none" : "external";
  if (
    !SOURCE_EXTENSIONS.has(path.extname(sourceTarget).toLowerCase()) ||
    (sourceMapMode === "none" &&
      (!PROGRAM_EXTENSIONS.has(path.extname(sourceTarget).toLowerCase()) ||
        sourceTarget !== program ||
        argumentsValue.sourcePath !== argumentsValue.programPath ||
        argumentsValue.sourceSha256 !== argumentsValue.programSha256))
  ) {
    throw new Error("Launch source binding is invalid");
  }
  const source = readBoundFile(sourceTarget, argumentsValue.sourceSha256);
  const programSource =
    sourceTarget === program
      ? source
      : readBoundFile(program, argumentsValue.programSha256);
  let sourceMapTarget;
  let sourceMapText;
  let sourceMapBinding;
  if (sourceMapMode === "external") {
    sourceMapTarget = fs.realpathSync(
      path.resolve(root, argumentsValue.sourceMapPath),
    );
    if (
      !inside(sourceMapTarget, root) ||
      path.relative(root, sourceMapTarget) !== argumentsValue.sourceMapPath ||
      path.extname(sourceMapTarget).toLowerCase() !== ".map" ||
      sourceMapTarget === sourceTarget ||
      sourceMapTarget === program ||
      sourceTarget === program
    ) {
      throw new Error("Launch source-map path binding is invalid");
    }
    sourceMapText = readBoundFile(
      sourceMapTarget,
      argumentsValue.sourceMapSha256,
    );
    sourceMapBinding = parseSourceMapBinding({
      root,
      sourceTarget,
      source: source.toString("utf8"),
      program,
      programSource: programSource.toString("utf8"),
      sourceMapTarget,
      sourceMapText: sourceMapText.toString("utf8"),
    });
  }
  return {
    ...argumentsValue,
    program,
    workspaceRoot: root,
    sourceTarget,
    source: source.toString("utf8"),
    programSource: programSource.toString("utf8"),
    sourceMapMode,
    ...(sourceMapTarget
      ? {
          sourceMapTarget,
          sourceMapText: sourceMapText.toString("utf8"),
          sourceMap: sourceMapBinding.sourceMap,
          sourceMapEntries: sourceMapBinding.entries,
          sourceMapSourceName: sourceMapBinding.sourceName,
        }
      : {}),
  };
}

function readBoundFile(target, expectedSha256) {
  const info = fs.statSync(target);
  if (!info.isFile() || info.size > MAX_SOURCE_BYTES) {
    throw new Error("Launch target exceeds its source boundary");
  }
  const value = fs.readFileSync(target);
  if (
    value.byteLength > MAX_SOURCE_BYTES ||
    crypto.createHash("sha256").update(value).digest("hex") !== expectedSha256
  ) {
    throw new Error("Launch target does not match its source binding");
  }
  new TextDecoder("utf-8", { fatal: true }).decode(value);
  return value;
}

function parseSourceMapBinding(input) {
  let payload;
  try {
    payload = JSON.parse(input.sourceMapText);
  } catch {
    throw new Error("Source map is not valid JSON");
  }
  if (
    !exactRecord(payload, [
      "version",
      "file",
      "sourceRoot",
      "sources",
      "sourcesContent",
      "names",
      "mappings",
    ]) ||
    payload.version !== 3 ||
    payload.file !== path.basename(input.program) ||
    (payload.sourceRoot !== undefined && payload.sourceRoot !== "") ||
    !Array.isArray(payload.sources) ||
    payload.sources.length !== 1 ||
    !visibleString(payload.sources[0], 500) ||
    path.isAbsolute(payload.sources[0]) ||
    !Array.isArray(payload.names) ||
    payload.names.length > 256 ||
    payload.names.some((name) => !visibleString(name, 200)) ||
    typeof payload.mappings !== "string" ||
    payload.mappings.length < 1 ||
    payload.mappings.length > 512 * 1024 ||
    !/^[A-Za-z0-9+/;,]+$/.test(payload.mappings) ||
    (payload.sourcesContent !== undefined &&
      (!Array.isArray(payload.sourcesContent) ||
        payload.sourcesContent.length !== 1 ||
        (payload.sourcesContent[0] !== null &&
          payload.sourcesContent[0] !== input.source)))
  ) {
    throw new Error("Source map payload is unsupported");
  }
  const mappedSource = fs.realpathSync(
    path.resolve(path.dirname(input.sourceMapTarget), payload.sources[0]),
  );
  if (
    mappedSource !== input.sourceTarget ||
    path.resolve(mappedSource) !==
      path.resolve(path.dirname(input.sourceMapTarget), payload.sources[0]) ||
    !inside(mappedSource, input.root)
  ) {
    throw new Error("Source map source escapes its bound file");
  }
  const directives = [
    ...input.programSource.matchAll(
      /\/\/[#@]\s*sourceMappingURL=([^\s]+)\s*$/gm,
    ),
  ];
  if (
    directives.length !== 1 ||
    !directives[0][1] ||
    path.resolve(path.dirname(input.program), directives[0][1]) !==
      input.sourceMapTarget
  ) {
    throw new Error("Program sourceMappingURL does not bind the source map");
  }
  const entries = decodeSourceMapMappings(
    payload,
    input.source.split("\n").length,
    input.programSource.split("\n").length,
  );
  let sourceMap;
  try {
    sourceMap = new SourceMap(payload);
  } catch {
    throw new Error("Source map payload is invalid");
  }
  return {
    sourceMap,
    entries,
    sourceName: payload.sources[0],
  };
}

function decodeSourceMapMappings(payload, sourceLineCount, programLineCount) {
  const entries = [];
  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let nameIndex = 0;
  const generatedLines = payload.mappings.split(";");
  if (generatedLines.length > programLineCount) {
    throw new Error("Source map exceeds the generated program");
  }
  for (
    let generatedLine = 0;
    generatedLine < generatedLines.length;
    generatedLine += 1
  ) {
    let generatedColumn = 0;
    const line = generatedLines[generatedLine];
    if (!line) continue;
    for (const segment of line.split(",")) {
      const values = decodeVlqSegment(segment);
      if (values.length !== 1 && values.length !== 4 && values.length !== 5) {
        throw new Error("Source map segment is unsupported");
      }
      if (values[0] < 0) {
        throw new Error("Source map generated columns are invalid");
      }
      generatedColumn += values[0];
      if (!Number.isSafeInteger(generatedColumn) || generatedColumn > 100_000) {
        throw new Error("Source map generated columns are invalid");
      }
      if (values.length === 1) continue;
      sourceIndex += values[1];
      originalLine += values[2];
      originalColumn += values[3];
      if (values.length === 5) nameIndex += values[4];
      if (
        !Number.isSafeInteger(sourceIndex) ||
        sourceIndex !== 0 ||
        !Number.isSafeInteger(originalLine) ||
        originalLine < 0 ||
        originalLine >= sourceLineCount ||
        !Number.isSafeInteger(originalColumn) ||
        originalColumn < 0 ||
        originalColumn > 100_000 ||
        (values.length === 5 &&
          (!Number.isSafeInteger(nameIndex) ||
            nameIndex < 0 ||
            nameIndex >= payload.names.length)) ||
        entries.length >= MAX_SOURCE_MAP_MAPPINGS
      ) {
        throw new Error("Source map mapping is out of bounds");
      }
      entries.push({
        generatedLine,
        generatedColumn,
        originalLine,
        originalColumn,
      });
    }
  }
  if (entries.length < 1) {
    throw new Error("Source map has no usable mappings");
  }
  return entries;
}

function decodeVlqSegment(segment) {
  if (!segment) throw new Error("Source map segment is empty");
  const values = [];
  let value = 0;
  let shift = 0;
  for (const character of segment) {
    const digit = BASE64_VALUES.indexOf(character);
    if (digit < 0) throw new Error("Source map segment is invalid");
    value += (digit % 32) * 2 ** shift;
    if (!Number.isSafeInteger(value) || shift > 45) {
      throw new Error("Source map segment is out of bounds");
    }
    if (digit < 32) {
      values.push(value % 2 === 1 ? -Math.floor(value / 2) : value / 2);
      value = 0;
      shift = 0;
    } else {
      shift += 5;
    }
  }
  if (shift !== 0) throw new Error("Source map segment is incomplete");
  return values;
}

function frameLocation(frame) {
  const url =
    typeof frame.url === "string" && frame.url
      ? frame.url
      : scriptUrls.get(frame.location && frame.location.scriptId);
  if (!launch || typeof url !== "string" || !url.startsWith("file:")) {
    return undefined;
  }
  try {
    const absolute = fileURLToPath(url);
    if (!inside(absolute, launch.workspaceRoot)) return undefined;
    if (activeSourceMap && absolute === launch.program) {
      const origin = activeSourceMap.findOrigin(
        frame.location.lineNumber + 1,
        frame.location.columnNumber + 1,
      );
      if (
        !origin ||
        origin.fileName !== sourceMapSourceName ||
        !Number.isSafeInteger(origin.lineNumber) ||
        origin.lineNumber < 1 ||
        origin.lineNumber > sourceLines ||
        !Number.isSafeInteger(origin.columnNumber) ||
        origin.columnNumber < 1 ||
        origin.columnNumber > 100_000
      ) {
        return undefined;
      }
      return {
        source: {
          name: path.basename(launch.sourcePath),
          path: launch.sourcePath,
          sourceReference: 0,
        },
        line: origin.lineNumber,
        column: origin.columnNumber,
      };
    }
    const relative = path.relative(launch.workspaceRoot, absolute);
    return {
      source: {
        name: path.basename(relative),
        path: relative,
        sourceReference: 0,
      },
      line: frame.location.lineNumber + 1,
      column: frame.location.columnNumber + 1,
    };
  } catch {
    return undefined;
  }
}

function generatedLocationForBreakpoint(breakpoint) {
  if (!activeSourceMap) {
    return {
      lineNumber: breakpoint.line - 1,
      columnNumber: (breakpoint.column || 1) - 1,
    };
  }
  const candidates = sourceMapEntries
    .filter((entry) => entry.originalLine === breakpoint.line - 1)
    .sort(
      (left, right) =>
        left.originalColumn - right.originalColumn ||
        left.generatedLine - right.generatedLine ||
        left.generatedColumn - right.generatedColumn,
    );
  if (candidates.length < 1) {
    throw new Error("Source-map breakpoint has no generated location");
  }
  const requestedColumn = (breakpoint.column || 1) - 1;
  const selected =
    candidates.find((entry) => entry.originalColumn >= requestedColumn) ||
    candidates[candidates.length - 1];
  return {
    lineNumber: selected.generatedLine,
    columnNumber: selected.generatedColumn,
  };
}
`;
