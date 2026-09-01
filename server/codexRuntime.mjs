import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function classifyCodexStatus({ error, stdout = "", stderr = "" } = {}) {
  if (error?.code === "ENOENT") {
    return { state: "cli-unavailable", cliAvailable: false, authenticated: false, ready: false, message: "Codex CLI not found" };
  }

  if (!error) {
    return { state: "ready", cliAvailable: true, authenticated: true, ready: true, message: "Codex ready" };
  }

  const output = `${stdout}\n${stderr}\n${error.message ?? ""}`.toLowerCase();
  if (/not logged|not authenticated|sign.?in|login required|log in/.test(output)) {
    return { state: "authentication-required", cliAvailable: true, authenticated: false, ready: false, message: "Codex sign-in required" };
  }

  return { state: "runtime-unavailable", cliAvailable: true, authenticated: false, ready: false, message: "Codex status unavailable" };
}

export async function getCodexStatus() {
  try {
    const result = await execFileAsync("codex", ["login", "status"], {
      timeout: 5000,
      maxBuffer: 20000,
    });
    return classifyCodexStatus(result);
  } catch (error) {
    return classifyCodexStatus(error);
  }
}
