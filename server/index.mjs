import { createServer } from "node:http";
import { getCodexStatus } from "./codexRuntime.mjs";
import { createEpisodeIntakeProposal, streamEpisodeIntakeProposal } from "./episodeIntakeAgent.mjs";

const HOST = "127.0.0.1";
const PORT = 8787;
const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const MAX_BODY = 30_000;
const runs = new Map();

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) reject(new Error("Request is too large."));
    });
    request.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); } catch { reject(new Error("Request must be valid JSON.")); }
    });
    request.on("error", reject);
  });
}

function emit(run, event) {
  run.events.push({ ...event, occurredAt: new Date().toISOString() });
  for (const response of run.subscribers) response.write(`data: ${JSON.stringify(run.events.at(-1))}\n\n`);
}

function runIdFromUrl(url) {
  return url.split("/").filter(Boolean).at(-2);
}

function validateInput(input) {
  const fields = ["episodeId", "episodeName", "objective", "context"];
  for (const field of fields) {
    if (typeof input?.[field] !== "string" || (field !== "context" && !input[field].trim())) throw new Error(`${field} is required.`);
    if (input[field].length > 12_000) throw new Error(`${field} is too long.`);
  }
  if (input.threadId !== undefined && input.threadId !== null && (typeof input.threadId !== "string" || input.threadId.length > 300)) throw new Error("threadId is invalid.");
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/api/codex/status") {
      sendJson(response, 200, await getCodexStatus());
      return;
    }
    if (request.method === "POST" && request.url === "/api/codex/episode-intake") {
      const input = await readJson(request);
      validateInput(input);
      const result = await createEpisodeIntakeProposal({ input, repoRoot: REPO_ROOT });
      sendJson(response, 200, { ok: true, ...result });
      return;
    }
    if (request.method === "POST" && request.url === "/api/codex/episode-intake/start") {
      const input = await readJson(request);
      validateInput(input);
      const run = { id: crypto.randomUUID(), input, events: [], subscribers: new Set(), controller: new AbortController(), done: false };
      runs.set(run.id, run);
      void streamEpisodeIntakeProposal({ input, repoRoot: REPO_ROOT, signal: run.controller.signal, onEvent: (event) => emit(run, event) })
        .then((result) => { emit(run, { type: "completed", proposal: result.proposal, threadId: result.threadId, usage: result.usage }); run.done = true; closeSubscribers(run); })
        .catch((error) => { emit(run, { type: error.name === "AbortError" ? "cancelled" : "error", message: error.name === "AbortError" ? "Analysis cancelled. No proposal changes were applied." : (error.message || "Codex analysis failed.") }); run.done = true; closeSubscribers(run); });
      sendJson(response, 202, { runId: run.id });
      return;
    }
    if (request.method === "GET" && request.url.startsWith("/api/codex/runs/") && request.url.endsWith("/events")) {
      const run = runs.get(runIdFromUrl(request.url));
      if (!run) { sendJson(response, 404, { ok: false, message: "Run not found" }); return; }
      response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
      for (const event of run.events) response.write(`data: ${JSON.stringify(event)}\n\n`);
      if (run.done) { response.end(); return; }
      run.subscribers.add(response);
      request.on("close", () => run.subscribers.delete(response));
      return;
    }
    if (request.method === "DELETE" && request.url.startsWith("/api/codex/runs/")) {
      const run = runs.get(request.url.split("/").at(-1));
      if (!run) { sendJson(response, 404, { ok: false, message: "Run not found" }); return; }
      run.controller.abort();
      sendJson(response, 202, { ok: true });
      return;
    }
    sendJson(response, 404, { ok: false, message: "Not found" });
  } catch (error) {
    sendJson(response, error.message === "Codex sign-in required" ? 401 : 400, { ok: false, message: error.message || "Local Codex runtime failed." });
  }
});

function closeSubscribers(run) {
  for (const response of run.subscribers) response.end();
  run.subscribers.clear();
}

server.listen(PORT, HOST, () => console.log(`Local Codex runtime listening at http://${HOST}:${PORT}`));
