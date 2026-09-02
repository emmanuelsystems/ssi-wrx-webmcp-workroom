export const GOVERNANCE_STORAGE_VERSION = 2;

export const AUTHORITY_STATES = {
  AUTHORITATIVE: "authoritative",
  AUTHORIZED: "authorized",
  PROPOSED: "proposed",
  OBSERVED: "observed",
  RETURNED: "returned",
  SUPERSEDED: "superseded",
  PROHIBITED: "prohibited",
};

export function createProjectState({ summary = "No authoritative state has been recorded yet.", sourceIds = [] } = {}) {
  return {
    id: `state-${crypto.randomUUID()}`,
    summary,
    sourceIds,
    authority: AUTHORITY_STATES.AUTHORITATIVE,
    createdAt: new Date().toISOString(),
  };
}

export function normalizeProjectGovernance(project) {
  const state = project?.state && typeof project.state === "object" ? project.state : null;
  return {
    ownerName: project?.ownerName?.trim() || "Owner",
    state,
    stateHistory: Array.isArray(project?.stateHistory) ? project.stateHistory : [],
  };
}

export function createEpisodeBaseline(project) {
  if (!project?.state?.id) return null;
  return {
    id: `baseline-${crypto.randomUUID()}`,
    projectStateId: project.state.id,
    summary: project.state.summary,
    sourceIds: project.state.sourceIds ?? [],
    capturedAt: new Date().toISOString(),
    authority: AUTHORITY_STATES.AUTHORITATIVE,
  };
}

export function validateEpisodeBaseline({ baseline, projectState }) {
  if (!baseline?.id || !baseline?.projectStateId) return { valid: false, error: "Episode baseline is required before work can be authorized." };
  if (!projectState?.id) return { valid: false, error: "Current authoritative Project State is unavailable." };
  if (baseline.projectStateId !== projectState.id) return { valid: false, error: "Episode baseline is stale. Re-baseline the Episode before authorizing work." };
  return { valid: true };
}

export function createReadback(episode, { revisionOf = null, revisionInstruction = "" } = {}) {
  return {
    id: `readback-${crypto.randomUUID()}`,
    status: "proposed",
    provenance: "system",
    revisionOf,
    revisionInstruction: revisionInstruction.trim(),
    objective: episode.title,
    sources: (episode.sources ?? []).map((source) => source.fileName),
    baseline: episode.governance?.baseline?.summary ?? "No project baseline was recorded.",
    conflicts: episode.governance?.baseline ? [] : ["No authoritative project state was captured for this Episode."],
    proposedWork: revisionInstruction.trim() || "Prepare a bounded read-only analysis package for human review.",
    prohibited: ["Change authoritative state", "Advance stages", "Record disposition", "Edit files", "Use network or external tools"],
    authorityEffect: "none",
    createdAt: new Date().toISOString(),
    acceptedAt: null,
  };
}

export function createWorkLease({ episode, agentRoute, objective, action = "analysis" }) {
  return {
    id: `lease-${crypto.randomUUID()}`,
    episodeId: episode.id,
    projectId: episode.projectId ?? null,
    baselineId: episode.governance?.baseline?.id ?? null,
    projectStateId: episode.governance?.baseline?.projectStateId ?? null,
    owner: episode.governance?.ownerName ?? "Owner",
    agentRouteId: agentRoute.id,
    objective,
    permitted: ["inspect supplied context", "inspect supplied sources", "run bounded local analysis"],
    prohibited: ["modify source code", "access network", "browser automation", "external communication", "advance stages", "accept evidence", "record disposition"],
    stopConditions: ["Episode baseline differs", "Required source is unavailable", "A source change is required", "A material conflict is discovered"],
    expectedReturn: "Structured Return Packet for human reconciliation.",
    action,
    status: "active",
    issuedAt: new Date().toISOString(),
    completedAt: null,
  };
}

export function createAgentRoute({ lease, role, provider = "Codex", conversationId = null }) {
  return {
    id: `route-${crypto.randomUUID()}`,
    provider,
    role,
    capabilities: ["local read-only analysis"],
    leaseId: lease?.id ?? null,
    conversationId,
    status: lease?.id ? "authorized" : "proposed",
    authority: lease?.id ? AUTHORITY_STATES.AUTHORIZED : AUTHORITY_STATES.PROPOSED,
    createdAt: new Date().toISOString(),
  };
}

export function createReturnPacket({ runId, lease, route, packageValue, outputs = [] }) {
  return {
    id: `return-${crypto.randomUUID()}`,
    runId,
    leaseId: lease.id,
    routeId: route.id,
    status: "returned",
    authorityEffect: "none",
    observations: packageValue?.findings ?? outputs.flatMap((output) => output.findings ?? []),
    evidence: packageValue?.evidenceSourceIds ?? [],
    claims: packageValue?.summary ? [packageValue.summary] : [],
    gaps: packageValue?.unresolvedQuestions ?? [],
    conflicts: packageValue?.conflicts ?? [],
    recommendation: packageValue?.recommendedNextStep ?? "Review the returned work.",
    acceptedEvidence: [],
    acceptedClaims: [],
    reconciliationStatus: "pending",
    createdAt: new Date().toISOString(),
    reconciledAt: null,
  };
}

export function normalizeEpisodeGovernance(episode, project) {
  const governance = episode?.governance && typeof episode.governance === "object" ? episode.governance : {};
  return {
    version: GOVERNANCE_STORAGE_VERSION,
    ownerName: governance.ownerName ?? project?.ownerName ?? "Owner",
    baseline: governance.baseline ?? null,
    readback: governance.readback ?? null,
    readbackHistory: Array.isArray(governance.readbackHistory) ? governance.readbackHistory : [],
    workLeases: Array.isArray(governance.workLeases) ? governance.workLeases : [],
    agentRoutes: Array.isArray(governance.agentRoutes) ? governance.agentRoutes : [],
    returns: Array.isArray(governance.returns) ? governance.returns : [],
  };
}

export function validateWorkLease({ lease, episodeId, baselineId, action, projectStateId }) {
  if (!lease || typeof lease !== "object") return { valid: false, error: "An active Work Lease is required." };
  if (!lease.id || lease.status !== "active") return { valid: false, error: "Work Lease is not active." };
  if (!baselineId || !lease.baselineId || !lease.projectStateId) return { valid: false, error: "Episode baseline is required before work can run." };
  if (lease.episodeId !== episodeId) return { valid: false, error: "Work Lease does not belong to this Episode." };
  if (lease.baselineId !== baselineId) return { valid: false, error: "Work Lease does not match the Episode baseline." };
  if (!projectStateId) return { valid: false, error: "Current authoritative Project State is required before work can run." };
  if (lease.projectStateId !== projectStateId) return { valid: false, error: "Episode baseline is stale. Re-baseline the Episode before running work." };
  if (lease.action !== action) return { valid: false, error: "Work Lease does not permit this run." };
  if (!Array.isArray(lease.permitted) || !lease.permitted.includes("run bounded local analysis")) return { valid: false, error: "Work Lease does not permit local analysis." };
  return { valid: true };
}
