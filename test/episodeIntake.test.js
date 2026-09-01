import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkflowGateEdges,
  createWorkflowGates,
  validateEpisodeStructureProposal,
} from "../src/episodeIntake.js";
import {
  prepareSourceContext,
  validateSourceManifest,
  validateSourceReferences,
} from "../src/episodeSources.js";

const baseProposal = {
  episodeId: "E0-001",
  objective: "Understand the bounded decision.",
  context: { summary: "Known context.", suggestedSources: [] },
  workNodes: [
    { id: "inquiry", kind: "inquiry", title: "Ask", description: "Ask a question.", rationale: "Need clarity.", dependsOn: [] },
    { id: "evidence", kind: "evidence", title: "Check", description: "Check evidence.", rationale: "Need support.", dependsOn: ["inquiry"] },
  ],
  humanGates: [
    { id: "checkpoint-context", title: "Confirm context", afterNodeIds: ["inquiry"] },
    { id: "checkpoint-evidence", title: "Review evidence", afterNodeIds: ["evidence"] },
  ],
  assumptions: [],
  unresolved: [],
};

function proposalWith(change) {
  return structuredClone({ ...baseProposal, ...change });
}

test("accepts multiple explicit human checkpoints and preserves their dependency edges", () => {
  const result = validateEpisodeStructureProposal(baseProposal, "E0-001");
  assert.equal(result.valid, true);

  const gates = createWorkflowGates(baseProposal.humanGates);
  assert.deepEqual(gates.map(({ id, title, afterNodeIds }) => ({ id, title, afterNodeIds })), baseProposal.humanGates);
  assert.deepEqual(createWorkflowGateEdges(gates, ["evidence"]), [
    ["inquiry", "checkpoint-context"],
    ["evidence", "checkpoint-evidence"],
  ]);
});

test("rejects missing required node fields and duplicate checkpoint ids", () => {
  assert.equal(validateEpisodeStructureProposal(proposalWith({
    workNodes: [{ ...baseProposal.workNodes[0], description: "" }, baseProposal.workNodes[1]],
  }), "E0-001").valid, false);

  assert.equal(validateEpisodeStructureProposal(proposalWith({
    humanGates: [baseProposal.humanGates[0], { ...baseProposal.humanGates[1], id: "inquiry" }],
  }), "E0-001").valid, false);
});

test("rejects invalid references, self-dependencies, and cycles", () => {
  assert.equal(validateEpisodeStructureProposal(proposalWith({
    workNodes: [{ ...baseProposal.workNodes[0], dependsOn: ["missing"] }, baseProposal.workNodes[1]],
  }), "E0-001").valid, false);
  assert.equal(validateEpisodeStructureProposal(proposalWith({
    workNodes: [{ ...baseProposal.workNodes[0], dependsOn: ["inquiry"] }, baseProposal.workNodes[1]],
  }), "E0-001").valid, false);
  assert.equal(validateEpisodeStructureProposal(proposalWith({
    workNodes: [
      { ...baseProposal.workNodes[0], dependsOn: ["evidence"] },
      { ...baseProposal.workNodes[1], dependsOn: ["inquiry"] },
    ],
  }), "E0-001").valid, false);
});

const sourceManifest = [
  { sourceId: "source-one", fileName: "notes.txt", fileType: "text/plain", size: 20, extractionStatus: "extracted", charCount: 20 },
  { sourceId: "source-two", fileName: "decision.md", fileType: "text/markdown", size: 30, extractionStatus: "extracted", charCount: 30 },
];

test("validates source manifests and work-node source references", () => {
  assert.equal(validateSourceManifest(sourceManifest).valid, true);
  assert.equal(validateSourceReferences(["source-one"], sourceManifest).valid, true);
  assert.equal(validateSourceReferences(["missing-source"], sourceManifest).valid, false);
  assert.equal(validateSourceManifest([{ ...sourceManifest[0], sourceId: "" }]).valid, false);
  assert.equal(validateSourceManifest(Array.from({ length: 11 }, (_, index) => ({ ...sourceManifest[0], sourceId: `source-${index}` }))).valid, false);
});

test("requires and validates source citations when sources are present", () => {
  const citedProposal = proposalWith({
    workNodes: baseProposal.workNodes.map((node) => ({ ...node, sourceIds: ["source-one"] })),
  });
  assert.equal(validateEpisodeStructureProposal(citedProposal, "E0-001", sourceManifest).valid, true);
  assert.equal(validateEpisodeStructureProposal(proposalWith({
    workNodes: baseProposal.workNodes.map((node) => ({ ...node, sourceIds: ["missing-source"] })),
  }), "E0-001", sourceManifest).valid, false);
  assert.equal(validateEpisodeStructureProposal(proposalWith({
    workNodes: baseProposal.workNodes,
  }), "E0-001", sourceManifest).valid, false);
});

test("prepares bounded per-source and combined context", () => {
  const prepared = prepareSourceContext([
    { ...sourceManifest[0], text: "Transcript evidence." },
    { ...sourceManifest[1], text: "Decision evidence." },
  ]);
  assert.equal(prepared.sourceCount, 2);
  assert.equal(prepared.summaries[0].sourceId, "source-one");
  assert.match(prepared.combinedContext, /SOURCE source-two/);
});
