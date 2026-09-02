import assert from "node:assert/strict";
import test from "node:test";

import {
  applyOrchestrationEvent,
  mapOrchestrationArtifacts,
  selectOrchestrationTasks,
  validateOrchestrationTaskOutput,
} from "../src/orchestration.js";
import { validateOrchestrationInput } from "../server/orchestrationAgent.mjs";
import { createAgentRoute, createWorkLease } from "../src/governance.js";

const plan = {
  tasks: [
    { id: "analysis", title: "Analyze", role: "Analysis specialist" },
    { id: "synthesis", title: "Synthesize", role: "Synthesis specialist" },
    { id: "review", title: "Review", role: "Independent reviewer" },
    { id: "extra", title: "Extra", role: "Unused" },
  ],
};

const output = (taskId, sourceIds = ["source-1"]) => ({
  taskId,
  role: "Analysis specialist",
  summary: "Bounded finding.",
  findings: ["Supported finding."],
  evidenceSourceIds: sourceIds,
  assumptions: ["Assumption."],
  unresolvedQuestions: ["Question?"],
  recommendedNextStep: "Ask a human to review.",
});

const leaseEpisode = { id: "E0-001", projectId: "project-1", governance: { baseline: { id: "baseline-1", projectStateId: "state-1" }, ownerName: "Owner" } };
const leaseRoute = createAgentRoute({ role: "First Mate coordinator" });
const workLease = createWorkLease({ episode: leaseEpisode, agentRoute: leaseRoute, objective: "Analyze", action: "orchestration" });

test("selects at most three specialist turns and keeps two-task plans", () => {
  assert.deepEqual(selectOrchestrationTasks(plan).map((task) => task.id), ["analysis", "synthesis", "review"]);
  assert.deepEqual(selectOrchestrationTasks({ tasks: [plan.tasks[0], plan.tasks[2]] }).map((task) => task.id), ["analysis", "review"]);
});

test("validates structured specialist output and source citations", () => {
  assert.equal(validateOrchestrationTaskOutput(output("analysis"), "analysis", ["source-1"]).valid, true);
  assert.equal(validateOrchestrationTaskOutput(output("analysis", ["missing"]), "analysis", ["source-1"]).valid, false);
  assert.equal(validateOrchestrationTaskOutput({ ...output("analysis"), summary: "" }, "analysis", ["source-1"]).valid, false);
});

test("validates approved runtime input without retaining source text", () => {
  const result = validateOrchestrationInput({
    approved: true,
    episodeId: "E0-001",
    nodeId: "inquiry",
    episodeName: "Episode",
    objective: "Understand the work.",
    context: "Bounded context.",
    node: { id: "inquiry", kind: "inquiry" },
    threads: [],
    sources: [{ sourceId: "source-1", fileName: "notes.txt", text: "Local source text." }],
    plan,
    baseline: leaseEpisode.governance.baseline,
    projectState: { id: "state-1" },
    workLease,
  });
  assert.deepEqual(result.sourceIds, ["source-1"]);
  assert.doesNotThrow(() => validateOrchestrationInput({
    episodeId: "E0-001",
    nodeId: "inquiry",
    episodeName: "Episode",
    objective: "Understand the work.",
    context: "",
    node: { id: "inquiry", kind: "inquiry" },
    threads: [],
    sources: [],
    plan,
    baseline: leaseEpisode.governance.baseline,
    projectState: { id: "state-1" },
    workLease,
  }));
  assert.throws(() => validateOrchestrationInput({ episodeId: "E0-001", nodeId: "inquiry", objective: "Understand", context: "Context", node: {}, plan: {}, sources: [] }), /two or three runnable specialist tasks/);
});

test("transitions queued, working, complete, and cancelled run state", () => {
  let state = { status: "queued", taskStates: {}, taskOutputs: [], events: [] };
  state = applyOrchestrationEvent(state, { type: "task", taskId: "analysis", status: "working" });
  assert.equal(state.taskStates.analysis, "Working");
  state = applyOrchestrationEvent(state, { type: "task", taskId: "analysis", status: "complete", output: output("analysis") });
  assert.equal(state.taskStates.analysis, "Complete");
  assert.equal(state.taskOutputs.length, 1);
  state = applyOrchestrationEvent(state, { type: "cancelled", message: "Stopped by human." });
  assert.equal(state.status, "cancelled");
});

test("maps specialist outputs to inspectable evidence and recommendation artifacts", () => {
  const artifacts = mapOrchestrationArtifacts([output("analysis"), output("synthesis"), output("review")], {
    nodeId: "inquiry",
    nodeKind: "inquiry",
    runId: "run-1",
  });
  assert.deepEqual(artifacts.map((artifact) => artifact.kind), ["evidence", "recommendation", "evaluation"]);
  assert.equal(artifacts[0].orchestrationRunId, "run-1");
  assert.deepEqual(artifacts[0].sourceIds, ["source-1"]);
});
