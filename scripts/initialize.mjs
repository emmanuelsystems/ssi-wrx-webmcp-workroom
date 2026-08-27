import { execFile } from "node:child_process";
import { spawn } from "node:child_process";

const host = "127.0.0.1";
const port = 5173;
const url = `http://${host}:${port}/`;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const server = spawn(
  npmCommand,
  ["run", "dev", "--", "--host", host],
  {
    stdio: "inherit",
  },
);

function openBrowser(targetUrl) {
  if (process.platform === "darwin") {
    execFile("open", [targetUrl]);
    return;
  }

  if (process.platform === "win32") {
    execFile("cmd", ["/c", "start", "", targetUrl]);
    return;
  }

  execFile("xdg-open", [targetUrl]);
}

async function waitForServer(timeoutMs = 30000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error(`Timed out waiting for Vite at ${url}`);
}

try {
  await waitForServer();
  openBrowser(url);
  console.log(`\nSSI-WRX Workroom is ready at ${url}`);
  console.log("Keep this terminal open while using the workroom.");
} catch (error) {
  console.error(error.message);
  server.kill();
  process.exitCode = 1;
}

function stop() {
  server.kill("SIGTERM");
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
