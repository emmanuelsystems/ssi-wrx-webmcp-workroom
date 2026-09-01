const REQUESTED_ANALYSIS = [
  "identify the actual objective",
  "identify relevant known context",
  "identify work inquiries",
  "identify likely action areas",
  "identify unresolved questions",
  "identify authority boundaries",
  "identify human checkpoints",
];

const ALLOWED_NODE_KINDS = new Set([
  "inquiry",
  "evidence",
  "gap",
  "recommendation",
  "evaluation",
]);

import { validateSourceManifest, validateSourceReferences } from "./episodeSources.js";

export const EPISODE_STRUCTURE_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    episodeId: { type: "string" },
    objective: { type: "string" },
    context: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        suggestedSources: { type: "array", items: { type: "string" } },
      },
      required: ["summary", "suggestedSources"],
    },
    workNodes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: [...ALLOWED_NODE_KINDS] },
          title: { type: "string" },
          description: { type: "string" },
          rationale: { type: "string" },
          dependsOn: { type: "array", items: { type: "string" } },
          sourceIds: { type: "array", items: { type: "string" } },
        },
        required: ["id", "kind", "title", "description", "rationale", "dependsOn", "sourceIds"],
      },
    },
    humanGates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          afterNodeIds: { type: "array", items: { type: "string" } },
        },
        required: ["id", "title", "afterNodeIds"],
      },
    },
    assumptions: { type: "array", items: { type: "string" } },
    unresolved: { type: "array", items: { type: "string" } },
  },
  required: ["episodeId", "objective", "context", "workNodes", "humanGates", "assumptions", "unresolved"],
};

export function createEpisodeIntakeRequest({ episode }) {
  return {
    episodeId: episode?.id,
    objective: episode?.title ?? "",
    providedContext: episode?.context ?? "",
    sources: episode?.sources ?? [],
    requestedAnalysis: REQUESTED_ANALYSIS,
    authority: {
      may: [
        "inspect the Episode input",
        "propose context",
        "propose work nodes",
        "propose dependencies",
        "propose human gates",
      ],
      mayNot: [
        "accept its own structure",
        "advance workflow stages",
        "make final disposition",
        "execute proposed work",
        "silently expand scope",
      ],
    },
  };
}

export function validateEpisodeStructureProposal(proposal, episodeId, sources = []) {
  if (!proposal || proposal.episodeId !== episodeId) {
    return { valid: false, error: "Proposal does not match the Episode." };
  }

  const sourceValidation = validateSourceManifest(sources);
  if (!sourceValidation.valid) return sourceValidation;

  if (typeof proposal.objective !== "string" || !proposal.objective.trim()) {
    return { valid: false, error: "A proposed objective is required." };
  }

  if (!proposal.context || typeof proposal.context !== "object") {
    return { valid: false, error: "A proposed context is required." };
  }
  if (typeof proposal.context.summary !== "string" || !proposal.context.summary.trim()) {
    return { valid: false, error: "A proposed context summary is required." };
  }
  if (!Array.isArray(proposal.context.suggestedSources)) {
    return { valid: false, error: "Suggested sources must be an array." };
  }

  for (const field of ["assumptions", "unresolved"]) {
    if (!Array.isArray(proposal[field])) {
      return { valid: false, error: `${field} must be an array.` };
    }
    if (proposal[field].some((item) => typeof item !== "string" || !item.trim())) {
      return { valid: false, error: `${field} entries must be non-empty strings.` };
    }
  }

  const workNodes = proposal.workNodes;
  if (!Array.isArray(workNodes)) {
    return { valid: false, error: "work_nodes must be an array." };
  }

  const nodeIds = new Set();
  for (const node of workNodes) {
    if (!node || typeof node !== "object") {
      return { valid: false, error: "Work nodes must be objects." };
    }
    if (typeof node.id !== "string" || !node.id.trim() || nodeIds.has(node.id)) {
      return { valid: false, error: "Work node ids must be present and unique." };
    }
    if (!ALLOWED_NODE_KINDS.has(node.kind)) {
      return { valid: false, error: `Unsupported work node kind: ${node.kind}.` };
    }
    for (const field of ["title", "description", "rationale"]) {
      if (typeof node[field] !== "string" || !node[field].trim()) {
        return { valid: false, error: `${field} is required for work node ${node.id}.` };
      }
    }
    if (!Array.isArray(node.dependsOn)) {
      return { valid: false, error: `Dependencies for ${node.id} must be an array.` };
    }
    if (sources.length > 0 && !Array.isArray(node.sourceIds)) {
      return { valid: false, error: `Source citations are required for work node ${node.id}.` };
    }
    const sourceReferenceValidation = validateSourceReferences(node.sourceIds ?? [], sources);
    if (!sourceReferenceValidation.valid) return { valid: false, error: `Work node ${node.id}: ${sourceReferenceValidation.error}` };
    if (node.dependsOn.some((dependency) => typeof dependency !== "string" || !dependency.trim())) {
      return { valid: false, error: `Dependencies for ${node.id} must be non-empty ids.` };
    }
    if (node.dependsOn.includes(node.id)) {
      return { valid: false, error: `Work node ${node.id} cannot depend on itself.` };
    }
    nodeIds.add(node.id);
  }

  for (const node of workNodes) {
    for (const dependency of node.dependsOn) {
      if (!nodeIds.has(dependency)) {
        return { valid: false, error: `Dependency ${dependency} does not match a work node.` };
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const nodeById = new Map(workNodes.map((node) => [node.id, node]));
  function visit(nodeId) {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visiting.add(nodeId);
    for (const dependency of nodeById.get(nodeId).dependsOn) {
      if (visit(dependency)) return true;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  }
  if (workNodes.some((node) => visit(node.id))) {
    return { valid: false, error: "Work node dependencies cannot contain cycles." };
  }

  if (!Array.isArray(proposal.humanGates)) {
    return { valid: false, error: "human_gates must be an array." };
  }

  const allIds = new Set(nodeIds);
  for (const gate of proposal.humanGates) {
    if (!gate || typeof gate !== "object") {
      return { valid: false, error: "Human checkpoints must be objects." };
    }
    if (typeof gate.id !== "string" || !gate.id.trim() || allIds.has(gate.id)) {
      return { valid: false, error: "Node and checkpoint ids must be present and unique." };
    }
    if (typeof gate.title !== "string" || !gate.title.trim()) {
      return { valid: false, error: `A title is required for human checkpoint ${gate.id}.` };
    }
    if (!Array.isArray(gate.afterNodeIds)) {
      return { valid: false, error: `Dependencies for human checkpoint ${gate.id} must be an array.` };
    }
    if (gate.afterNodeIds.some((id) => typeof id !== "string" || !id.trim() || !nodeIds.has(id))) {
      return { valid: false, error: `Human checkpoint ${gate.id} must reference valid work nodes.` };
    }
    allIds.add(gate.id);
  }

  return { valid: true };
}

export function createWorkflowGates(humanGates = []) {
  return humanGates.map((gate, index) => ({
    ...gate,
    position: {
      x: 120 + (index % 3) * 330,
      y: 620 + Math.floor(index / 3) * 220,
    },
  }));
}

export function createWorkflowGateEdges(humanGates = [], terminalNodeIds = []) {
  return humanGates.flatMap((gate) =>
    gate.afterNodeIds?.length
      ? gate.afterNodeIds.map((nodeId) => [nodeId, gate.id])
      : terminalNodeIds.map((nodeId) => [nodeId, gate.id])
  );
}

export function normalizeEpisodeIntake(intake) {
  return {
    status: ["idle", "pending", "proposed", "accepted"].includes(intake?.status)
      ? intake.status
      : "idle",
    request: intake?.request ?? null,
    proposal: intake?.proposal ?? null,
    previousProposal: intake?.previousProposal ?? null,
    acceptedAt: intake?.acceptedAt ?? null,
  };
}
