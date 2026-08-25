import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeBenchmarkCasFile(
  filePath: string,
  content: string,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      String(error.code) !== "EEXIST" ||
      (await readFile(filePath, "utf8")) !== content
    ) {
      throw error;
    }
  }
}
