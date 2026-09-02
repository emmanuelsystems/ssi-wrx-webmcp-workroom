import { createServer } from "node:http";
import { getCodexStatus } from "./codexRuntime.mjs";
import { createEpisodeIntakeProposal, streamEpisodeIntakeProposal } from "./episodeIntakeAgent.mjs";
import { streamOrchestrationRun, validateOrchestrationInput } from "./orchestrationAgent.mjs";
import { streamAutopilotRun, validateAutopilotInput } from "./autopilotAgent.mjs";
import { streamNodeConversation, validateNodeConversationInput } from "./nodeConversationAgent.mjs";
import { MAX_SOURCE_FILES, validateSourceManifest } from "../src/episodeSources.js";

const HOST = "127.0.0.1";
const PORT = 8787;
const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const MAX_BODY = 1_200_000;
const MAX_RETAINED_FINISHED_RUNS = 24;
const FINISHED_RUN_TTL_MS = 15 * 60 * 1000;
const runs = new Map();
const consumedLeaseIds = new Set();

function reserveLease(input, action) {
  const leaseId = input?.workLease?.id;
  if (!leaseId) throw new Error("Work Lease is required.");
  if (consumedLeaseIds.has(leaseId)) throw new Error("Work Lease was already used.");
  if (input.workLease.action !== action) throw new Error("Work Lease does not permit this run.");
  consumedLeaseIds.add(leaseId);
}

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
  const record = { ...event, occurredAt: new Date().toISOString() };
  run.events.push(record);
  for (const response of run.subscribers) response.write(`data: ${JSON.stringify(record)}\n\n`);
}

function closeSubscribers(run) {
  for (const response of run.subscribers) response.end();
  run.subscribers.clear();
}

function pruneRuns(now = Date.now()) {
  const finished = [...runs.values()]
    .filter((run) => run.done)
    .sort((left, right) => (left.finishedAt ?? 0) - (right.finishedAt ?? 0));
  const expired = finished.filter((run) => now - (run.finishedAt ?? now) > FINISHED_RUN_TTL_MS);
  const overflow = finished.slice(0, Math.max(0, finished.length - MAX_RETAINED_FINISHED_RUNS));
  for (const run of new Set([...expired, ...overflow])) runs.delete(run.id);
}

function finishRun(run, event) {
  if (run.done) return;
  run.done = true;
  run.status = event.type;
  run.finishedAt = Date.now();
  emit(run, event);
  closeSubscribers(run);
  pruneRuns();
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
  const sources = input.sources ?? [];
  if (!Array.isArray(sources) || sources.length > MAX_SOURCE_FILES) throw new Error(`A maximum of ${MAX_SOURCE_FILES} source files is allowed.`);
  const manifestValidation = validateSourceManifest(sources);
  if (!manifestValidation.valid) throw new Error(manifestValidation.error);
  if (sources.some((source) => typeof source.text !== "string" || source.text.length === 0 || source.text.length > 80_000)) throw new Error("Each source must include bounded extracted text.");
  if (input.sourceConsentRequired && input.sourceConsent !== true) throw new Error("Source consent is required before Codex analysis.");
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
      pruneRuns();
      const run = { id: crypto.randomUUID(), input, events: [], subscribers: new Set(), controller: new AbortController(), done: false, status: "running", startedAt: Date.now() };
      runs.set(run.id, run);
      void streamEpisodeIntakeProposal({ input, repoRoot: REPO_ROOT, signal: run.controller.signal, onEvent: (event) => emit(run, event) })
        .then((result) => finishRun(run, { type: "completed", proposal: result.proposal, threadId: result.threadId, usage: result.usage }))
        .catch((error) => finishRun(run, { type: error.name === "AbortError" ? "cancelled" : "error", message: error.name === "AbortError" ? "Analysis cancelled. No proposal changes were applied." : (error.message || "Codex analysis failed.") }));
      sendJson(response, 202, { runId: run.id });
      return;
    }
    if (request.method === "POST" && request.url === "/api/codex/orchestration/start") {
      const input = await readJson(request);
      if (input.approved !== true) throw new Error("Human approval is required before orchestration can run.");
      validateOrchestrationInput(input);
      reserveLease(input, "orchestration");
      pruneRuns();
      const retainedInput = {
        episodeId: input.episodeId,
        nodeId: input.nodeId,
        plan: input.plan,
        sourceIds: (input.sources ?? []).map((source) => source.sourceId),
      };
      const run = { id: crypto.randomUUID(), kind: "orchestration", input: retainedInput, outputs: [], events: [], subscribers: new Set(), controller: new AbortController(), done: false, status: "queued", startedAt: Date.now() };
      runs.set(run.id, run);
      emit(run, { type: "run", status: "queued", label: "Orchestration queued" });
      void streamOrchestrationRun({ input, repoRoot: REPO_ROOT, signal: run.controller.signal, onEvent: (event) => {
        if (event.type === "task" && event.status === "complete" && event.output) run.outputs.push(event.output);
        emit(run, event);
      } })
        .then((result) => finishRun(run, { type: "completed", outputs: result.outputs }))
        .catch((error) => finishRun(run, { type: error.name === "AbortError" ? "cancelled" : "error", outputs: run.outputs, message: error.name === "AbortError" ? "Orchestration cancelled. Completed artifacts remain visible." : (error.message || "Orchestration failed.") }));
      sendJson(response, 202, { runId: run.id });
      return;
    }
    if (request.method === "POST" && request.url === "/api/codex/node-conversation/start") {
      const input = await readJson(request);
      validateNodeConversationInput(input);
      pruneRuns();
      const run = { id: crypto.randomUUID(), kind: "node-conversation", input: { episodeId: input.episodeId, nodeId: input.nodeId }, events: [], subscribers: new Set(), controller: new AbortController(), done: false, status: "queued", startedAt: Date.now() };
      runs.set(run.id, run);
      emit(run, { type: "status", label: "Codex queued" });
      void streamNodeConversation({ input, repoRoot: REPO_ROOT, signal: run.controller.signal, onEvent: (event) => emit(run, event) })
        .then((result) => finishRun(run, { type: "completed", response: result.response, threadId: result.threadId }))
        .catch((error) => finishRun(run, { type: error.name === "AbortError" ? "cancelled" : "error", message: error.name === "AbortError" ? "Node conversation cancelled." : (error.message || "Codex node response failed.") }));
      sendJson(response, 202, { runId: run.id });
      return;
    }
    if (request.method === "POST" && request.url === "/api/codex/autopilot/start") {
      const input = await readJson(request);
      validateAutopilotInput(input);
      reserveLease(input, "analysis");
      pruneRuns();
      const retainedInput = { episodeId: input.episodeId, sourceIds: (input.sources ?? []).map((source) => source.sourceId) };
      const run = { id: crypto.randomUUID(), kind: "autopilot", input: retainedInput, outputs: [], draftPlan: null, finalPackage: null, events: [], subscribers: new Set(), controller: new AbortController(), done: false, status: "queued", startedAt: Date.now() };
      runs.set(run.id, run);
      emit(run, { type: "run", status: "queued", label: "Autopilot episode run queued" });
      void streamAutopilotRun({ input, repoRoot: REPO_ROOT, signal: run.controller.signal, onEvent: (event) => {
        if (event.type === "draft-plan") run.draftPlan = event.plan;
        if (event.type === "final-package") run.finalPackage = event.package;
        if (event.type === "task" && event.status === "complete" && event.output) run.outputs.push(event.output);
        emit(run, event);
      } })
        .then((result) => finishRun(run, { type: "completed", draftPlan: result.draftPlan, outputs: result.outputs, finalPackage: result.finalPackage, turns: result.turns }))
        .catch((error) => finishRun(run, { type: error.name === "AbortError" ? "cancelled" : "error", draftPlan: run.draftPlan, outputs: run.outputs, finalPackage: run.finalPackage, message: error.name === "AbortError" ? "Autopilot cancelled. Completed artifacts remain visible." : (error.message || "Autopilot failed.") }));
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
      const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 10_000);
      request.on("close", () => {
        clearInterval(heartbeat);
        run.subscribers.delete(response);
      });
      return;
    }
    if (request.method === "DELETE" && request.url.startsWith("/api/codex/runs/")) {
      const run = runs.get(request.url.split("/").at(-1));
      if (!run) { sendJson(response, 404, { ok: false, message: "Run not found" }); return; }
      if (!run.done) run.controller.abort();
      sendJson(response, run.done ? 200 : 202, { ok: true, status: run.status });
      return;
    }
    sendJson(response, 404, { ok: false, message: "Not found" });
  } catch (error) {
    sendJson(response, error.message === "Codex sign-in required" ? 401 : 400, { ok: false, message: error.message || "Local Codex runtime failed." });
  }
});

server.listen(PORT, HOST, () => console.log(`Local Codex runtime listening at http://${HOST}:${PORT}`));
