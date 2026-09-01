import { EPISODE_STRUCTURE_OUTPUT_SCHEMA, validateEpisodeStructureProposal } from "./episodeIntake.js";

export const MAX_AUTOPILOT_TURNS = 5;

export const AUTOPILOT_TASK_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    taskId: { type: "string" },
    role: { type: "string" },
    summary: { type: "string" },
    findings: { type: "array", items: { type: "string" } },
    evidenceSourceIds: { type: "array", items: { type: "string" } },
    assumptions: { type: "array", items: { type: "string" } },
    unresolvedQuestions: { type: "array", items: { type: "string" } },
    recommendedNextStep: { type: "string" },
  },
  required: ["taskId", "role", "summary", "findings", "evidenceSourceIds", "assumptions", "unresolvedQuestions", "recommendedNextStep"],
};

export const AUTOPILOT_FINAL_PACKAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    taskId: { type: "string" },
    role: { type: "string" },
    summary: { type: "string" },
    findings: { type: "array", items: { type: "string" } },
    evidenceSourceIds: { type: "array", items: { type: "string" } },
    assumptions: { type: "array", items: { type: "string" } },
    unresolvedQuestions: { type: "array", items: { type: "string" } },
    recommendedNextStep: { type: "string" },
    humanReviewRequired: { type: "boolean" },
    conflicts: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    sourceCoverage: { type: "array", items: { type: "string" } },
    draftWorkflow: EPISODE_STRUCTURE_OUTPUT_SCHEMA,
    specialistOutputs: { type: "array", items: AUTOPILOT_TASK_OUTPUT_SCHEMA },
  },
  required: ["taskId", "role", "summary", "findings", "evidenceSourceIds", "assumptions", "unresolvedQuestions", "recommendedNextStep", "humanReviewRequired", "conflicts", "risks", "sourceCoverage", "draftWorkflow", "specialistOutputs"],
};

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function selectAutopilotTasks(proposal) {
  const nodes = Array.isArray(proposal?.workNodes) ? proposal.workNodes : [];
  const ranked = [...nodes].sort((left, right) => {
    const leftScore = (left.sourceIds?.length ?? 0) * 2 + (left.dependsOn?.length ?? 0);
    const rightScore = (right.sourceIds?.length ?? 0) * 2 + (right.dependsOn?.length ?? 0);
    return rightScore - leftScore;
  });
  const selected = ranked.slice(0, 3);
  const selectedIds = new Set(selected.map((node) => node.id));
  const specialists = [];
  const remaining = [...selected];
  while (remaining.length) {
    const index = remaining.findIndex((node) => (node.dependsOn ?? []).filter((id) => selectedIds.has(id)).every((id) => specialists.some((task) => task.nodeId === id)));
    const [node] = remaining.splice(index < 0 ? 0 : index, 1);
    specialists.push({
      id: `specialist-${node.id}`,
      nodeId: node.id,
      role: `${node.kind[0].toUpperCase()}${node.kind.slice(1)} specialist`,
      title: `Analyze ${node.title}`,
      dependsOn: (node.dependsOn ?? []).filter((id) => selectedIds.has(id)).map((id) => `specialist-${id}`),
    });
  }
  return [
    { id: "intake-planner", role: "Intake planner", title: "Prepare a draft workflow", dependsOn: [] },
    ...specialists,
    { id: "final-review", role: "Final synthesis and reviewer", title: "Assemble the human-review package", dependsOn: specialists.map((task) => task.id) },
  ].slice(0, MAX_AUTOPILOT_TURNS);
}

export function validateAutopilotTaskOutput(output, taskId, sourceIds = []) {
  if (!output || typeof output !== "object") {
    return { valid: false, error: `Invalid structured output for ${taskId}.` };
  }
  if (output.taskId !== taskId) return { valid: false, error: `Output task ID must be ${taskId}.` };
  if (!nonEmpty(output.role) || !nonEmpty(output.summary) || !Array.isArray(output.findings) || !Array.isArray(output.evidenceSourceIds) || !Array.isArray(output.assumptions) || !Array.isArray(output.unresolvedQuestions) || !nonEmpty(output.recommendedNextStep)) return { valid: false, error: `Invalid structured output for ${taskId}.` };
  const known = new Set(sourceIds);
  if (output.evidenceSourceIds.some((id) => typeof id !== "string" || !known.has(id))) return { valid: false, error: `Output ${taskId} cites an unknown source.` };
  return { valid: true };
}

export function validateAutopilotFinalPackage(packageValue, sourceIds = []) {
  const result = validateAutopilotTaskOutput(packageValue, "final-review", sourceIds);
  if (!result.valid) return result;
  if (packageValue.humanReviewRequired !== true) return { valid: false, error: "Final package must require human review." };
  for (const field of ["conflicts", "risks", "sourceCoverage", "specialistOutputs"]) if (!Array.isArray(packageValue[field])) return { valid: false, error: `${field} must be an array.` };
  if (!packageValue.draftWorkflow || typeof packageValue.draftWorkflow !== "object") return { valid: false, error: "Final package must include the draft workflow." };
  return { valid: true };
}

export function applyAutopilotEvent(state, event) {
  const next = { ...state, events: [...(state.events ?? []), event].slice(-40) };
  if (event.type === "phase") next.phase = event.phase;
  if (event.type === "task") {
    next.taskStates = { ...(next.taskStates ?? {}), [event.taskId]: event.status };
    next.activeTaskId = event.status === "working" ? event.taskId : next.activeTaskId;
    next.activeNodeId = event.nodeId ?? next.activeNodeId;
    if (event.output) next.outputs = [...(next.outputs ?? []).filter((item) => item.taskId !== event.output.taskId), event.output];
  }
  if (event.type === "draft-plan") next.draftPlan = event.plan;
  if (event.type === "final-package") next.finalPackage = event.package;
  if (["completed", "cancelled", "error"].includes(event.type)) {
    next.status = event.type === "completed" ? "complete" : event.type;
    next.error = event.message ?? null;
    next.activeTaskId = null;
  }
  return next;
}

export function mapAutopilotArtifact(output, { nodeId, nodeKind, runId }) {
  const kind = output.taskId === "final-review" || nodeKind === "evaluation" ? "evaluation" : output.taskId.includes("specialist") ? "evidence" : "evidence";
  return {
    id: `autopilot-${runId}-${output.taskId}`,
    kind,
    label: kind[0].toUpperCase() + kind.slice(1),
    title: `${output.role} · ${output.summary}`,
    body: output.findings.join("\n\n"),
    parentNodeId: nodeId,
    stageIndex: 0,
    sourceIds: output.evidenceSourceIds,
    metadata: { taskId: output.taskId, taskRole: output.role, orchestrationRunId: runId, assumptions: output.assumptions, unresolvedQuestions: output.unresolvedQuestions, recommendedNextStep: output.recommendedNextStep },
    createdAt: new Date().toISOString(),
  };
}

export function validateAutopilotAuthority(record) {
  return record?.advancesStage !== true && record?.recordsDisposition !== true && record?.autoAccepts !== true;
}

export { validateEpisodeStructureProposal };
