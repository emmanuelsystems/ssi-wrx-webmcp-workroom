import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDashboardConversationPrompt,
  validateDashboardConversationInput,
  validateDashboardConversationOutput,
} from "../server/dashboardConversationAgent.mjs";

const proposal = {
  episodeId: "draft",
  objective: "Prepare a client follow-up",
  context: { summary: "Turn the meeting into a reviewable follow-up.", suggestedSources: [] },
  workNodes: [
    { id: "node-1", kind: "inquiry", title: "Recover decisions", description: "Extract decisions and commitments.", rationale: "The meeting needs a clear record.", dependsOn: [], sourceIds: [] },
    { id: "node-2", kind: "recommendation", title: "Draft follow-up", description: "Prepare a bounded follow-up brief.", rationale: "A reviewable output is needed.", dependsOn: ["node-1"], sourceIds: [] },
  ],
  humanGates: [{ id: "gate-1", title: "Approve the follow-up direction", afterNodeIds: ["node-2"] }],
  assumptions: [],
  unresolved: [],
};

test("dashboard conversation accepts bounded message history", () => {
  assert.doesNotThrow(() => validateDashboardConversationInput({
    question: "Help me prepare a client follow-up.",
    messages: [{ role: "human", content: "Help me prepare a client follow-up." }],
  }));
  assert.throws(() => validateDashboardConversationInput({ question: "", messages: [] }), /question is required/);
});

test("dashboard conversation accepts a draft Episode context", () => {
  assert.doesNotThrow(() => validateDashboardConversationInput({
    question: "Help me shape this work.",
    messages: [{ role: "human", content: "Help me shape this work." }],
    episode: { id: "draft", name: "New Episode", title: "", context: "", currentStage: 0, status: "draft", sourceIds: [], knownDecisions: [] },
  }));
});

test("dashboard conversation accepts a source at the supported text limit", () => {
  assert.doesNotThrow(() => validateDashboardConversationInput({
    question: "Analyze this transcript.",
    messages: [{ role: "human", content: "Analyze this transcript." }],
    sources: [{ sourceId: "source-1", fileName: "meeting.txt", text: "a".repeat(80_000) }],
  }));
});

test("dashboard conversation keeps a clarification response plan-free", () => {
  const result = validateDashboardConversationOutput({
    reply: "What outcome would you like to work toward?",
    analysis: { summary: "The requested outcome is not clear yet.", findings: [], decisions: [], risks: [], openQuestions: [] },
    nextActions: ["Describe the outcome to evaluate."],
    episodeProposal: null,
  });
  assert.equal(result.episodeProposal, null);
});

test("dashboard conversation accepts a bounded human-review plan", () => {
  const result = validateDashboardConversationOutput({
    reply: "I drafted a proposal for your review.",
    analysis: { summary: "A bounded proposal is ready for review.", findings: ["The work can be staged."], decisions: [], risks: [], openQuestions: [] },
    nextActions: ["Review the proposal."],
    episodeProposal: proposal,
  });
  assert.equal(result.episodeProposal.humanGates[0].title, "Approve the follow-up direction");
});

test("dashboard conversation prompt treats attached transcripts as active analysis context", () => {
  const prompt = buildDashboardConversationPrompt({
    question: "Analyze this meeting transcript.",
    messages: [{ role: "human", content: "Analyze this meeting transcript." }],
    sources: [{ sourceId: "source-1", fileName: "meeting.txt", text: "David committed to send the proposal Friday." }],
  });
  assert.match(prompt, /Attached sources are active working context/);
  assert.match(prompt, /SOURCE source-1 \(meeting.txt\)/);
});

test("dashboard conversation prompt carries the selected episode context", () => {
  const prompt = buildDashboardConversationPrompt({
    question: "Continue this episode.",
    messages: [{ role: "human", content: "Continue this episode." }],
    episode: {
      id: "E0-001",
      name: "Huddle follow-up workflow",
      title: "Recover weekly huddle workflow",
      context: "Keep the follow-up bounded and reviewable.",
      currentStage: 0,
      status: "active",
      sourceIds: [],
      knownDecisions: ["Human review remains required."],
    },
  });
  assert.match(prompt, /ACTIVE EPISODE/);
  assert.match(prompt, /Keep the follow-up bounded and reviewable/);
  assert.match(prompt, /Human review remains required/);
});
