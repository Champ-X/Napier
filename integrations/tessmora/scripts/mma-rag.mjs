#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fetchReferenceImage } from "./reference-image.mjs";

if (process.argv[2] === "image" && process.argv[3] === "fetch") {
  try {
    const data = await fetchReferenceImage(process.argv.slice(4));
    console.log(
      JSON.stringify({
        ok: true,
        schema_version: "1",
        command: "image.fetch",
        data,
      }),
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        ok: false,
        schema_version: "1",
        error: {
          code: "IMAGE_FETCH_FAILED",
          message: error.message,
        },
      }),
    );
    process.exitCode = 4;
  }
} else {
  // Napier's run_command accepts Node argv. Keep all API behavior in the
  // upstream CLI and resolve its location independently of the caller's cwd.
  const result = spawnSync(
    "python3",
    [
      fileURLToPath(new URL("./mma_rag_cli.py", import.meta.url)),
      ...process.argv.slice(2),
    ],
    { stdio: "inherit" },
  );

  if (result.error) {
    console.log(
      JSON.stringify({
        ok: false,
        schema_version: "1",
        error: {
          code: "CLI_LAUNCH_FAILED",
          message:
            "Could not launch the Tessmora CLI; check Python 3 availability.",
        },
      }),
    );
    process.exitCode = 3;
  } else {
    process.exitCode = result.status ?? 1;
  }
}
