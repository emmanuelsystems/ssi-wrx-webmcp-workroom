from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match in {path}, found {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


governance = r'''export const GOVERNANCE_STORAGE_VERSION = 2;

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
'''
Path("src/governance.js").write_text(governance)

replace_once("src/App.jsx", '''function GovernancePanel({ episode, project, onAcceptReadback, onRequestReadbackRevision, onAuthorize, onRecordState, onAcceptReturnItem, onRejectReturn }) {
  const governance = episode.governance ?? {};
  const readback = governance.readback;
  const activeLease = (governance.workLeases ?? []).find((lease) => lease.status === "active");
  const route = (governance.agentRoutes ?? []).find((item) => item.leaseId === activeLease?.id);
  const returned = (governance.returns ?? []).at(-1);
  const stateSummary = project?.state?.summary ?? "No authoritative project state has been recorded.";
  const canAuthorize = readback?.status === "accepted" && !activeLease;

  return (
    <section className="governance-panel" aria-label="Workroom governance">
      <header>
        <div><span>Governed work loop</span><h2>Authority and execution</h2></div>
        <em>{project?.ownerName ?? governance.ownerName ?? "Owner"} owns authority</em>
      </header>
      <div className="governance-grid">
        <article><span>Authoritative state</span><strong>{project?.state ? "Recorded" : "Not recorded"}</strong><p>{stateSummary}</p>{project && !project.state && <button type="button" onClick={onRecordState}>Record current state</button>}</article>
        <article><span>Episode baseline</span><strong>{governance.baseline ? "Frozen" : "Not recorded"}</strong><p>{governance.baseline?.summary ?? "This legacy or unassigned Episode has no project snapshot."}</p></article>
        <article><span>Readback</span><strong>{readback?.status ?? "Not proposed"}</strong><p>{readback?.proposedWork ?? "Create or revise an agent readback before authorizing work."}</p>
          {readback?.status === "proposed" && <div className="governance-actions"><button type="button" onClick={onAcceptReadback}>Accept context</button><button type="button" onClick={onRequestReadbackRevision}>Request revision</button></div>}
        </article>
        <article><span>Work Lease</span><strong>{activeLease ? "Authorized · one run" : "Not authorized"}</strong><p>{activeLease ? `${route?.role ?? "Codex analyst"} may run bounded local analysis.` : "Readback acceptance is required before work can begin."}</p>
          {canAuthorize && <button type="button" onClick={onAuthorize}>Authorize read-only analysis</button>}
        </article>
      </div>
      {returned && <section className="return-packet">
        <div><span>Returned · authority effect: none</span><strong>Human reconciliation required</strong><p>{returned.recommendation}</p></div>
        <div className="return-packet-items">
          {returned.evidence.map((item) => <button type="button" key={`evidence-${item}`} disabled={returned.acceptedEvidence.includes(item)} onClick={() => onAcceptReturnItem(returned.id, "evidence", item)}>{returned.acceptedEvidence.includes(item) ? "✓ Evidence accepted" : "Accept evidence"} · {item}</button>)}
          {returned.claims.map((item) => <button type="button" key={`claim-${item}`} disabled={returned.acceptedClaims.includes(item)} onClick={() => onAcceptReturnItem(returned.id, "claim", item)}>{returned.acceptedClaims.includes(item) ? "✓ Claim accepted" : "Accept claim"} · {compactArtifactSummary(item)}</button>)}
        </div>
        <button type="button" className="governance-reject" onClick={() => onRejectReturn(returned.id)}>Reject return</button>
      </section>}
    </section>
  );
}
''', '''function GovernancePanel({ episode, project, onAcceptReadback, onRequestReadbackRevision, onAuthorize, onRecordState, onAcceptReturnItem, onCommitReturn, onRejectReturn }) {
  const governance = episode.governance ?? {};
  const readback = governance.readback;
  const activeLease = (governance.workLeases ?? []).find((lease) => lease.status === "active");
  const route = (governance.agentRoutes ?? []).find((item) => item.leaseId === activeLease?.id);
  const returned = (governance.returns ?? []).at(-1);
  const stateSummary = project?.state?.summary ?? "No authoritative project state has been recorded.";
  const baselineCurrent = Boolean(governance.baseline?.projectStateId && project?.state?.id && governance.baseline.projectStateId === project.state.id);
  const stagedCount = (returned?.acceptedEvidence?.length ?? 0) + (returned?.acceptedClaims?.length ?? 0);
  const returnPending = returned?.status === "returned";
  const canAuthorize = readback?.status === "accepted" && baselineCurrent && !activeLease;

  return (
    <section className="governance-panel" aria-label="Workroom governance">
      <header>
        <div><span>Governed work loop</span><h2>Authority and execution</h2></div>
        <em>{project?.ownerName ?? governance.ownerName ?? "Owner"} owns authority</em>
      </header>
      <div className="governance-grid">
        <article><span>Authoritative state</span><strong>{project?.state ? "Recorded" : "Not recorded"}</strong><p>{stateSummary}</p>{project && !project.state && <button type="button" onClick={onRecordState}>Record current state</button>}</article>
        <article><span>Episode baseline</span><strong>{!governance.baseline ? "Not recorded" : baselineCurrent ? "Frozen · current" : "Stale · re-baseline required"}</strong><p>{governance.baseline?.summary ?? "This legacy or unassigned Episode has no project snapshot."}</p></article>
        <article><span>Readback</span><strong>{readback?.status ?? "Not proposed"}</strong><p>{readback?.proposedWork ?? "Create or revise a system readback before authorizing work."}</p>
          {readback?.status === "proposed" && <div className="governance-actions"><button type="button" onClick={onAcceptReadback}>Accept context</button><button type="button" onClick={onRequestReadbackRevision}>Request revision</button></div>}
        </article>
        <article><span>Work Lease</span><strong>{activeLease ? "Authorized · one run" : "Not authorized"}</strong><p>{activeLease ? `${route?.role ?? "Codex analyst"} may run bounded local analysis.` : !baselineCurrent ? "Current Project State must match the Episode baseline before work can be authorized." : "Readback acceptance is required before work can begin."}</p>
          {canAuthorize && <button type="button" onClick={onAuthorize}>Authorize read-only analysis</button>}
        </article>
      </div>
      {returned && <section className="return-packet">
        <div><span>{returned.status === "accepted" ? "Reconciled" : returned.status === "rejected" ? "Rejected" : "Returned"} · authority effect: none</span><strong>{returnPending ? "Human reconciliation required" : "Human reconciliation recorded"}</strong><p>{returned.recommendation}</p></div>
        <div className="return-packet-items">
          {returned.evidence.map((item) => <button type="button" key={`evidence-${item}`} disabled={!returnPending || returned.acceptedEvidence.includes(item)} onClick={() => onAcceptReturnItem(returned.id, "evidence", item)}>{returned.acceptedEvidence.includes(item) ? "✓ Evidence staged" : "Stage evidence"} · {item}</button>)}
          {returned.claims.map((item) => <button type="button" key={`claim-${item}`} disabled={!returnPending || returned.acceptedClaims.includes(item)} onClick={() => onAcceptReturnItem(returned.id, "claim", item)}>{returned.acceptedClaims.includes(item) ? "✓ Claim staged" : "Stage claim"} · {compactArtifactSummary(item)}</button>)}
        </div>
        {returnPending && stagedCount > 0 && <button type="button" onClick={() => onCommitReturn(returned.id)}>Accept reconciliation · {stagedCount} staged</button>}
        {returnPending && <button type="button" className="governance-reject" onClick={() => onRejectReturn(returned.id)}>Reject return</button>}
      </section>}
    </section>
  );
}
''')

replace_once("src/App.jsx", '''  function acceptReadback() {
    if (!activeEpisode?.governance?.readback || activeEpisode.governance.readback.status !== "proposed") return;
    updateEpisode(activeEpisode.id, (episode) => ({
      ...episode,
      governance: {
        ...episode.governance,
        readback: { ...episode.governance.readback, status: "accepted", acceptedAt: new Date().toISOString() },
      },
    }));
    appendActivity(activeEpisode.id, { type: "readback.accepted", actor: "human", title: "Context accepted", summary: "The owner accepted the agent’s understanding. Work is still not authorized.", authorityImpact: "accepted" });
  }

  function requestReadbackRevision() {
    if (!activeEpisode?.governance?.readback) return;
    updateEpisode(activeEpisode.id, (episode) => ({
      ...episode,
      governance: {
        ...episode.governance,
        readback: { ...episode.governance.readback, status: "proposed", acceptedAt: null, createdAt: new Date().toISOString() },
      },
    }));
    appendActivity(activeEpisode.id, { type: "readback.revision_requested", actor: "human", title: "Readback revision requested", summary: "No work is authorized until the revised context is accepted.", authorityImpact: "human-review" });
  }

  function authorizeAutopilotAnalysis() {
    if (!activeEpisode?.governance?.readback || activeEpisode.governance.readback.status !== "accepted") return;
    const provisionalRoute = createAgentRoute({ role: "Read-only technical analyst" });
    const lease = createWorkLease({ episode: activeEpisode, agentRoute: provisionalRoute, objective: activeEpisode.title });
    const route = { ...provisionalRoute, leaseId: lease.id, authority: AUTHORITY_STATES.AUTHORIZED };
    const nextEpisode = {
      ...activeEpisode,
      governance: {
        ...activeEpisode.governance,
        workLeases: [...(activeEpisode.governance.workLeases ?? []), lease],
        agentRoutes: [...(activeEpisode.governance.agentRoutes ?? []), route],
      },
    };
    updateEpisode(activeEpisode.id, () => nextEpisode);
    appendActivity(activeEpisode.id, { type: "lease.authorized", actor: "human", title: "Read-only Work Lease authorized", summary: `One bounded Codex analysis run is authorized under ${lease.id}.`, authorityImpact: "authorized" });
    void runAutopilotEpisode(nextEpisode, "Authorized by the owner through a one-run read-only Work Lease.");
  }

  function acceptReturnItem(returnId, kind, item) {
    if (!activeEpisode || !activeProject) return;
    const returnPacket = activeEpisode.governance?.returns?.find((entry) => entry.id === returnId);
    if (!returnPacket) return;
    const key = kind === "evidence" ? "acceptedEvidence" : "acceptedClaims";
    if (returnPacket[key]?.includes(item)) return;
    updateEpisode(activeEpisode.id, (episode) => ({
      ...episode,
      governance: {
        ...episode.governance,
        returns: episode.governance.returns.map((entry) => entry.id === returnId ? { ...entry, [key]: [...(entry[key] ?? []), item], reconciledAt: new Date().toISOString() } : entry),
      },
    }));
    const change = { id: `state-change-${crypto.randomUUID()}`, type: kind, value: item, returnId, episodeId: activeEpisode.id, owner: activeProject.ownerName, createdAt: new Date().toISOString(), authority: AUTHORITY_STATES.AUTHORITATIVE };
    updateProject(activeProject.id, (project) => ({
      ...project,
      state: { id: `state-${crypto.randomUUID()}`, summary: kind === "claim" ? item : project.state?.summary ?? "Evidence accepted from a Return Packet.", sourceIds: kind === "evidence" ? [...new Set([...(project.state?.sourceIds ?? []), item])] : project.state?.sourceIds ?? [], authority: AUTHORITY_STATES.AUTHORITATIVE, createdAt: change.createdAt },
      stateHistory: [...(project.stateHistory ?? []), change],
    }));
    appendActivity(activeEpisode.id, { type: `return.${kind}_accepted`, actor: "human", title: `${kind === "claim" ? "Claim" : "Evidence"} accepted into Project State`, summary: item, authorityImpact: "accepted" });
  }

  function rejectReturn(returnId) {
    if (!activeEpisode) return;
    updateEpisode(activeEpisode.id, (episode) => ({ ...episode, governance: { ...episode.governance, returns: episode.governance.returns.map((entry) => entry.id === returnId ? { ...entry, status: "rejected", reconciledAt: new Date().toISOString() } : entry) } }));
    appendActivity(activeEpisode.id, { type: "return.rejected", actor: "human", title: "Return rejected", summary: "No returned evidence or claims changed Project State.", authorityImpact: "human-review" });
  }
''', '''  function acceptReadback() {
    if (!activeEpisode?.governance?.readback || activeEpisode.governance.readback.status !== "proposed") return;
    updateEpisode(activeEpisode.id, (episode) => ({
      ...episode,
      governance: {
        ...episode.governance,
        readback: { ...episode.governance.readback, status: "accepted", acceptedAt: new Date().toISOString() },
      },
    }));
    appendActivity(activeEpisode.id, { type: "readback.accepted", actor: "human", title: "Context accepted", summary: "The owner accepted the system readback. Work is still not authorized.", authorityImpact: "accepted" });
  }

  function requestReadbackRevision() {
    if (!activeEpisode?.governance?.readback) return;
    const instruction = window.prompt("What should the revised Readback change or clarify?", "Clarify the current context, conflicts, or proposed bounded work.");
    if (!instruction?.trim()) return;
    const previous = activeEpisode.governance.readback;
    updateEpisode(activeEpisode.id, (episode) => ({
      ...episode,
      governance: {
        ...episode.governance,
        readbackHistory: [...(episode.governance.readbackHistory ?? []), previous],
        readback: createReadback(episode, { revisionOf: previous.id, revisionInstruction: instruction.trim() }),
      },
    }));
    appendActivity(activeEpisode.id, { type: "readback.revision_requested", actor: "human", title: "Readback revision requested", summary: instruction.trim(), authorityImpact: "human-review" });
  }

  function authorizeAutopilotAnalysis() {
    if (!activeEpisode?.governance?.readback || activeEpisode.governance.readback.status !== "accepted") return;
    if (!activeProject?.state?.id || activeEpisode.governance?.baseline?.projectStateId !== activeProject.state.id) {
      appendActivity(activeEpisode.id, { type: "lease.authorization_blocked", actor: "system", title: "Work Lease not authorized", summary: "Episode baseline is stale or missing. Re-baseline the Episode before authorizing work.", authorityImpact: "prohibited" });
      return;
    }
    const provisionalRoute = createAgentRoute({ role: "Read-only technical analyst" });
    const lease = createWorkLease({ episode: activeEpisode, agentRoute: provisionalRoute, objective: activeEpisode.title });
    const route = { ...provisionalRoute, leaseId: lease.id, authority: AUTHORITY_STATES.AUTHORIZED };
    const nextEpisode = {
      ...activeEpisode,
      governance: {
        ...activeEpisode.governance,
        workLeases: [...(activeEpisode.governance.workLeases ?? []), lease],
        agentRoutes: [...(activeEpisode.governance.agentRoutes ?? []), route],
      },
    };
    updateEpisode(activeEpisode.id, () => nextEpisode);
    appendActivity(activeEpisode.id, { type: "lease.authorized", actor: "human", title: "Read-only Work Lease authorized", summary: `One bounded Codex analysis run is authorized under ${lease.id}.`, authorityImpact: "authorized" });
    void runAutopilotEpisode(nextEpisode, "Authorized by the owner through a one-run read-only Work Lease.");
  }

  function acceptReturnItem(returnId, kind, item) {
    if (!activeEpisode) return;
    const returnPacket = activeEpisode.governance?.returns?.find((entry) => entry.id === returnId);
    if (!returnPacket || returnPacket.status !== "returned") return;
    const key = kind === "evidence" ? "acceptedEvidence" : "acceptedClaims";
    if (returnPacket[key]?.includes(item)) return;
    updateEpisode(activeEpisode.id, (episode) => ({
      ...episode,
      governance: {
        ...episode.governance,
        returns: episode.governance.returns.map((entry) => entry.id === returnId ? { ...entry, [key]: [...(entry[key] ?? []), item], reconciliationStatus: "staged" } : entry),
      },
    }));
    appendActivity(activeEpisode.id, { type: `return.${kind}_staged`, actor: "human", title: `${kind === "claim" ? "Claim" : "Evidence"} staged for reconciliation`, summary: item, authorityImpact: "human-review" });
  }

  function commitReturnReconciliation(returnId) {
    if (!activeEpisode || !activeProject) return;
    const returnPacket = activeEpisode.governance?.returns?.find((entry) => entry.id === returnId);
    if (!returnPacket || returnPacket.status !== "returned") return;
    const evidence = returnPacket.acceptedEvidence ?? [];
    const claims = returnPacket.acceptedClaims ?? [];
    if (evidence.length === 0 && claims.length === 0) return;
    const now = new Date().toISOString();
    const summary = claims.at(-1) ?? activeProject.state?.summary ?? "Evidence accepted from a Return Packet.";
    const change = { id: `state-change-${crypto.randomUUID()}`, type: "reconciliation", value: summary, evidence, claims, returnId, episodeId: activeEpisode.id, owner: activeProject.ownerName, createdAt: now, authority: AUTHORITY_STATES.AUTHORITATIVE };
    updateProject(activeProject.id, (project) => ({
      ...project,
      state: { id: `state-${crypto.randomUUID()}`, summary, sourceIds: [...new Set([...(project.state?.sourceIds ?? []), ...evidence])], authority: AUTHORITY_STATES.AUTHORITATIVE, createdAt: now },
      stateHistory: [...(project.stateHistory ?? []), change],
    }));
    updateEpisode(activeEpisode.id, (episode) => ({ ...episode, governance: { ...episode.governance, returns: episode.governance.returns.map((entry) => entry.id === returnId ? { ...entry, status: "accepted", reconciliationStatus: "committed", reconciledAt: now } : entry) } }));
    appendActivity(activeEpisode.id, { type: "return.reconciliation_committed", actor: "human", title: "Return reconciliation accepted", summary: `${evidence.length} evidence item${evidence.length === 1 ? "" : "s"} and ${claims.length} claim${claims.length === 1 ? "" : "s"} committed atomically to Project State.`, authorityImpact: "accepted" });
  }

  function rejectReturn(returnId) {
    if (!activeEpisode) return;
    const returnPacket = activeEpisode.governance?.returns?.find((entry) => entry.id === returnId);
    if (!returnPacket || returnPacket.status !== "returned") return;
    updateEpisode(activeEpisode.id, (episode) => ({ ...episode, governance: { ...episode.governance, returns: episode.governance.returns.map((entry) => entry.id === returnId ? { ...entry, status: "rejected", acceptedEvidence: [], acceptedClaims: [], reconciliationStatus: "rejected", reconciledAt: new Date().toISOString() } : entry) } }));
    appendActivity(activeEpisode.id, { type: "return.rejected", actor: "human", title: "Return rejected", summary: "The staged reconciliation was discarded. Project State was not changed by this Return Packet.", authorityImpact: "human-review" });
  }
''')

replace_once("src/App.jsx", '    if (activeEpisode.governance?.readback?.status !== "accepted" || !activeEpisode.governance?.baseline) {\n      appendActivity(activeEpisode.id, { type: "orchestration.authorization_blocked", actor: "system", title: "Orchestration not authorized", summary: "Accept the Readback and capture an Episode baseline before authorizing this run.", relatedNodeId: orchestrationNodeId, authorityImpact: "prohibited" });\n      return;\n    }', '    if (activeEpisode.governance?.readback?.status !== "accepted" || !activeEpisode.governance?.baseline || !activeProject?.state?.id || activeEpisode.governance.baseline.projectStateId !== activeProject.state.id) {\n      appendActivity(activeEpisode.id, { type: "orchestration.authorization_blocked", actor: "system", title: "Orchestration not authorized", summary: "Accept the Readback and ensure the Episode baseline matches current Project State before authorizing this run.", relatedNodeId: orchestrationNodeId, authorityImpact: "prohibited" });\n      return;\n    }')
replace_once("src/App.jsx", '    const leaseValidation = validateWorkLease({ lease, episodeId: activeEpisode.id, baselineId: activeEpisode.governance?.baseline?.id ?? null, action: "orchestration" });', '    const leaseValidation = validateWorkLease({ lease, episodeId: activeEpisode.id, baselineId: activeEpisode.governance?.baseline?.id ?? null, action: "orchestration", projectStateId: activeProject?.state?.id ?? null });')
replace_once("src/App.jsx", '          baseline: activeEpisode.governance.baseline,\n          workLease: lease,', '          baseline: activeEpisode.governance.baseline,\n          projectState: activeProject?.state ?? null,\n          workLease: lease,')
replace_once("src/App.jsx", '''      eventSource.onerror = () => {
        if (eventSource.readyState === EventSource.CLOSED || orchestrationEventSourceRef.current !== eventSource) return;
        setOrchestrationRun((current) => current ? { ...current, status: "error", error: "Local orchestration runtime unavailable." } : current);
        eventSource.close();
        orchestrationEventSourceRef.current = null;
      };''', '''      eventSource.onerror = () => {
        if (eventSource.readyState === EventSource.CLOSED || orchestrationEventSourceRef.current !== eventSource) return;
        setOrchestrationRun((current) => current ? { ...current, status: "error", error: "Local orchestration runtime unavailable." } : current);
        updateEpisode(activeEpisode.id, (episode) => ({ ...episode, governance: { ...episode.governance, workLeases: episode.governance.workLeases.map((item) => item.id === lease.id ? { ...item, status: "expired", completedAt: new Date().toISOString() } : item), agentRoutes: episode.governance.agentRoutes.map((item) => item.leaseId === lease.id ? { ...item, status: "expired" } : item) } }));
        eventSource.close();
        orchestrationEventSourceRef.current = null;
      };''')
replace_once("src/App.jsx", '''    } catch (error) {
      setOrchestrationRun((current) => current ? { ...current, status: "error", error: error.message } : current);
      saveOrchestrationPreview(orchestrationNodeId, { ...preview, runStatus: "error", error: error.message });
      appendActivity(activeEpisode.id, { type: "orchestration.run_failed", actor: "codex", title: "Read-only orchestration failed", summary: error.message, relatedNodeId: orchestrationNodeId, authorityImpact: "analysis" });
    }''', '''    } catch (error) {
      setOrchestrationRun((current) => current ? { ...current, status: "error", error: error.message } : current);
      saveOrchestrationPreview(orchestrationNodeId, { ...preview, runStatus: "error", error: error.message });
      updateEpisode(activeEpisode.id, (episode) => ({ ...episode, governance: { ...episode.governance, workLeases: episode.governance.workLeases.map((item) => item.id === lease.id ? { ...item, status: "expired", completedAt: new Date().toISOString() } : item), agentRoutes: episode.governance.agentRoutes.map((item) => item.leaseId === lease.id ? { ...item, status: "expired" } : item) } }));
      appendActivity(activeEpisode.id, { type: "orchestration.run_failed", actor: "codex", title: "Read-only orchestration failed", summary: error.message, relatedNodeId: orchestrationNodeId, authorityImpact: "analysis" });
    }''')

replace_once("src/App.jsx", '        readback: null,\n        workLeases: [],', '        readback: null,\n        readbackHistory: [],\n        workLeases: [],')
replace_once("src/App.jsx", '        actor: "codex",\n        title: "Readback ready for owner review",\n        summary: "Codex proposed its context understanding. No work has been authorized.",', '        actor: "system",\n        title: "Readback ready for owner review",\n        summary: "The Workroom generated a bounded context readback. No work has been authorized.",')
replace_once("src/App.jsx", '    const lease = (episode.governance?.workLeases ?? []).find((item) => item.status === "active" && item.action === "analysis");\n    const leaseValidation = validateWorkLease({ lease, episodeId: episode.id, baselineId: episode.governance?.baseline?.id ?? null, action: "analysis" });', '    const lease = (episode.governance?.workLeases ?? []).find((item) => item.status === "active" && item.action === "analysis");\n    const project = episode.projectId ? projects.find((item) => item.id === episode.projectId) ?? null : null;\n    const leaseValidation = validateWorkLease({ lease, episodeId: episode.id, baselineId: episode.governance?.baseline?.id ?? null, action: "analysis", projectStateId: project?.state?.id ?? null });')
replace_once("src/App.jsx", 'humanReviewStatus: "pending", events: [], context:', 'humanReviewStatus: "pending", workLeaseId: lease.id, events: [], context:')
replace_once("src/App.jsx", 'consent: true, baseline: episode.governance?.baseline, workLease: lease, agentRoute: route', 'consent: true, baseline: episode.governance?.baseline, projectState: project?.state ?? null, workLease: lease, agentRoute: route')
replace_once("src/App.jsx", '''      eventSource.onerror = () => {
        if (eventSource.readyState === EventSource.CLOSED || autopilotEventSourceRef.current !== eventSource) return;
        updateEpisode(episode.id, (current) => ({ ...current, autopilotRun: { ...(current.autopilotRun ?? initial), status: "error", error: "Local Autopilot runtime unavailable." } }));
        eventSource.close(); autopilotEventSourceRef.current = null;
      };''', '''      eventSource.onerror = () => {
        if (eventSource.readyState === EventSource.CLOSED || autopilotEventSourceRef.current !== eventSource) return;
        updateEpisode(episode.id, (current) => ({ ...current, governance: { ...current.governance, workLeases: current.governance.workLeases.map((item) => item.id === lease.id ? { ...item, status: "expired", completedAt: new Date().toISOString() } : item), agentRoutes: current.governance.agentRoutes.map((item) => item.leaseId === lease.id ? { ...item, status: "expired" } : item) }, autopilotRun: { ...(current.autopilotRun ?? initial), status: "error", error: "Local Autopilot runtime unavailable." } }));
        eventSource.close(); autopilotEventSourceRef.current = null;
      };''')
replace_once("src/App.jsx", '      updateEpisode(episode.id, (current) => ({ ...current, autopilotRun: { ...(current.autopilotRun ?? failedRun), ...failedRun } }));', '      updateEpisode(episode.id, (current) => ({ ...current, governance: { ...current.governance, workLeases: current.governance.workLeases.map((item) => item.id === lease.id ? { ...item, status: "expired", completedAt: new Date().toISOString() } : item), agentRoutes: current.governance.agentRoutes.map((item) => item.leaseId === lease.id ? { ...item, status: "expired" } : item) }, autopilotRun: { ...(current.autopilotRun ?? failedRun), ...failedRun } }));')
replace_once("src/App.jsx", '    if (activeEpisode) updateEpisode(activeEpisode.id, (episode) => ({ ...episode, governance: { ...episode.governance, workLeases: episode.governance.workLeases.map((lease) => lease.status === "active" ? { ...lease, status: "cancelled", completedAt: new Date().toISOString() } : lease) }, autopilotRun: { ...(episode.autopilotRun ?? {}), status: "cancelled", finishedAt: new Date().toISOString() } }));', '    if (activeEpisode) updateEpisode(activeEpisode.id, (episode) => ({ ...episode, governance: { ...episode.governance, workLeases: episode.governance.workLeases.map((lease) => lease.id === episode.autopilotRun?.workLeaseId ? { ...lease, status: "cancelled", completedAt: new Date().toISOString() } : lease), agentRoutes: episode.governance.agentRoutes.map((route) => route.leaseId === episode.autopilotRun?.workLeaseId ? { ...route, status: "cancelled" } : route) }, autopilotRun: { ...(episode.autopilotRun ?? {}), status: "cancelled", finishedAt: new Date().toISOString() } }));')
replace_once("src/App.jsx", '''  function promoteAutopilotPackage() {
    if (!activeEpisode?.autopilotRun?.finalPackage) return;
    const packageValue = activeEpisode.autopilotRun.finalPackage;
    updateEpisode(activeEpisode.id, (episode) => ({ ...episode, context: `${episode.context ?? ""}\n\nTrusted context package:\n${packageValue.summary}`, autopilotRun: { ...episode.autopilotRun, humanReviewStatus: "promoted" } }));
    appendActivity(activeEpisode.id, { type: "autopilot.package_promoted", actor: "human", title: "Autopilot package promoted", summary: "Trusted context updated; stage and disposition unchanged.", authorityImpact: "human-review" });
  }
''', '''  function promoteAutopilotPackage() {
    if (!activeEpisode?.autopilotRun?.finalPackage) return;
    const returnPacket = activeEpisode.governance?.returns?.find((entry) => entry.runId === activeEpisode.autopilotRun.runId) ?? activeEpisode.governance?.returns?.at(-1);
    if (!returnPacket || returnPacket.status !== "returned") return;
    updateEpisode(activeEpisode.id, (episode) => ({
      ...episode,
      governance: { ...episode.governance, returns: episode.governance.returns.map((entry) => entry.id === returnPacket.id ? { ...entry, acceptedEvidence: [...entry.evidence], acceptedClaims: [...entry.claims], reconciliationStatus: "staged" } : entry) },
      autopilotRun: { ...episode.autopilotRun, humanReviewStatus: "reconciliation-staged" },
    }));
    appendActivity(activeEpisode.id, { type: "autopilot.package_staged", actor: "human", title: "Autopilot package staged for reconciliation", summary: "Nothing became trusted or authoritative yet. Confirm the staged Return Packet in the governance panel to change Project State.", authorityImpact: "human-review" });
  }
''')
replace_once("src/App.jsx", '              onAcceptReturnItem={acceptReturnItem}\n              onRejectReturn={rejectReturn}', '              onAcceptReturnItem={acceptReturnItem}\n              onCommitReturn={commitReturnReconciliation}\n              onRejectReturn={rejectReturn}')
replace_once("src/App.jsx", 'finalReviewReady = autopilot?.status === "complete" && autopilot.finalPackage;', 'finalReviewReady = autopilot?.status === "complete" && autopilot.finalPackage;')
replace_once("src/App.jsx", 'nextDetail = "The run is complete. You can promote trusted context, request a revised run, or keep the package as inspectable draft work.";', 'nextDetail = "The run is complete. You can stage its Return Packet for reconciliation, request a revised run, or keep the package as inspectable draft work.";')
replace_once("src/App.jsx", '>Promote as trusted context</button>', '>Stage for reconciliation</button>')

replace_once("server/autopilotAgent.mjs", '  const leaseValidation = validateWorkLease({ lease: input.workLease, episodeId: input.episodeId, baselineId: input.baseline.id, action: "analysis" });', '  const leaseValidation = validateWorkLease({ lease: input.workLease, episodeId: input.episodeId, baselineId: input.baseline.id, action: "analysis", projectStateId: input.projectState?.id ?? null });')
replace_once("server/orchestrationAgent.mjs", '  const leaseValidation = validateWorkLease({ lease: input.workLease, episodeId: input.episodeId, baselineId: input.baseline.id, action: "orchestration" });', '  const leaseValidation = validateWorkLease({ lease: input.workLease, episodeId: input.episodeId, baselineId: input.baseline.id, action: "orchestration", projectStateId: input.projectState?.id ?? null });')

Path("test/governance.test.js").write_text(r'''import assert from "node:assert/strict";
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
''')

replace_once("test/orchestration.test.js", 'const leaseEpisode = { id: "E0-001", governance: { baseline: { id: "baseline-1" }, ownerName: "Owner" } };', 'const leaseEpisode = { id: "E0-001", projectId: "project-1", governance: { baseline: { id: "baseline-1", projectStateId: "state-1" }, ownerName: "Owner" } };')
old = '    baseline: leaseEpisode.governance.baseline,\n    workLease,'
new = '    baseline: leaseEpisode.governance.baseline,\n    projectState: { id: "state-1" },\n    workLease,'
if Path("test/orchestration.test.js").read_text().count(old) != 2:
    raise SystemExit("Expected two orchestration test fixtures")
Path("test/orchestration.test.js").write_text(Path("test/orchestration.test.js").read_text().replace(old, new))

readme = Path("README.md").read_text()
readme = readme.replace('**Autopilot Episode Runs** — consented agent-assisted episodes automatically run one bounded maximum-five-turn pipeline: intake planner, up to three dependency-aware specialists, and final synthesis/review. The draft plan remains unaccepted and the final package always requires human review.', '**Autopilot Episode Runs** — agent-assisted episodes create a system Readback first. A human must accept that context and issue a one-run Work Lease against the current Episode baseline before the bounded maximum-five-turn pipeline can execute. The draft plan remains unaccepted and the final package returns with no authority until human reconciliation.')
readme = readme.replace('Autopilot adds an episode-local `autopilotRun` record to compatible episodes.', 'Governance is stored with each Episode as an immutable baseline snapshot, current system Readback plus revision history, Work Leases, Agent Routes, and Return Packets. Project State is separately human-owned and changing it makes older Episode baselines stale until they are explicitly re-baselined.\n\nAutopilot adds an episode-local `autopilotRun` record to compatible episodes.')
readme = readme.replace('Promotion of a final package updates trusted context only; it does not accept workflow structure, advance a stage, or record disposition.', 'The Autopilot “Promote” action only stages its Return Packet for reconciliation; it does not update trusted context or Project State. Project State changes only when a human commits a staged reconciliation atomically.')
readme = readme.replace('Agent-assisted creation shows a maximum-five-turn guard and starts one bounded Autopilot run after consent.', 'Agent-assisted creation shows a maximum-five-turn guard, generates a system Readback, and waits for explicit human context acceptance plus a current-baseline Work Lease before any bounded Autopilot run starts.')
readme = readme.replace('│   ├── autopilot.js         # Five-turn scheduling, state, output, and authority contracts', '│   ├── autopilot.js         # Five-turn scheduling, state, output, and authority contracts\n│   ├── governance.js        # Project state, baselines, readbacks, leases, routes, returns, and validation')
readme = readme.replace('The test script currently covers intake graph/checkpoint validation, source extraction fixtures, targeted orchestration, Autopilot scheduling/state/output contracts, and planner Episode-ID validation.', 'The test script currently covers governance baseline/lease invariants, readback and Return Packet contracts, intake graph/checkpoint validation, source extraction fixtures, targeted orchestration, Autopilot scheduling/state/output contracts, and planner Episode-ID validation.')
Path("README.md").write_text(readme)

Path(".github/workflows/governance-ci.yml").write_text('''name: Governance CI\n\non:\n  push:\n    branches:\n      - codex/governance-mvp\n  pull_request:\n\npermissions:\n  contents: read\n\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n          cache: npm\n      - run: npm ci\n      - run: npm run test:intake\n      - run: npm run build\n      - run: npm run lint\n''')
