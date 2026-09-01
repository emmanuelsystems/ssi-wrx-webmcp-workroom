import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_AUTOPILOT_TURNS,
  applyAutopilotEvent,
  mapAutopilotArtifact,
  selectAutopilotTasks,
  validateAutopilotAuthority,
  validateAutopilotFinalPackage,
  validateAutopilotTaskOutput,
} from "../src/autopilot.js";

const proposal = {
  workNodes: [
    { id: "evidence", kind: "evidence", title: "Check evidence", dependsOn: [], sourceIds: ["s1"] },
    { id: "evaluation", kind: "evaluation", title: "Evaluate", dependsOn: ["evidence"], sourceIds: ["s1"] },
    { id: "gap", kind: "gap", title: "Find gaps", dependsOn: [], sourceIds: [] },
  ],
};

test("autopilot schedules at most three specialists within five turns", () => {
  const tasks = selectAutopilotTasks(proposal);
  assert.ok(tasks.length <= MAX_AUTOPILOT_TURNS);
  assert.equal(tasks[0].id, "intake-planner");
  assert.equal(tasks.at(-1).id, "final-review");
  assert.ok(tasks.find((task) => task.id === "specialist-evaluation").dependsOn.includes("specialist-evidence"));
});

test("autopilot state transitions retain outputs and terminal state", () => {
  let state = { status: "working", taskStates: {}, outputs: [], events: [] };
  state = applyAutopilotEvent(state, { type: "task", taskId: "specialist-evidence", nodeId: "evidence", status: "working" });
  assert.equal(state.activeNodeId, "evidence");
  const output = { taskId: "specialist-evidence", role: "Evidence specialist", summary: "Summary", findings: ["Finding"], evidenceSourceIds: ["s1"], assumptions: ["Assumption"], unresolvedQuestions: ["Question"], recommendedNextStep: "Review" };
  state = applyAutopilotEvent(state, { type: "task", taskId: output.taskId, nodeId: "evidence", status: "complete", output });
  assert.equal(state.outputs[0], output);
  state = applyAutopilotEvent(state, { type: "completed" });
  assert.equal(state.status, "complete");
});

test("autopilot validates source citations and human-review final packages", () => {
  const output = { taskId: "specialist-evidence", role: "Evidence specialist", summary: "Summary", findings: [], evidenceSourceIds: ["unknown"], assumptions: [], unresolvedQuestions: [], recommendedNextStep: "Review" };
  assert.equal(validateAutopilotTaskOutput(output, output.taskId, ["s1"]).valid, false);
  const finalPackage = { ...output, taskId: "final-review", role: "Final synthesis and reviewer", humanReviewRequired: true, conflicts: [], risks: [], sourceCoverage: ["s1"], evidenceSourceIds: ["s1"], draftWorkflow: {}, specialistOutputs: [] };
  assert.equal(validateAutopilotFinalPackage(finalPackage, ["s1"]).valid, true);
});

test("autopilot artifacts carry run and review metadata without authority", () => {
  const artifact = mapAutopilotArtifact({ taskId: "specialist-evidence", role: "Evidence specialist", summary: "Summary", findings: ["Finding"], evidenceSourceIds: ["s1"], assumptions: ["A"], unresolvedQuestions: ["Q"], recommendedNextStep: "Review" }, { nodeId: "evidence", nodeKind: "evidence", runId: "run-1" });
  assert.equal(artifact.metadata.orchestrationRunId, "run-1");
  assert.equal(validateAutopilotAuthority({ advancesStage: false, recordsDisposition: false, autoAccepts: false }), true);
});
