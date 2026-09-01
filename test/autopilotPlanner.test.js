import test from "node:test";
import assert from "node:assert/strict";
import { promptBase } from "../server/autopilotAgent.mjs";
import { validateEpisodeStructureProposal } from "../src/episodeIntake.js";

const episodeId = "E0-regression-042";
const sources = [];
const matchingProposal = {
  episodeId,
  objective: "Test objective",
  context: { summary: "Test context", suggestedSources: [] },
  workNodes: [],
  humanGates: [],
  assumptions: [],
  unresolved: [],
};

test("Autopilot planner prompt carries the authoritative Episode ID", () => {
  const prompt = promptBase({ episodeId, episodeName: "Test episode", objective: "Test objective", context: "" }, "");
  assert.match(prompt, new RegExp(`EPISODE ID: ${episodeId}`));
});

test("matching planner Episode ID passes strict validation", () => {
  assert.deepEqual(validateEpisodeStructureProposal(matchingProposal, episodeId, sources), { valid: true });
});

test("different planner Episode ID fails strict validation without rewriting", () => {
  const result = validateEpisodeStructureProposal({ ...matchingProposal, episodeId: "E0-other-999" }, episodeId, sources);
  assert.equal(result.valid, false);
  assert.equal(result.error, "Proposal does not match the Episode.");
});
