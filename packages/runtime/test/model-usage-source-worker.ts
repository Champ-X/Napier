import { readFile, writeFile } from "node:fs/promises";
import { ModelUsageReceiptSpool } from "../src/model-usage-source.js";

const [filename, inputPath, mode, readyPath] = process.argv.slice(2);
if (!filename || !inputPath || !mode)
  throw new Error("Usage source worker arguments missing");
const { attribution, observation } = JSON.parse(
  await readFile(inputPath, "utf8"),
);
const source = await ModelUsageReceiptSpool.open(filename);
const reserved = source.reserve(attribution);
if (mode === "reserve_then_wait") {
  await writeFile(readyPath!, "reserved");
  setInterval(() => undefined, 1_000);
} else {
  const recorded = source.record(observation);
  if (mode === "record_then_wait") {
    await writeFile(readyPath!, "recorded");
    setInterval(() => undefined, 1_000);
  } else {
    source.close();
    process.stdout.write(JSON.stringify({ reserved, recorded }));
  }
}
