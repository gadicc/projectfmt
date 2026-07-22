import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { env } from "node:process";

export interface CommandResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export async function runCommand(
  command: string,
  args: readonly string[],
  options: { cwd: string; input?: string },
): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    let settled = false;
    const settle = <T>(callback: (value: T) => void, value: T): void => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    child.stdout.on("data", (chunk: Uint8Array) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Uint8Array) => stderr.push(chunk));
    child.once("error", (error) => settle(reject, error));
    const handleStdinError = (error: unknown): void => {
      if (isClosingStdinError(error)) return;
      settle(reject, error);
    };
    // Keep this sink for the stream's full lifetime: stdin may report a late
    // EPIPE even after the child has emitted close and resolved the promise.
    child.stdin.on("error", handleStdinError);
    child.once("close", (code, signal) => {
      settle(resolve, {
        code,
        signal,
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
      });
    });
    try {
      child.stdin.end(options.input ?? "");
    } catch (error) {
      handleStdinError(error);
    }
  });
}

function isClosingStdinError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = (error as { code?: unknown }).code;
  return code === "EPIPE" || code === "ERR_STREAM_DESTROYED";
}
