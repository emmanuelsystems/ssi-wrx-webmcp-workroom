import assert from "node:assert/strict";
import test from "node:test";
import { createAgentRoute, createEpisodeBaseline, createProjectState, createWorkLease, validateWorkLease } from "../src/governance.js";

test("work lease is bound to one episode, baseline, and read-only action", () => {
  const project = { state: createProjectState({ summary: "Baseline A" }) };
  const episode = { id: "E0-001", governance: { baseline: createEpisodeBaseline(project), ownerName: "Owner" } };
  const route = createAgentRoute({ role: "Technical validator" });
  const lease = createWorkLease({ episode, agentRoute: route, objective: "Validate baseline" });
  assert.equal(validateWorkLease({ lease, episodeId: episode.id, baselineId: episode.governance.baseline.id, action: "analysis" }).valid, true);
  assert.equal(validateWorkLease({ lease, episodeId: episode.id, baselineId: "other", action: "analysis" }).valid, false);
  assert.equal(validateWorkLease({ lease: { ...lease, status: "completed" }, episodeId: episode.id, baselineId: episode.governance.baseline.id, action: "analysis" }).valid, false);
});
