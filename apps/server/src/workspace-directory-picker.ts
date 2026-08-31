import { execFile } from "node:child_process";
import path from "node:path";

export interface WorkspaceDirectoryPickerResult {
  cancelled: boolean;
  path?: string;
}

export type WorkspaceDirectoryPickerCommand = (
  executable: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>;

/**
 * Open the host operating system's native folder chooser. Napier is a local,
 * single-user application, so the server process is the only layer that can
 * return the absolute path required by the existing workspace rebind API.
 */
export async function pickWorkspaceDirectory(
  platform: NodeJS.Platform = process.platform,
  runCommand: WorkspaceDirectoryPickerCommand = runPickerCommand,
): Promise<WorkspaceDirectoryPickerResult> {
  const command = directoryPickerCommand(platform);
  try {
    const result = await runCommand(command.executable, command.args);
    const selected = result.stdout.replace(/\r?\n$/u, "");
    if (!selected) return { cancelled: true };
    const platformPath = platform === "win32" ? path.win32 : path.posix;
    if (!platformPath.isAbsolute(selected)) {
      throw new Error("Native folder selection returned a non-absolute path");
    }
    return { cancelled: false, path: platformPath.normalize(selected) };
  } catch (error) {
    if (directoryPickerCancelled(platform, error)) return { cancelled: true };
    throw error;
  }
}

export function directoryPickerCommand(platform: NodeJS.Platform): {
  executable: string;
  args: readonly string[];
} {
  if (platform === "darwin") {
    return {
      executable: "/usr/bin/osascript",
      args: [
        "-e",
        'set chosenFolder to choose folder with prompt "Choose a workspace for Napier"',
        "-e",
        "POSIX path of chosenFolder",
      ],
    };
  }
  if (platform === "win32") {
    return {
      executable: path.win32.join(
        process.env["SystemRoot"] ?? "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-STA",
        "-Command",
        [
          "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
          "Add-Type -AssemblyName System.Windows.Forms",
          "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
          "$dialog.Description = 'Choose a workspace for Napier'",
          "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.SelectedPath }",
        ].join("; "),
      ],
    };
  }
  if (platform === "linux") {
    return {
      executable: "/usr/bin/zenity",
      args: [
        "--file-selection",
        "--directory",
        "--title=Choose a workspace for Napier",
      ],
    };
  }
  throw new Error(`Native folder selection is unavailable on ${platform}`);
}

function runPickerCommand(
  executable: string,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      [...args],
      { encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stderr }));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

function directoryPickerCancelled(
  platform: NodeJS.Platform,
  error: unknown,
): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as {
    code?: unknown;
    message?: unknown;
    stderr?: unknown;
  };
  const diagnostic = `${String(record.message ?? "")} ${String(record.stderr ?? "")}`;
  if (/user canceled|user cancelled|-128/iu.test(diagnostic)) return true;
  return platform === "linux" && record.code === 1;
}
