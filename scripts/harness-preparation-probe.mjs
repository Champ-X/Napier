import fs from "node:fs/promises";
import sqlite from "node:sqlite";
import workerThreads from "node:worker_threads";
import { syncBuiltinESMExports } from "node:module";

// Benchmark-only observers. Production queries and their returned values stay
// unchanged; the worker response carries an extra field ignored by Runtime.
export function installPreparationProbe() {
  const main = installQueryProbe(sqlite.DatabaseSync);
  let worker = empty();
  const BaseWorker = workerThreads.Worker;
  workerThreads.Worker = class extends BaseWorker {
    constructor(source, options) {
      const observed = options?.name === "napier-ledger-reader" && options.eval;
      const prefix = `(${workerProbe.toString()})(${installQueryProbe.toString()}, ${empty.toString()});\n`;
      super(observed ? prefix + source : source, options);
      if (observed) this.on("message", (message) => {
        if (message?.__preparationProfile) add(worker, message.__preparationProfile);
      });
    }
  };
  const originalReadFile = fs.readFile;
  const originalOpen = fs.open;
  let fileReadCalls = 0, fileReadBytes = 0;
  const count = (result) => {
    fileReadCalls++;
    fileReadBytes += typeof result === "string" ? Buffer.byteLength(result) : result.byteLength;
    return result;
  };
  fs.readFile = async (...args) => count(await originalReadFile(...args));
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    const read = handle.readFile.bind(handle);
    handle.readFile = async (...values) => count(await read(...values));
    return handle;
  };
  syncBuiltinESMExports();
  return {
    reset() { main.reset(); worker = empty(); fileReadCalls = 0; fileReadBytes = 0; },
    snapshot() { return { main: main.snapshot(), worker: { ...worker }, fileReadCalls, fileReadBytes }; },
    restore() {
      main.restore(); fs.readFile = originalReadFile; fs.open = originalOpen;
      workerThreads.Worker = BaseWorker; syncBuiltinESMExports();
    },
  };
}

function workerProbe(install, makeEmpty) {
  const { DatabaseSync } = require("node:sqlite");
  const { parentPort } = require("node:worker_threads");
  const probe = install(DatabaseSync, makeEmpty);
  const on = parentPort.on.bind(parentPort);
  const post = parentPort.postMessage.bind(parentPort);
  parentPort.on = (event, listener) => on(event, event === "message" ? (...args) => {
    probe.reset(); return listener(...args);
  } : listener);
  parentPort.postMessage = (message, ...args) => post({ ...message, __preparationProfile: probe.snapshot() }, ...args);
}

function empty() {
  return { sqlQueries: 0, sqlReturnedRows: 0, eventReturnedRows: 0, memoryReturnedRows: 0,
    sqlWallMs: 0, sqlThreadCpuMicros: 0, jsonCalls: 0, jsonCharacters: 0,
    jsonSamples: 0, jsonSampleWallMs: 0, jsonSampleThreadCpuMicros: 0 };
}

function installQueryProbe(DatabaseSync, makeEmpty = empty) {
  if (typeof process.threadCpuUsage !== "function") throw new Error("Profiling requires process.threadCpuUsage");
  let metrics = makeEmpty();
  const originalPrepare = DatabaseSync.prototype.prepare;
  const originalParse = JSON.parse;
  DatabaseSync.prototype.prepare = function (sql, ...args) {
    const statement = originalPrepare.call(this, sql, ...args);
    for (const method of ["all", "get"]) {
      const original = statement[method].bind(statement);
      statement[method] = (...parameters) => {
        const start = performance.now(), cpu = process.threadCpuUsage();
        const result = original(...parameters);
        const elapsed = process.threadCpuUsage(cpu);
        const rows = method === "all" ? result.length : result === undefined ? 0 : 1;
        metrics.sqlQueries++; metrics.sqlReturnedRows += rows;
        metrics.sqlWallMs += performance.now() - start;
        metrics.sqlThreadCpuMicros += elapsed.user + elapsed.system;
        if (/\bledger_events\b/u.test(sql)) metrics.eventReturnedRows += rows;
        if (/\bmemory_search\b/u.test(sql)) metrics.memoryReturnedRows += rows;
        return result;
      };
    }
    return statement;
  };
  JSON.parse = function (value, ...args) {
    metrics.jsonCalls++;
    if (typeof value === "string") metrics.jsonCharacters += value.length;
    if (metrics.jsonCalls % 32 !== 0) return originalParse(value, ...args);
    const start = performance.now(), cpu = process.threadCpuUsage();
    try { return originalParse(value, ...args); }
    finally {
      const elapsed = process.threadCpuUsage(cpu);
      metrics.jsonSamples++;
      metrics.jsonSampleWallMs += performance.now() - start;
      metrics.jsonSampleThreadCpuMicros += elapsed.user + elapsed.system;
    }
  };
  return {
    reset() { metrics = makeEmpty(); }, snapshot() { return { ...metrics }; },
    restore() { DatabaseSync.prototype.prepare = originalPrepare; JSON.parse = originalParse; },
  };
}
function add(target, source) { for (const key of Object.keys(target)) target[key] += source[key]; }
