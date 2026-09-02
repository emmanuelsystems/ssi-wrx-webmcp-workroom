import assert from "node:assert/strict";
import test from "node:test";
import { createAgentRoute, createEpisodeBaseline, createProjectState, createReadback, createReturnPacket, createWorkLease, validateEpisodeBaseline, validateWorkLease } from "../src/governance.js";

test("work lease is bound to one episode, baseline, project state, and read-only action", () => {
  const state = createProjectState({ summary: "Baseline A" });
  const project = { id: "project-1", state };
  const episode = { id: "E0-001", projectId: project.id, title: "Validate", sources: [], governance: { baseline: createEpisodeBaseline(project), ownerName: "Owner" } };
  const route = createAgentRoute({ role: "Technical validator" });
  const lease = createWorkLease({ episode, agentRoute: route, objective: "Validate baseline" });
  assert.equal(validateWorkLease({ lease, episodeId: episode.id, baselineId: episode.governance.baseline.id, projectStateId: state.id, action: "analysis" }).valid, true);
  assert.match(validateWorkLease({ lease, episodeId: episode.id, baselineId: "other", projectStateId: state.id, action: "analysis" }).error, /baseline/);
  assert.match(validateWorkLease({ lease, episodeId: episode.id, baselineId: episode.governance.baseline.id, projectStateId: "state-new", action: "analysis" }).error, /stale/);
  assert.equal(validateWorkLease({ lease: { ...lease, status: "completed" }, episodeId: episode.id, baselineId: episode.governance.baseline.id, projectStateId: state.id, action: "analysis" }).valid, false);
});

test("baseline validation fails closed when project state moves", () => {
  const first = createProjectState({ summary: "A" });
  const project = { id: "project-1", state: first };
  const baseline = createEpisodeBaseline(project);
  assert.equal(validateEpisodeBaseline({ baseline, projectState: first }).valid, true);
  const second = createProjectState({ summary: "B" });
  assert.match(validateEpisodeBaseline({ baseline, projectState: second }).error, /stale/);
});

test("readback revisions preserve provenance and return packets start with no authority", () => {
  const episode = { id: "E0-001", title: "Validate", sources: [], governance: { baseline: { summary: "A" } } };
  const first = createReadback(episode);
  const revised = createReadback(episode, { revisionOf: first.id, revisionInstruction: "Clarify the conflict." });
  assert.equal(first.provenance, "system");
  assert.equal(revised.revisionOf, first.id);
  assert.equal(revised.proposedWork, "Clarify the conflict.");
  const packet = createReturnPacket({ runId: "run-1", lease: { id: "lease-1" }, route: { id: "route-1" }, packageValue: { summary: "Claim", evidenceSourceIds: ["source-1"] } });
  assert.equal(packet.authorityEffect, "none");
  assert.equal(packet.status, "returned");
  assert.deepEqual(packet.acceptedEvidence, []);
  assert.deepEqual(packet.acceptedClaims, []);
});
