import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function getCodexStatus() {
  try {
    await execFileAsync("codex", ["login", "status"], {
      timeout: 5000,
      maxBuffer: 20000,
    });
    return { cliAvailable: true, authenticated: true, ready: true, message: "Codex ready" };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { cliAvailable: false, authenticated: false, ready: false, message: "Codex CLI not found" };
    }
    return { cliAvailable: true, authenticated: false, ready: false, message: "Codex sign-in required" };
  }
}
