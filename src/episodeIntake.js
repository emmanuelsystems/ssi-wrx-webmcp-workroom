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

export function createEpisodeIntakeRequest({ episode }) {
  return {
    episodeId: episode?.id,
    objective: episode?.title ?? "",
    providedContext: episode?.context ?? "",
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

export function validateEpisodeStructureProposal(proposal, episodeId) {
  if (!proposal || proposal.episodeId !== episodeId) {
    return { valid: false, error: "Proposal does not match the Episode." };
  }

  if (!proposal.objective?.trim()) {
    return { valid: false, error: "A proposed objective is required." };
  }

  const workNodes = proposal.workNodes;
  if (!Array.isArray(workNodes)) {
    return { valid: false, error: "work_nodes must be an array." };
  }

  const ids = new Set();
  for (const node of workNodes) {
    if (!node?.id || ids.has(node.id)) {
      return { valid: false, error: "Work node ids must be present and unique." };
    }
    if (!ALLOWED_NODE_KINDS.has(node.kind)) {
      return { valid: false, error: `Unsupported work node kind: ${node.kind}.` };
    }
    if (node.dependsOn !== undefined && !Array.isArray(node.dependsOn)) {
      return { valid: false, error: `Dependencies for ${node.id} must be an array.` };
    }
    ids.add(node.id);
  }

  for (const node of workNodes) {
    for (const dependency of node.dependsOn ?? []) {
      if (!ids.has(dependency)) {
        return { valid: false, error: `Dependency ${dependency} does not match a work node.` };
      }
    }
  }

  if (!Array.isArray(proposal.humanGates)) {
    return { valid: false, error: "human_gates must be an array." };
  }

  for (const gate of proposal.humanGates) {
    if (!gate?.id || !gate.title || !Array.isArray(gate.afterNodeIds ?? []) || (gate.afterNodeIds ?? []).some((id) => !ids.has(id))) {
      return { valid: false, error: "Human checkpoints must reference valid work nodes." };
    }
  }

  return { valid: true };
}

export function normalizeEpisodeIntake(intake) {
  return {
    status: ["idle", "pending", "proposed", "accepted"].includes(intake?.status)
      ? intake.status
      : "idle",
    request: intake?.request ?? null,
    proposal: intake?.proposal ?? null,
    acceptedAt: intake?.acceptedAt ?? null,
  };
}
