import {
  Component,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";

import {
  getTraceGraph,
  getWorkflowEdgeKey,
  layoutWorkflowNodes,
} from "./workflowLayout";

import { useWebMCP } from "use-webmcp-tool";

import {
  createOrchestrationPlan,
  createOrchestrationRequest,
  getOrchestrationPlanSummary,
  applyOrchestrationEvent,
  mapOrchestrationArtifacts,
  selectOrchestrationTasks,
} from "./orchestration";

import {
  MAX_AUTOPILOT_TURNS,
  applyAutopilotEvent,
  mapAutopilotArtifact,
} from "./autopilot";

import {
  createEpisodeIntakeRequest,
  createWorkflowGateEdges,
  createWorkflowGates,
  normalizeEpisodeIntake,
  validateEpisodeStructureProposal,
} from "./episodeIntake";

import {
  MAX_SOURCE_FILES,
  SOURCE_TEXT_LIMIT,
  deleteEpisodeSources,
  extractSourceFile,
  getEpisodeSource,
  saveEpisodeSources,
  sourceManifestFromRecords,
  validateSourceManifest,
} from "./episodeSources";

import {
  PROJECTS_STORAGE_KEY,
  normalizeProjects,
} from "./projects";

import {
  AUTHORITY_STATES,
  createAgentRoute,
  createEpisodeBaseline,
  createReadback,
  createReturnPacket,
  createWorkLease,
  normalizeEpisodeGovernance,
  validateWorkLease,
} from "./governance";

import StatusIndicator from "./StatusIndicator";

import "./App.css";

const SOURCE_TRUNCATION_NOTE = "\n\n[Source text truncated for analysis; the full file remains available locally.]";

function sourceForAnalysis(source, stored) {
  const text = String(stored?.text ?? "").trim();
  const boundedText = text.length > SOURCE_TEXT_LIMIT
    ? `${text.slice(0, SOURCE_TEXT_LIMIT - SOURCE_TRUNCATION_NOTE.length)}${SOURCE_TRUNCATION_NOTE}`
    : text;

  return { ...source, text: boundedText };
}

/* -------------------------------------------------------------------------- */
/* STORAGE                                                                    */
/* -------------------------------------------------------------------------- */

const STORAGE_KEY = "ssi-wrx-workroom-v4";

const DURABLE_ARTIFACT_KINDS = new Set([
  "evidence",
  "gap",
  "gaps",
  "conflict",
  "recommendation",
  "action",
  "evaluation",
  "decision",
  "human-required",
]);

function isDurableArtifact(item) {
  return DURABLE_ARTIFACT_KINDS.has(item?.kind);
}

function isGeneratedRunArtifact(item) {
  return item?.id?.startsWith("autopilot-") || item?.id?.startsWith("orchestration-artifact-");
}

function layoutGeneratedReviewArtifacts(episode, stageIndex, basePositions) {
  const artifacts = (episode.additions ?? []).filter(
    (item) => item.stageIndex === stageIndex && isDurableArtifact(item) && isGeneratedRunArtifact(item)
  );
  const baseCoordinates = [...basePositions.values()];
  const laneX = Math.max(420, ...baseCoordinates.map((position) => position.x)) + 460;
  const laneY = Math.min(80, ...baseCoordinates.map((position) => position.y));

  return new Map(
    artifacts.map((artifact, index) => [artifact.id, {
      x: laneX,
      y: laneY + index * 330,
    }])
  );
}

function getArtifactTaskId(item) {
  if (item?.metadata?.taskId) return item.metadata.taskId;
  return null;
}

function compactArtifactSummary(value) {
  const summary = value?.replace(/\s+/g, " ").trim() ?? "";
  if (summary.length <= 120) return summary;
  return `${summary.slice(0, 117).replace(/\s+$/, "")}…`;
}

function markdownList(items, fallback = "Not recorded.") {
  return items?.length ? items.map((item) => `- ${item}`) : [`- ${fallback}`];
}

function createActivityEvent({
  episodeId,
  type,
  actor,
  title,
  summary = "",
  metadata = {},
  relatedNodeId = null,
  authorityImpact = null,
}) {
  return {
    id: `activity-${crypto.randomUUID()}`,
    episodeId,
    timestamp: new Date().toISOString(),
    type,
    actor: { kind: actor },
    title,
    summary,
    metadata,
    relatedNodeId,
    authorityImpact,
  };
}

function getLatestAgentNotification(events = []) {
  return events.filter((event) => event.actor?.kind === "codex" || event.actor?.kind === "system").at(-1) ?? null;
}

function deriveEpisodeName(title) {
  const value = title?.replace(/\s+/g, " ").trim() ?? "";
  if (!value) return "Untitled episode";
  if (/weekly huddle.*follow.?up/i.test(value)) return "Huddle follow-up workflow";
  if (/reconstructed workflow.*evidence|workflow.*explicit evidence/i.test(value)) return "Workflow validation";
  if (/meeting.*unclear.*next/i.test(value)) return "Product huddle follow-up";
  const words = value.replace(/[?!.:,;]/g, "").split(" ").slice(0, 6);
  const result = words.join(" ");
  return `${result.slice(0, 42).replace(/\s+$/, "")}${result.length > 42 || words.length < value.split(" ").length ? "…" : ""}`;
}

function getContextSummary(episode) {
  const rawContext = episode?.context?.trim() ?? "";
  const summary = rawContext
    ? rawContext.replace(/\s+/g, " ").trim()
    : "No additional context provided.";

  return {
    source: episode?.title ?? "Synthetic episode",
    summary,
    highlights: rawContext ? [summary] : [],
  };
}

/* -------------------------------------------------------------------------- */
/* WORKFLOW                                                                   */
/* -------------------------------------------------------------------------- */

const EPISODE_STAGES = [
  {
    name: "Understand the work",

    title: "Understand what we are working through",

    description:
      "Recover the relevant workflow, context, evidence, hidden judgment, constraints, and unknowns before evaluating what should happen next.",

    nodes: [
      {
        id: "work",
        type: "Episode",
        title: "What are we working on?",
        position: {
          x: 420,
          y: 60,
        },
      },

      {
        id: "context",
        type: "Known context",
        title: "Relevant context for this episode",
        position: {
          x: 120,
          y: 320,
        },
      },

      {
        id: "inquiry",
        type: "Working inquiry",
        title:
          "Recover workflow, evidence, hidden judgment, authority, constraints, and unknowns.",
        position: {
          x: 720,
          y: 320,
        },
      },

      {
        id: "gate",
        type: "Stage gate",
        title:
          "Do we understand enough to evaluate or validate this work?",
        kind: "gate",
        position: {
          x: 420,
          y: 620,
        },
      },
    ],

    edges: [
      ["work", "context"],
      ["work", "inquiry"],
      ["context", "gate"],
      ["inquiry", "gate"],
    ],
  },

  {
    name: "Evaluate / validate",

    title: "Evaluate what the evidence justifies",

    description:
      "Inspect retained evidence, conflicts, missing information, risks, and candidate recommendations before asking for human judgment.",

    nodes: [
      {
        id: "evidence",
        type: "Evidence",
        title:
          "What evidence currently supports the work?",
        position: {
          x: 70,
          y: 140,
        },
      },

      {
        id: "gaps",
        type: "Gaps / conflicts",
        title:
          "What conflicts, exceptions, or missing evidence remain?",
        position: {
          x: 410,
          y: 140,
        },
      },

      {
        id: "recommendation",
        type: "Agent judgment",
        title:
          "What is the smallest justified next action?",
        position: {
          x: 750,
          y: 140,
        },
      },

      {
        id: "evaluation",
        type: "Evaluation",
        title:
          "Has the candidate been evaluated strongly enough for human review?",
        position: {
          x: 410,
          y: 450,
        },
      },

      {
        id: "gate2",
        type: "Stage gate",
        title:
          "Is the episode ready for human disposition?",
        kind: "gate",
        position: {
          x: 410,
          y: 720,
        },
      },
    ],

    edges: [
      ["evidence", "evaluation"],
      ["gaps", "evaluation"],
      ["recommendation", "evaluation"],
      ["evaluation", "gate2"],
    ],
  },

  {
    name: "Human disposition",

    title: "Human disposition",

    description:
      "The agent stops here. Final disposition remains human-owned.",

    nodes: [
      {
        id: "human",
        type: "Human disposition",
        title:
          "Review the evidence and decide what happens next.",
        body:
          "Agent contributions remain inspectable, but the workflow cannot promote, pause, stop, or revise itself.",
        kind: "human",
        position: {
          x: 410,
          y: 220,
        },
      },
    ],

    edges: [],
  },
];

/* -------------------------------------------------------------------------- */
/* INITIAL EPISODES                                                           */
/* -------------------------------------------------------------------------- */

const INITIAL_EPISODES = [
  {
    id: "E0-001",

    title:
      "Recover weekly huddle workflow",

    context:
      "Understand how the weekly huddle becomes bounded follow-up work, including hidden judgment, exceptions, and authority boundaries.",

    currentStage: 0,

    status: "active",

    disposition: null,

    layouts: {},

    additions: [],
  },

  {
    id: "E0-002",

    title:
      "Validate reconstructed workflow",

    context:
      "Determine whether the reconstructed workflow contains enough explicit evidence and judgment to continue as a reusable candidate.",

    currentStage: 0,

    status: "active",

    disposition: null,

    layouts: {},

    additions: [],
  },

  {
    id: "E0-003",

    title:
      "Candidate readiness",

    context:
      "Determine the smallest justified next disposition while keeping final authority human-owned.",

    currentStage: 0,

    status: "active",

    disposition: null,

    layouts: {},

    additions: [],
  },
];

/* -------------------------------------------------------------------------- */
/* MESSAGE HELPERS                                                            */
/* -------------------------------------------------------------------------- */

function createMessage(
  role,
  content
) {
  return {
    id: `message-${crypto.randomUUID()}`,

    role,

    content,

    createdAt:
      new Date().toISOString(),
  };
}

function firstHumanMessage(
  thread
) {
  return (
    thread.messages?.find(
      (message) =>
        message.role === "human"
    ) ?? null
  );
}

function latestHumanMessage(
  thread
) {
  const messages =
    thread.messages ?? [];

  for (
    let index =
      messages.length - 1;
    index >= 0;
    index -= 1
  ) {
    if (
      messages[index].role ===
      "human"
    ) {
      return messages[index];
    }
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* MIGRATION                                                                  */
/* -------------------------------------------------------------------------- */

function remapOldParentNode(
  parentNodeId
) {
  const map = {
    decision: "work",
    candidate: "work",
    question: "work",

    workflow: "context",
    intention: "context",

    authority: "inquiry",

    evidence: "evidence",

    gap: "gaps",
    failure: "gaps",
    risk: "gaps",
    missing: "gaps",

    proposal: "recommendation",
    correction: "recommendation",

    eval: "evaluation",
    evaluation: "evaluation",
  };

  return (
    map[parentNodeId] ??
    parentNodeId
  );
}

function migrateAddition(
  item
) {
  if (
    item.kind === "prompt"
  ) {
    const messages = [];

    if (item.question) {
      messages.push({
        id:
          `${item.id}-human-initial`,

        role: "human",

        content:
          item.question,

        createdAt:
          item.createdAt ??
          new Date().toISOString(),
      });
    }

    if (item.response) {
      messages.push({
        id:
          `${item.id}-agent-initial`,

        role: "agent",

        content:
          item.response,

        createdAt:
          item.updatedAt ??
          new Date().toISOString(),
      });
    }

    return {
      ...item,

      kind: "thread",

      messages,

      status:
        item.status ??
        (item.response
          ? "answered"
          : "pending"),

      question: undefined,

      response: undefined,
    };
  }

  if (
    item.kind === "thread"
  ) {
    return {
      ...item,

      messages:
        item.messages ?? [],
    };
  }

  return item;
}

function normalizeAutopilotRun(run) {
  if (!run || typeof run !== "object") return null;
  if (!['queued', 'working'].includes(run.status)) return run;

  return {
    ...run,
    status: "cancelled",
    activeTaskId: null,
    activeNodeId: null,
    taskStates: Object.fromEntries(
      Object.entries(run.taskStates ?? {}).map(([taskId, status]) => [
        taskId,
        status === "working" ? "cancelled" : status,
      ])
    ),
    error: "This local run was interrupted when the browser session changed. Retry to start a new bounded run.",
  };
}

function normalizeEpisode(
  episode,
  index
) {
  const legacyContext = [
    episode.context,

    episode.objective &&
    episode.objective !==
      episode.title
      ? episode.objective
      : null,

    episode.intention
      ? `Governing intention: ${episode.intention}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    id:
      episode.id ??
      `E0-${String(
        index + 1
      ).padStart(
        3,
        "0"
      )}`,

    title:
      episode.title ??
      episode.objective ??
      `Episode ${index + 1}`,

    name:
      episode.name?.trim() ||
      deriveEpisodeName(episode.title ?? episode.objective),

    context:
      legacyContext,

    sources:
      Array.isArray(episode.sources) ? episode.sources : [],

    nodeSourceIds:
      episode.nodeSourceIds && typeof episode.nodeSourceIds === "object"
        ? episode.nodeSourceIds
        : {},

    template:
      episode.template && typeof episode.template === "object"
        ? episode.template
        : null,

    currentStage:
      Math.min(
        2,
        Math.max(
          0,
          episode.currentStage ??
            0
        )
      ),

    status:
      episode.status ??
      "active",

    disposition:
      episode.disposition ??
      null,

    layouts:
      episode.layouts ?? {},

    additions:
      (
        episode.additions ?? []
      ).map((item) => ({
        ...migrateAddition(
          item
        ),

        parentNodeId:
          item.parentNodeId
            ? remapOldParentNode(
                item.parentNodeId
              )
            : null,
      })),

    intake: normalizeEpisodeIntake(episode.intake),

    autopilotRun: normalizeAutopilotRun(episode.autopilotRun),

    workflow: {
      nodes: episode.workflow?.nodes ?? [],
      edges: episode.workflow?.edges ?? [],
      gates: episode.workflow?.gates ?? [],
    },

    projectId: episode.projectId ?? null,

    governance: normalizeEpisodeGovernance(episode),

    runtime: {
      codex: {
        intakeThreadId: episode.runtime?.codex?.intakeThreadId ?? null,
        lastRunAt: episode.runtime?.codex?.lastRunAt ?? null,
        lastError: episode.runtime?.codex?.lastError ?? null,
        orchestration: episode.runtime?.codex?.orchestration ?? {},
      },
    },

    activity: Array.isArray(episode.activity) ? episode.activity : [],
  };
}

function loadEpisodes() {
  try {
    const keys = [
      STORAGE_KEY,
      "ssi-wrx-workroom-v3",
      "ssi-wrx-multi-episode-v1",
    ];

    let raw = null;

    for (
      const key of keys
    ) {
      const value =
        localStorage.getItem(
          key
        );

      if (value) {
        raw = value;
        break;
      }
    }

    if (!raw) {
      return INITIAL_EPISODES.map(normalizeEpisode);
    }

    const parsed =
      JSON.parse(raw);

    if (
      !Array.isArray(parsed) ||
      parsed.length === 0
    ) {
      return INITIAL_EPISODES.map(normalizeEpisode);
    }

    return parsed.map(
      normalizeEpisode
    );
  } catch {
    return INITIAL_EPISODES.map(normalizeEpisode);
  }
}

function loadProjects() {
  try {
    const raw = localStorage.getItem(PROJECTS_STORAGE_KEY);
    return raw ? normalizeProjects(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* NEW EPISODE MODAL                                                         */
/* -------------------------------------------------------------------------- */

const EPISODE_TEMPLATES = [
  {
    id: "client-call-follow-up", version: 1, name: "Client-call follow-up", summary: "Turn a call into clear, reviewable ownership and next steps.", title: "Turn a client call into clear actions, owners, and a reviewable follow-up.", context: "Capture decisions, commitments, open questions, owners, deadlines, and anything that needs client confirmation. Draft only; a human reviews before anything is sent.", workflow: ["Recover decisions and commitments", "Check owners, dates, and missing context", "Human reviews the follow-up before sending"],
  },
  {
    id: "client-onboarding", version: 1, name: "Client onboarding", summary: "Build a dependable start that can become a repeatable client system.", title: "Validate a reliable and repeatable client onboarding workflow.", context: "Identify the required inputs, handoffs, constraints, evidence, and human approvals before this becomes a standard client process.", workflow: ["Collect required client inputs and constraints", "Validate handoffs, unknowns, and readiness", "Human confirms the launch path"],
  },
  {
    id: "research-decision-brief", version: 1, name: "Research and decision brief", summary: "Turn supplied evidence into a clear, risk-aware founder recommendation.", title: "Produce an evidence-backed recommendation for a founder decision.", context: "Gather supplied evidence, distinguish facts from assumptions, record risks and gaps, and prepare a concise human-review package.", workflow: ["Organize evidence, assumptions, and open questions", "Test risks, gaps, and candidate recommendations", "Human weighs the final recommendation"],
  },
  {
    id: "reporting-deliverable", version: 1, name: "Reporting and deliverable preparation", summary: "Prepare a consistent deliverable without losing the final quality check.", title: "Draft and validate a recurring client deliverable without losing review control.", context: "Define the source evidence, required checks, output structure, quality bar, and the human approval needed before delivery.", workflow: ["Define source material and output requirements", "Validate the draft against the quality bar", "Human approves the client-facing result"],
  },
];

function NewEpisodeModal({
  open,
  onClose,
  onCreate,
  projects = [],
  initialProjectId = null,
  onCreateProject,
}) {
  const [title, setTitle] =
    useState("");

  const [name, setName] =
    useState("");

  const [context, setContext] =
    useState("");

  const [setupMode, setSetupMode] =
    useState("manual");

  const [projectId, setProjectId] =
    useState(initialProjectId ?? "");

  const [sourceFiles, setSourceFiles] = useState([]);
  const [sourceError, setSourceError] = useState("");
  const [sourceConsent, setSourceConsent] = useState(false);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [sourceEvents, setSourceEvents] = useState([]);
  const [templateId, setTemplateId] = useState("");
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(
      event
    ) {
      if (
        event.key === "Escape"
      ) {
        onClose();
      }
    }

    window.addEventListener(
      "keydown",
      handleKeyDown
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown
      );
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setName("");
      setContext("");
      setSetupMode("manual");
      setProjectId(initialProjectId ?? "");
      setSourceFiles([]);
      setSourceError("");
      setSourceConsent(false);
      setSourceEvents([]);
      setTemplateId("");
      setTemplatePickerOpen(false);
    }
  }, [open, initialProjectId]);

  useEffect(() => {
    if (open && initialProjectId) setProjectId(initialProjectId);
  }, [open, initialProjectId]);

  if (!open) {
    return null;
  }

  function handleSubmit(
    event
  ) {
    event.preventDefault();

    const cleanTitle =
      title.trim();

    const cleanContext =
      context.trim();

    if (!cleanTitle) {
      return;
    }

    if (setupMode === "agent-assisted" && !sourceConsent) return;
    setSourceBusy(true);
    Promise.resolve(onCreate({
      title:
        cleanTitle,

      name:
        name.trim() || deriveEpisodeName(cleanTitle),

      context:
        cleanContext,

      setupMode,
      projectId: projectId || null,
      sources: sourceFiles,
      sourceEvents,
      sourceConsent,
      sourceConsentRequired: setupMode === "agent-assisted",
      template: EPISODE_TEMPLATES.find((template) => template.id === templateId) ?? null,
    })).catch((error) => setSourceError(error.message || "Could not create the Episode.")).finally(() => setSourceBusy(false));

    setTitle("");
    setContext("");
  }

  async function handleFiles(event) {
    const selected = [...event.target.files];
    event.target.value = "";
    setSourceError("");
    if (sourceFiles.length + selected.length > 10) {
      setSourceError("You can add up to 10 files.");
      return;
    }
    for (const file of selected) {
      try {
        const extracted = await extractSourceFile(file);
        setSourceFiles((current) => [...current, extracted]);
      } catch (error) {
        setSourceError(error.message);
        setSourceEvents((current) => [...current, { type: "source.extraction_failed", fileName: file.name, message: error.message }]);
        setSourceFiles((current) => [...current, {
          sourceId: `failed-source-${crypto.randomUUID()}`,
          fileName: file.name,
          fileType: file.type || "unknown",
          size: file.size,
          extractionStatus: "failed",
          charCount: 0,
          error: error.message,
        }]);
      }
    }
  }

  function selectTemplate(nextTemplateId) {
    const template = EPISODE_TEMPLATES.find((item) => item.id === nextTemplateId);
    setTemplateId(nextTemplateId);
    setTemplatePickerOpen(false);
    if (!template) return;
    setName(template.name);
    setTitle(template.title);
    setContext(template.context);
  }

  const selectedTemplate = EPISODE_TEMPLATES.find((template) => template.id === templateId) ?? null;

  return (
    <div
      className="episode-modal-overlay"
      onMouseDown={(
        event
      ) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose();
        }
      }}
    >
      <section
        className="episode-modal"
        role="dialog"
        aria-modal="true"
      >
        <div className="episode-modal-header">
          <div>
            <div className="episode-modal-eyebrow">
              New episode
            </div>

            <h2>
              Start something to
              work through
            </h2>

            <p>
              An episode is one
              bounded piece of work
              we want to understand,
              evaluate, validate, or
              reach a decision about.
            </p>
          </div>

          <button
            type="button"
            className="episode-modal-close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <form
          className="episode-modal-form"
          onSubmit={
            handleSubmit
          }
        >
          <section className="episode-template-picker" aria-label="Workflow template">
            <div className="episode-template-picker-label"><span>Start from a workflow <em>Optional</em></span><small>Templates prefill the brief; you still review the proposed workflow.</small></div>
            <button type="button" className={`episode-template-trigger ${templatePickerOpen ? "open" : ""}`} aria-expanded={templatePickerOpen} aria-controls="episode-template-options" onClick={() => setTemplatePickerOpen((value) => !value)}>
              <span className="episode-template-trigger-copy"><strong>{selectedTemplate?.name ?? "Choose a workflow template"}</strong><small>{selectedTemplate?.summary ?? "Start with a focused, reusable way of working."}</small></span>
              <span className="episode-template-trigger-icon" aria-hidden="true">⌄</span>
            </button>
            {templatePickerOpen && <div id="episode-template-options" className="episode-template-options" role="listbox" aria-label="Workflow templates">
              <button type="button" role="option" aria-selected={!selectedTemplate} className={!selectedTemplate ? "selected" : ""} onClick={() => selectTemplate("")}><strong>Start from a blank episode</strong><small>Shape the brief from scratch.</small></button>
              {EPISODE_TEMPLATES.map((template) => <button type="button" role="option" aria-selected={template.id === templateId} className={template.id === templateId ? "selected" : ""} key={template.id} onClick={() => selectTemplate(template.id)}><strong>{template.name}</strong><small>{template.summary}</small></button>)}
            </div>}
            {selectedTemplate && <div className="episode-template-overview" aria-live="polite">
              <div className="episode-template-overview-heading"><span>Workflow preview</span><strong>{selectedTemplate.name}</strong></div>
              <ol>{selectedTemplate.workflow.map((step, index) => <li key={step}><b>{index + 1}</b><span>{step}</span></li>)}</ol>
              <p><strong>Human checkpoint:</strong> Codex drafts and validates. You keep approval, stage movement, and client-facing decisions.</p>
            </div>}
          </section>
          <label className="episode-field">
            <span>
              What are we
              working on?

              <strong>
                Required
              </strong>
            </span>

            <textarea
              autoFocus
              rows="3"
              value={title}
              onChange={(
                event
              ) =>
                setTitle(
                  event.target
                    .value
                )
              }
              placeholder="e.g. What decision, handoff, or workflow do you need to work through?"
            />
          </label>

          <label className="episode-field source-upload-field">
            <span>Supporting material <em>Optional · up to 10 files, 10 MB each</em></span>
            <input type="file" multiple accept=".txt,.md,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={handleFiles} disabled={sourceFiles.length >= 10 || sourceBusy} />
          </label>

          {sourceFiles.length > 0 && <div className="source-file-list" aria-label="Selected source files">
            {sourceFiles.map((source) => <div className="source-file-row" key={source.sourceId}>
              <div><strong>{source.fileName}</strong><span>{source.fileType} · {(source.size / 1024).toFixed(1)} KB · {source.charCount.toLocaleString()} chars · {source.extractionStatus}{source.error ? ` · ${source.error}` : ""}</span></div>
              <button type="button" onClick={() => { setSourceEvents((current) => [...current, { type: "source.removed", sourceId: source.sourceId, fileName: source.fileName }]); setSourceFiles((current) => current.filter((item) => item.sourceId !== source.sourceId)); }}>Remove</button>
            </div>)}
          </div>}

          {sourceError && <div className="source-error" role="alert">{sourceError}</div>}

          <label className="episode-codex-choice">
            <input
              type="checkbox"
              checked={setupMode === "agent-assisted"}
              onChange={(event) => {
                const shouldAnalyze = event.target.checked;
                setSetupMode(shouldAnalyze ? "agent-assisted" : "manual");
                setSourceConsent(shouldAnalyze);
              }}
            />
            <span>
              <strong>Let Codex draft the workflow</strong>
              <small>It will run a bounded, read-only analysis and propose the next workflow for your review.</small>
            </span>
          </label>

          {setupMode === "agent-assisted" && <div className="episode-modal-cost-guard">Autopilot uses a maximum of five local Codex turns. It can propose work, but you keep approval, stage movement, and final decisions.</div>}

          <details className="episode-advanced-details">
            <summary>More details <span>Optional</span></summary>
            <div className="episode-advanced-details-content">
              <label className="episode-field project-select-field">
                <span>Project <em>Optional</em></span>
                <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                  <option value="">Unassigned</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
                <button type="button" className="text-button" onClick={onCreateProject}>+ Create new project</button>
              </label>

              <label className="episode-field">
                <span>Episode name <em>Optional</em></span>
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Product huddle follow-up" />
              </label>

              <label className="episode-field">
                <span>
                  Add context

                  <em>
                    Optional
                  </em>
                </span>

                <textarea
                  rows="4"
                  value={context}
                  onChange={(
                    event
                  ) =>
                    setContext(
                      event.target
                        .value
                    )
                  }
                  placeholder="Add any background, constraints, source material, or reason this episode matters."
                />
              </label>
            </div>
          </details>

          <div className="episode-modal-actions">
              <button
              type="button"
              className="episode-modal-button"
              onClick={onClose}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="episode-modal-button primary"
                disabled={
                !title.trim() || sourceBusy || (setupMode === "agent-assisted" && !sourceConsent)
              }
            >
              {sourceBusy ? "Preparing sources…" : setupMode === "agent-assisted"
                ? "Create & Analyze"
                : "Create Episode"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function NewProjectModal({ open, onClose, onCreate, project = null }) {
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");

  if (!open) return null;

  function handleSubmit(event) {
    event.preventDefault();
    if (!name.trim()) return;
    onCreate({ name: name.trim(), description: description.trim(), projectId: project?.id ?? null });
    setName("");
    setDescription("");
  }

  return (
    <div className="episode-modal-overlay project-modal-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="episode-modal project-modal" role="dialog" aria-modal="true">
        <div className="episode-modal-header">
          <div><div className="episode-modal-eyebrow">{project ? "Edit project" : "New project"}</div><h2>{project ? "Update project details" : "Organize related episodes"}</h2></div>
          <button type="button" className="episode-modal-close" onClick={onClose}>×</button>
        </div>
        <form className="episode-modal-form" onSubmit={handleSubmit}>
          <label className="episode-field"><span>Project name <strong>Required</strong></span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. SSI-WRX" /></label>
          <label className="episode-field"><span>Description <em>Optional</em></span><textarea rows="3" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
          <div className="episode-modal-actions">
            <button type="button" className="episode-modal-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="episode-modal-button primary" disabled={!name.trim()}>{project ? "Save changes" : "Create Project"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function RenameEpisodeModal({ open, episode, onClose, onSave }) {
  const [name, setName] = useState(episode?.name ?? "");

  useEffect(() => {
    if (open) setName(episode?.name ?? "");
  }, [open, episode]);

  if (!open || !episode) return null;

  function handleSubmit(event) {
    event.preventDefault();
    if (name.trim()) onSave(name.trim());
  }

  return (
    <div className="episode-modal-overlay project-modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="episode-modal project-modal" role="dialog" aria-modal="true">
        <div className="episode-modal-header"><div><div className="episode-modal-eyebrow">Rename episode</div><h2>Update navigation name</h2></div><button type="button" className="episode-modal-close" onClick={onClose}>×</button></div>
        <form className="episode-modal-form" onSubmit={handleSubmit}>
          <label className="episode-field"><span>Episode name <strong>Required</strong></span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label>
          <p className="rename-episode-note">This changes the sidebar label only. The full objective and Episode data stay intact.</p>
          <div className="episode-modal-actions"><button type="button" className="episode-modal-button" onClick={onClose}>Cancel</button><button type="submit" className="episode-modal-button primary" disabled={!name.trim()}>Save name</button></div>
        </form>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* MESSAGE BADGE                                                              */
/* -------------------------------------------------------------------------- */

function MessageBadge({
  count,
  pending,
  onClick,
}) {
  if (
    !count &&
    !pending
  ) {
    return null;
  }

  return (
    <button
      type="button"
      className={`node-message-badge nodrag ${
        pending
          ? "pending"
          : ""
      }`}
      onClick={(
        event
      ) => {
        event.stopPropagation();

        onClick?.();
      }}
      title="Open node thread"
    >
      <span>
        ◌
      </span>

      {count > 0 && (
        <strong>
          {count}
        </strong>
      )}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* NODES                                                                      */
/* -------------------------------------------------------------------------- */

function AgentIcon() {
  return (
    <svg className="agent-icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="4" width="10" height="9" rx="2" />
      <path d="M8 2v2M5.5 8h.01M10.5 8h.01M6 10.5h4" />
    </svg>
  );
}

function ActivityIcon() {
  return (
    <svg className="activity-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 4.5h2M2.5 8h3M2.5 11.5h2M7 4.5h6.5M8 8h5.5M7 11.5h6.5" />
      <circle cx="6" cy="4.5" r="1" />
      <circle cx="6" cy="11.5" r="1" />
    </svg>
  );
}

function NotificationIcon() {
  return (
    <svg className="notification-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 11.5h8l-1-1.5V7a3 3 0 0 0-6 0v3L4 11.5Z" />
      <path d="M6.5 13a1.7 1.7 0 0 0 3 0" />
    </svg>
  );
}

function CardNode({
  data,
  selected,
}) {
  return (
    <div
      className={`flow-node ${
        data.secondary
          ? "branch-node"
          : "core-node"
      } ${
        selected
          ? "selected"
          : ""
      } ${data.proposed ? "proposed-node" : ""} ${data.compactNode ? "compact-node" : ""} ${data.traceActive ? "trace-active-node" : data.traceDimmed ? "trace-dimmed-node" : ""}`}
    >
      <MessageBadge
        count={
          data.threadCount
        }
        pending={
          data.threadPending
        }
        onClick={
          data.onOpenThread
        }
      />

      {data.orchestrationEligible && data.orchestrationApproved && data.selected && (
        <OrchestrationBadge
          summary={data.orchestrationSummary}
          onClick={data.onOpenOrchestration}
        />
      )}

      <Handle
        type="target"
        position={
          Position.Top
        }
        id="flow-target"
        className="flow-handle"
      />

      <Handle
        type="target"
        position={
          Position.Left
        }
        id="branch-target"
        className="flow-handle branch-handle"
      />

      <div className="node-label">
        {data.label}
      </div>

      {data.autopilotStatus && <div className="node-autopilot-status"><StatusIndicator status={data.autopilotStatus === "completed" ? "complete" : data.autopilotStatus === "working" ? "working" : data.autopilotStatus === "failed" ? "error" : "waiting"} label={`Autopilot · ${data.autopilotStatus}`} size="sm" /></div>}

      {data.runArtifactCount > 0 && (
        <div className="node-run-output-count" title="Generated run outputs are available in the Run inspector">
          {data.runArtifactCount} run output{data.runArtifactCount === 1 ? "" : "s"}
        </div>
      )}

      <div className="node-title">
        {data.title}
      </div>

      {data.contextSummary && (
        <div className="context-summary">
          <strong>{data.contextSummary.source}</strong>
          <p>{data.contextSummary.summary}</p>
        </div>
      )}

      {data.body && (
        <div className="node-body">
          {data.compactNode || data.durableArtifact
            ? compactArtifactSummary(data.body)
            : data.body}
        </div>
      )}

      {data.meta && (
        <div className="node-meta">
          {data.meta}
        </div>
      )}

      {data.isContext && (
        <button
          type="button"
          className="context-view-button nodrag"
          onClick={(event) => {
            event.stopPropagation();
            data.onViewContext();
          }}
        >
          View context
        </button>
      )}

      {(data.durableArtifact || data.compactNode || (data.orchestrationEligible && data.selected)) && (
        <div className="node-action-row nodrag">
          <button
            type="button"
            className="action-button action-button-secondary"
            onClick={(event) => {
              event.stopPropagation();
              (data.onViewDetails ?? data.onOpenThread)?.();
            }}
          >
            View details
          </button>

          {data.orchestrationEligible && data.selected && (
            <button
              type="button"
              className="action-button action-button-primary node-orchestrate-button"
              onClick={(event) => {
                event.stopPropagation();
                data.onOpenOrchestration?.();
              }}
            >
              <AgentIcon />
              {data.orchestrationApproved ? "View orchestration" : "Orchestrate"}
            </button>
          )}
        </div>
      )}

      {data.selected && (
        <div className="node-action-row nodrag">
          <button
            type="button"
            className="action-button action-button-secondary"
            onClick={(event) => {
              event.stopPropagation();
              data.onTrace?.();
            }}
          >
            {data.traceActive ? "Clear trace" : "Trace workflow"}
          </button>
        </div>
      )}

      <Handle
        type="source"
        position={
          Position.Bottom
        }
        id="flow-source"
        className="flow-handle"
      />

      <Handle
        type="source"
        position={
          Position.Right
        }
        id="branch-source"
        className="flow-handle branch-handle"
      />
    </div>
  );
}

function GateNode({
  data,
  selected,
}) {
  return (
    <div
      className={`flow-node gate-node ${
        selected
          ? "selected"
          : ""
      } ${data.traceActive ? "trace-active-node" : data.traceDimmed ? "trace-dimmed-node" : ""}`}
    >
      <MessageBadge
        count={
          data.threadCount
        }
        pending={
          data.threadPending
        }
        onClick={
          data.onOpenThread
        }
      />

      <Handle
        type="target"
        position={
          Position.Top
        }
        id="flow-target"
        className="flow-handle"
      />

      <Handle
        type="target"
        position={
          Position.Left
        }
        id="branch-target"
        className="flow-handle branch-handle"
      />

      <div className="node-label">
        Stage gate
      </div>

      <div className="node-title">
        {data.title}
      </div>

      {data.checkpointDependencies?.length > 0 && (
        <div className="node-meta">
          After: {data.checkpointDependencies.join(", ")}
        </div>
      )}

      {data.completed ? (
        <div className="gate-complete">
          ✓ Completed
        </div>
      ) : data.canContinue ? (
        <button
          type="button"
          className="node-button primary nodrag"
          onClick={
            data.onContinue
          }
        >
          Continue to next
          stage →
        </button>
      ) : (
        <div className="node-meta">
          Inspecting
          completed stage
        </div>
      )}

      {data.selected && (
        <button
          type="button"
          className="action-button action-button-secondary nodrag"
          onClick={(event) => {
            event.stopPropagation();
            data.onTrace?.();
          }}
        >
          {data.traceActive ? "Clear trace" : "Trace workflow"}
        </button>
      )}

      <Handle
        type="source"
        position={
          Position.Bottom
        }
        id="flow-source"
        className="flow-handle"
      />

      <Handle
        type="source"
        position={
          Position.Right
        }
        id="branch-source"
        className="flow-handle branch-handle"
      />
    </div>
  );
}

function HumanNode({
  data,
  selected,
}) {
  return (
    <div
      className={`flow-node human-node ${
        selected
          ? "selected"
          : ""
      }`}
    >
      <MessageBadge
        count={
          data.threadCount
        }
        pending={
          data.threadPending
        }
        onClick={
          data.onOpenThread
        }
      />

      <Handle
        type="target"
        position={
          Position.Top
        }
        id="flow-target"
        className="flow-handle"
      />

      <Handle
        type="target"
        position={
          Position.Left
        }
        id="branch-target"
        className="flow-handle branch-handle"
      />

      <div className="node-label">
        Human disposition
      </div>

      <div className="node-title">
        {data.title}
      </div>

      {data.body && (
        <div className="node-body">
          {data.body}
        </div>
      )}

      {data.disposition ? (
        <div className="human-result">
          Recorded:{" "}
          {
            data.disposition
          }
        </div>
      ) : (
        <div className="disposition-actions nodrag">
          <button
            type="button"
            onClick={() =>
              data.onDisposition(
                "Revise"
              )
            }
          >
            Revise
          </button>

          <button
            type="button"
            onClick={() =>
              data.onDisposition(
                "Pause"
              )
            }
          >
            Pause
          </button>

          <button
            type="button"
            onClick={() =>
              data.onDisposition(
                "Stop"
              )
            }
          >
            Stop
          </button>

          <button
            type="button"
            className="primary"
            onClick={() =>
              data.onDisposition(
                "Promote"
              )
            }
          >
            Promote
          </button>
        </div>
      )}

      <Handle
        type="source"
        position={
          Position.Right
        }
        id="branch-source"
        className="flow-handle branch-handle"
      />
    </div>
  );
}

function ThreadNode({
  data,
  selected,
}) {
  return (
    <div
      className={`flow-node thread-node branch-node ${
        selected
          ? "selected"
          : ""
      }`}
    >
      <div
        className={`thread-node-count ${
          data.pending
            ? "pending"
            : ""
        }`}
      >
        ◌ {data.messageCount} {data.messageCount === 1 ? "message" : "messages"}
      </div>

      <Handle
        type="target"
        position={
          Position.Left
        }
        id="branch-target"
        className="flow-handle branch-handle"
      />

      <div className="node-label">
        Node thread
      </div>

      <div className="thread-question">
        {data.question}
      </div>

      {data.pending ? (
        <div className="thread-waiting">
          <span className="thread-waiting-dot" />

          Waiting for agent…
        </div>
      ) : (
        <>
          <div className="thread-preview-label">
            Latest response
          </div>

          <div className="thread-preview">
            {data.preview ||
              "No response yet."}
          </div>
        </>
      )}

      <button
        type="button"
        className="thread-open-button nodrag"
        onClick={(
          event
        ) => {
          event.stopPropagation();

          data.onOpen();
        }}
      >
        Open thread →
      </button>

      <Handle
        type="source"
        position={
          Position.Right
        }
        id="branch-source"
        className="flow-handle branch-handle"
      />
    </div>
  );
}

const NODE_TYPES = {
  card: CardNode,
  gate: GateNode,
  human: HumanNode,
  thread: ThreadNode,
  orchestration: OrchestrationPreviewNode,
  orchestrationOutput: OrchestrationOutputNode,
  intake: EpisodeIntakeNode,
};

const ORCHESTRATION_AGENTS = [
  {
    id: "research",
    role: "Research Agent",
    task: "Verify supporting evidence",
    status: "Complete",
    result: "6 sources retained",
  },
  {
    id: "builder",
    role: "Builder Agent",
    task: "Draft recommended follow-up",
    status: "Working",
    result: "Output pending",
  },
  {
    id: "analyst",
    role: "Analyst Agent",
    task: "Compare candidate actions",
    status: "Complete",
    result: "Recommendation prepared",
  },
  {
    id: "reviewer",
    role: "Reviewer Agent",
    task: "Independent review",
    status: "Human required",
    result: "2 unsupported claims need disposition",
  },
];

function orchestrationStatusClass(status) {
  return status.toLowerCase().replaceAll(" ", "-");
}

function _OrchestrationPreviewLayer({
  selectedId,
  onSelect,
  onClose,
}) {
  const humanAttentionRequired = ORCHESTRATION_AGENTS.some(
    (agent) => agent.status === "Human required"
  );
  const selectedAgent = ORCHESTRATION_AGENTS.find(
    (agent) => agent.id === selectedId
  );

  return (
    <div className="orchestration-preview-layer">
      <div className="orchestration-preview-head">
        <div>
          <div className="concept-preview-label">Concept preview</div>
          <strong>Read-only orchestration</strong>
        </div>

        <button
          type="button"
          className="orchestration-preview-close"
          onClick={onClose}
          aria-label="Close orchestration preview"
        >
          ×
        </button>
      </div>

      <svg
        className="orchestration-preview-edges"
        viewBox="0 0 640 350"
        aria-hidden="true"
      >
        <path d="M145 174 C165 174 164 73 190 73" />
        <path d="M145 174 C170 174 165 187 190 187" />
        <path d="M145 174 C255 174 270 73 370 73" />
        <path d="M145 174 C260 174 272 187 370 187" />
        <path d="M275 73 C325 73 328 248 365 248" />
        <path d="M275 187 C320 187 330 248 365 248" />
        <path d="M455 73 C480 73 480 248 505 248" />
        <path d="M455 187 C485 187 490 248 505 248" />
      </svg>

      <button
        type="button"
        className={`orchestration-first-mate ${
          humanAttentionRequired ? "attention" : ""
        }`}
        onClick={() => onSelect("first-mate")}
      >
        <span className="preview-node-label">First Mate</span>
        <strong>Orchestrator</strong>
        <span>3 specialist agents · 4 assigned tasks</span>
        <StatusIndicator status="complete" label="2 complete" size="sm" className="orchestration-summary-status" />
        <StatusIndicator status="working" label="1 working" size="sm" className="orchestration-summary-status" />
        <StatusIndicator status="human-required" label="1 human required" size="sm" className="orchestration-summary-status" />
        {humanAttentionRequired && (
          <StatusIndicator status="human-required" label="Human attention required" size="sm" className="orchestration-attention" />
        )}
      </button>

      <div className="orchestration-agent-grid">
        {ORCHESTRATION_AGENTS.map((agent) => (
          <button
            type="button"
            key={agent.id}
            className={`orchestration-agent-card ${
              selectedId === agent.id ? "selected" : ""
            }`}
            onClick={() => onSelect(agent.id)}
          >
            <span className="preview-node-label">{agent.role}</span>
            <strong>{agent.task}</strong>
            <StatusIndicator status={agent.status} label={agent.status} size="sm" className="preview-agent-status" />
            <span>{agent.result}</span>
          </button>
        ))}
      </div>

      <div className="orchestration-human-convergence">
        <span>Output package</span>
        <strong>Independent review → Human gate</strong>
      </div>

      {selectedId && (
        <OrchestrationDetailCard
          selectedId={selectedId}
          selectedAgent={selectedAgent}
          onClose={() => onSelect(null)}
        />
      )}
    </div>
  );
}

function OrchestrationDetailCard({
  selectedId,
  selectedAgent,
  onClose,
}) {
  const firstMate = selectedId === "first-mate";

  return (
    <aside className="orchestration-detail-card">
      <header>
        <div>
          <div className="concept-preview-label">
            {firstMate ? "First Mate" : selectedAgent?.role}
          </div>
          <h2>
            {firstMate ? "Episode orchestration" : selectedAgent?.task}
          </h2>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close orchestration detail"
        >
          ×
        </button>
      </header>

      {firstMate ? (
        <>
          <div className="orchestration-detail-section">
            <span>Assigned work</span>
            <p>✓ Research supporting evidence</p>
            <p>◌ Draft recommended follow-up</p>
            <p>✓ Compare candidate actions</p>
            <p>○ Independent review</p>
          </div>
          <div className="orchestration-detail-section">
            <span>Human required</span>
            <p>Review returned package</p>
          </div>
          <div className="orchestration-detail-section">
            <span>Authority</span>
            <p>May decompose and coordinate approved work.</p>
            <p>Cannot change scope, advance stages, or make final disposition.</p>
          </div>
        </>
      ) : (
        <>
          <div className="orchestration-detail-section">
            <span>Status</span>
            <StatusIndicator status={selectedAgent?.status ?? "Waiting"} label={selectedAgent?.status ?? "Waiting"} size="md" className="orchestration-detail-status" />
          </div>
          <div className="orchestration-detail-section">
            <span>Input</span>
            <p>Approved action + evidence</p>
          </div>
          <div className="orchestration-detail-section">
            <span>Expected output</span>
            <p>{selectedAgent?.id === "builder" ? "follow-up-draft.md" : selectedAgent?.result}</p>
          </div>
          <div className="orchestration-detail-section">
            <span>Authority</span>
            <p>May draft or analyze.</p>
            <p>Cannot send, approve, or change scope.</p>
          </div>
        </>
      )}
    </aside>
  );
}

const ORCHESTRATION_ELIGIBLE_NODES = new Set([
  "inquiry",
  "evidence",
  "gaps",
  "recommendation",
  "evaluation",
]);

function isOrchestrationEligibleNode(node) {
  const workflowKind = node?.data?.workflowKind ?? node?.kind;
  return Boolean(
    node &&
    node.data?.proposed !== true &&
    (ORCHESTRATION_ELIGIBLE_NODES.has(node.id) ||
      ["inquiry", "evidence", "gap", "recommendation", "evaluation"].includes(workflowKind))
  );
}

function getOrchestrationSummary(nodeId, plan, executionState) {
  return getOrchestrationPlanSummary(
    plan ??
      createOrchestrationPlan({
        episode: { id: "concept-preview" },
        node: { id: nodeId },
      }),
    executionState
  );
}

function orchestrationSummaryStatus(summary, runStatus = null) {
  if (runStatus) return orchestrationStatusClass(runStatus);
  if (summary.humanRequired > 0) {
    return "human-required";
  }

  if (summary.working > 0) {
    return "working";
  }

  if (summary.complete === summary.total) {
    return "complete";
  }

  return "waiting";
}

function isValidOrchestrationPlan(plan) {
  return Boolean(
    plan &&
    typeof plan.objective === "string" &&
    Array.isArray(plan.tasks) &&
    Array.isArray(plan.assignments) &&
    Array.isArray(plan.humanGates)
  );
}

function buildOrchestrationPreviewNodes(
  parentNodeId,
  parentPosition,
  plan,
  executionState = {},
  runStatus = null,
  savedPositions = {},
) {
  const baseX = parentPosition.x;
  const baseY = parentPosition.y;
  const positionFor = (id, fallback) => savedPositions[id] ?? fallback;
  const preview = [
    {
      id: `orchestration-${parentNodeId}-first-mate`,
      type: "orchestration",
      draggable: true,
      position: positionFor(`orchestration-${parentNodeId}-first-mate`, { x: baseX + 330, y: baseY + 30 }),
      data: {
        label: "First Mate",
        title: `Coordinating ${plan.assignments?.length ?? 0} agents`,
        status: orchestrationSummaryStatus(
          getOrchestrationPlanSummary(plan, executionState),
          runStatus,
        ),
        statusLabel: runStatus ? `Run ${runStatus}` : "Ready for read-only run",
        result: runStatus ? `Local Codex · ${runStatus}` : "Local Codex · read-only",
        orchestrationPreview: true,
        detailId: "first-mate",
      },
    },
    ...(plan.assignments ?? []).map((assignment, index) => {
      const task = plan.tasks[index];
      return {
      id: `orchestration-${parentNodeId}-${assignment.id}`,
      type: "orchestration",
      draggable: true,
      position: positionFor(`orchestration-${parentNodeId}-${assignment.id}`, {
        x: baseX + 650,
        y: baseY - 70 + index * 105,
      }),
      data: {
        label: assignment.role,
        title: task.title,
        status: orchestrationStatusClass(runStatus && !["Complete"].includes(executionState[assignment.id]) ? runStatus : executionState[assignment.id] ?? "Queued"),
        statusLabel: runStatus && !["Complete"].includes(executionState[assignment.id]) ? runStatus : executionState[assignment.id] ?? "Queued",
        result: `Output: ${task.output}`,
        orchestrationPreview: true,
        detailId: assignment.id,
      },
      };
    }),
    {
      id: `orchestration-${parentNodeId}-output`,
      type: "orchestrationOutput",
      draggable: true,
      position: positionFor(`orchestration-${parentNodeId}-output`, { x: baseX + 960, y: baseY + 245 }),
      data: { orchestrationPreview: true },
    },
  ];

  return preview;
}

function buildOrchestrationPreviewEdges(parentNodeId, plan) {
  const firstMateId = `orchestration-${parentNodeId}-first-mate`;
  const assignments = plan.assignments ?? [];
  const planNodeIds = assignments.map(
    (agent) => `orchestration-${parentNodeId}-${agent.id}`
  );
  const reviewer = assignments.find((agent) =>
    agent.role.toLowerCase().includes("review")
  ) ?? assignments[assignments.length - 1];
  const reviewerId = `orchestration-${parentNodeId}-${reviewer.id}`;
  const outputId = `orchestration-${parentNodeId}-output`;

  const edges = [
    [parentNodeId, firstMateId, "branch-source", "flow-target"],
    ...planNodeIds.map((nodeId) => [
      firstMateId,
      nodeId,
      "flow-source",
      "flow-target",
    ]),
    [reviewerId, outputId, "flow-source", "flow-target"],
  ];

  return edges.map(([source, target, sourceHandle, targetHandle], index) => ({
    id: `orchestration-edge-${parentNodeId}-${index}`,
    source,
    target,
    sourceHandle,
    targetHandle,
    type: "smoothstep",
    className: "orchestration-preview-edge",
  }));
}

function OrchestrationBadge({
  summary,
  onClick,
}) {
  const status = orchestrationSummaryStatus(summary);

  return (
    <button
      type="button"
      className={`node-orchestration-badge ${status} nodrag`}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      aria-label={`${summary.total} agents in orchestration preview`}
      title="Open node orchestration preview"
    >
      <StatusIndicator status={status} label={`${summary.total} agents`} size="sm" />
    </button>
  );
}

function OrchestrationPreviewNode({ data }) {
  return (
    <div className={`flow-node orchestration-flow-node ${data.status}`}>
      <Handle type="target" position={Position.Top} id="flow-target" className="flow-handle" />
      <div className="node-label">{data.label}</div>
      <div className="node-title">{data.title}</div>
      <StatusIndicator status={data.status} label={data.statusLabel} size="sm" className="orchestration-flow-status" />
      <div className="node-meta">{data.result}</div>
      <Handle type="source" position={Position.Bottom} id="flow-source" className="flow-handle" />
    </div>
  );
}

function OrchestrationOutputNode({ data: _data }) {
  return (
    <div className="flow-node orchestration-output-node">
      <Handle type="target" position={Position.Top} id="flow-target" className="flow-handle" />
      <div className="node-label">Output</div>
      <div className="node-title">Returned package</div>
      <div className="node-meta">Human gate review</div>
    </div>
  );
}

function EpisodeIntakeNode({ data }) {
  return (
    <div className="flow-node episode-intake-node">
      <Handle type="target" position={Position.Top} id="flow-target" className="flow-handle" />
      <div className="node-label">Episode intake</div>
      <div className="node-title">Agent structuring</div>
      <div className="node-body">Awaiting agent analysis</div>
      <button type="button" onClick={data.onOpen}>View intake request</button>
      <Handle type="source" position={Position.Bottom} id="flow-source" className="flow-handle" />
    </div>
  );
}

function EpisodeIntakePanel({
  open,
  episode,
  intake,
  onClose,
  onRequestRevision,
  onAccept,
  codexRunning = false,
  codexStatus,
  codexRun,
  onCancelAnalysis,
  onRetryAnalysis,
}) {
  const [revisionInstruction, setRevisionInstruction] = useState("");

  if (!open || !episode || !intake || intake.status === "idle") {
    return null;
  }

  const request = intake.request ?? createEpisodeIntakeRequest({ episode });
  const proposal = intake.proposal;
  const activity = (codexRun?.events ?? []).filter((event) => ["activity", "milestone", "phase"].includes(event.type)).slice(-8);

  return (
    <aside className="episode-intake-panel" aria-label="Episode intake">
      <header>
        <div>
          <div className="concept-preview-label">Agent-assisted setup</div>
          <h2>
            {intake.status === "pending"
              ? "Agent structuring"
              : "Proposed episode structure"}
          </h2>
          {intake.status === "pending" && <div className="intake-live-status"><StatusIndicator status={codexRunning ? "working" : codexRun?.status === "error" ? "error" : "waiting"} label={codexRunning ? "Working" : codexRun?.status === "error" ? "Analysis failed" : "Awaiting analysis"} size="md" /></div>}
          {intake.status === "proposed" && <div className="intake-live-status"><StatusIndicator status="complete" label="Complete · Review required" size="md" /></div>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close intake">×</button>
      </header>

      {intake.status === "pending" && (
        <div className="episode-intake-panel-body">
          <strong>{codexRunning ? "Codex analysis in progress" : "Awaiting agent analysis"}</strong>
          <p>{codexRunning ? "Local Codex is analyzing this Episode in read-only mode." : "The Episode is pending analysis. Nothing is accepted yet."}</p>
          {!codexRunning && codexStatus?.state === "authentication-required" && <p>Codex sign-in required. Run Codex login in your terminal, then retry analysis.</p>}
          {!codexRunning && codexStatus?.state === "cli-unavailable" && <p>Codex CLI not found. Install Codex, then retry analysis.</p>}
          {!codexRunning && codexStatus?.state === "runtime-unavailable" && <p>The local Codex runtime could not determine CLI status. Retry after checking the runtime terminal.</p>}
          <div className="intake-request-list">
            {request.requestedAnalysis.map((item) => <span key={item}>• {item}</span>)}
          </div>
          {codexRun?.todos?.length > 0 && <div className="intake-progress"><span>Progress</span>{codexRun.todos.map((item) => <div key={item.label}><StatusIndicator status={item.status} label={item.label} size="sm" /></div>)}</div>}
          {activity.length > 0 && <div className="intake-activity"><span>Activity</span>{activity.map((event, index) => <div key={`${event.occurredAt ?? "event"}-${index}`}>{event.label}{event.detail ? ` · ${event.detail}` : ""}</div>)}</div>}
          {codexRun?.status === "error" && <div className="intake-error">Codex analysis failed{codexRun.error ? `: ${codexRun.error}` : "."}</div>}
          {codexRun?.status === "cancelled" && <div className="intake-error">Analysis cancelled. No proposal changes were applied.</div>}
        </div>
      )}

      {intake.status === "proposed" && proposal && (
        <div className="episode-intake-panel-body">
          <div className="proposal-status">Agent proposed · Not accepted</div>
          <div className="intake-section"><span>Objective</span><strong>{proposal.objective}</strong></div>
          <div className="intake-summary-grid">
            <div><span>Work nodes</span><strong>{proposal.workNodes?.length ?? 0} proposed</strong></div>
            <div><span>Human checkpoints</span><strong>{proposal.humanGates?.length ?? 0} proposed</strong></div>
            <div><span>Assumptions</span><strong>{proposal.assumptions?.length ?? 0}</strong></div>
            <div><span>Unresolved</span><strong>{proposal.unresolved?.length ?? 0}</strong></div>
          </div>
          <details className="intake-details">
            <summary>Inspect proposed details</summary>
            <div className="intake-section"><span>Context summary</span><p>{proposal.context?.summary || "No context summary provided."}</p></div>
            <div className="intake-section"><span>Human checkpoints</span>{proposal.humanGates?.map((gate) => <p key={gate.id}>{gate.title}</p>)}</div>
          </details>
          <label className="intake-revision-field">
            <span>Revision instruction <em>Optional</em></span>
            <textarea rows="2" value={revisionInstruction} onChange={(event) => setRevisionInstruction(event.target.value)} placeholder="e.g. Split evidence verification from context recovery." />
          </label>
        </div>
      )}

      <footer>
        {intake.status === "pending" ? (
          codexRunning ? <button type="button" onClick={onCancelAnalysis}>Cancel analysis</button> : ["error", "cancelled"].includes(codexRun?.status) ? <button type="button" onClick={onRetryAnalysis}>Retry analysis</button> : <button type="button" onClick={onClose}>Close</button>
        ) : (
          <>
            <button type="button" onClick={() => { onRequestRevision(revisionInstruction.trim()); setRevisionInstruction(""); }}>Request revision</button>
            <button type="button" onClick={onAccept} className="primary">Accept structure</button>
          </>
        )}
      </footer>
    </aside>
  );
}

function AutopilotRunPanel({ run, onStop, onRetry, follow, onFollow, onPromote, onRevise, onPause, onReject, onInspectOutput, onToggleCanvasArtifacts, canvasArtifactsVisible, outputCount, onHide }) {
  const [instruction, setInstruction] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  if (!run) return null;
  const taskEntries = Object.entries(run.taskStates ?? {});
  const active = taskEntries.find(([, status]) => status === "working");
  const completedTurns = (run.outputs ?? []).filter((output) => output.taskId !== "final-review").length + (run.draftPlan ? 1 : 0) + (run.finalPackage ? 1 : 0);
  const outputs = (run.outputs ?? []).filter((output) => output.taskId !== "final-review");
  const selectedOutput = outputs.find((output) => output.taskId === selectedTaskId);
  const activeTask = taskEntries.find(([, status]) => status === "working")?.[0] ?? null;
  const activeRole = run.events?.slice().reverse().find((event) => event.taskId === activeTask && event.role)?.role ?? activeTask?.replace(/-/g, " ") ?? "Waiting for the next task";
  const liveActivity = (run.events ?? []).filter((event) => event.type === "activity").slice(-5).reverse();
  return <aside className="autopilot-run-panel" aria-label="Autopilot run inspector">
    <header><div><div className="concept-preview-label">Run inspector</div><h2>{run.status === "complete" ? "Human review required" : run.status === "working" ? "Live read-only run" : `Run ${run.status}`}</h2></div><div className="autopilot-panel-header-actions"><StatusIndicator status={run.status === "complete" ? "complete" : run.status === "working" ? "working" : run.status === "error" ? "error" : "waiting"} label={run.status} size="sm" /><button type="button" onClick={onHide} aria-label="Hide run inspector">×</button></div></header>
    <div className="autopilot-progress"><span>Planning</span><span>Specialists</span><span>Synthesis / review</span><span>Human review</span></div>
    <p className="autopilot-cost-guard">Maximum {MAX_AUTOPILOT_TURNS} Codex turns · read-only local runtime</p>
    <div className="autopilot-turn-count">Turns: {completedTurns} / {MAX_AUTOPILOT_TURNS}</div>
    {active && <p className="autopilot-active-agent">Active: {active[0]} · Reviewing source context</p>}
    <div className="autopilot-task-list">{taskEntries.map(([taskId, status]) => <div key={taskId}><StatusIndicator status={["complete", "completed"].includes(status) ? "complete" : status === "working" ? "working" : status === "failed" ? "error" : "waiting"} label={`${taskId} · ${status}`} size="sm" /></div>)}</div>
    <details className="run-inspector-context" open={run.status === "working"}>
      <summary><span>Agent context</span><strong>{run.status === "working" ? "Live" : "Run record"}</strong></summary>
      <div className="run-context-body">
        <p>This is the bounded context for this Workroom run—not a separate terminal session.</p>
        <dl>
          <div><dt>Current task</dt><dd>{activeRole}</dd></div>
          <div><dt>Episode goal</dt><dd>{run.context?.objective || "Episode analysis"}</dd></div>
          <div><dt>Material in scope</dt><dd>{run.context?.sourceCount ? `${run.context.sourceCount} selected source${run.context.sourceCount === 1 ? "" : "s"}${run.context.sourceNames?.length ? ` · ${run.context.sourceNames.join(", ")}` : ""}` : "Episode brief and retained workflow context"}</dd></div>
          <div><dt>Allowed work</dt><dd>Read-only analysis and structured outputs for human review.</dd></div>
          <div><dt>Not allowed</dt><dd>No network, browser, file edits, stage changes, or final decisions.</dd></div>
        </dl>
        <div className="run-context-activity">
          <span>Safe live activity</span>
          {liveActivity.length ? liveActivity.map((event, index) => <p key={`${event.occurredAt ?? "activity"}-${index}`}><strong>{event.label}</strong>{event.detail && <small>{event.detail}</small>}</p>) : <p className="run-context-empty">Updates will appear when Codex begins a task.</p>}
        </div>
        <small className="run-context-privacy">Private reasoning is not displayed. Review the retained findings and assumptions when a task completes.</small>
      </div>
    </details>
    <section className="run-inspector-outputs" aria-label="Run outputs">
      <div className="run-inspector-heading"><strong>Outputs</strong><span>{outputCount} attached to workflow</span></div>
      <p>Generated findings stay here so the decision map remains readable.</p>
      {outputs.length === 0 ? <div className="run-inspector-empty">Completed findings will appear here, linked to the workflow step they support.</div> : outputs.map((output) => <button type="button" className={`run-inspector-output ${selectedTaskId === output.taskId ? "selected" : ""}`} key={output.taskId} onClick={() => { setSelectedTaskId(output.taskId); onInspectOutput?.(output.taskId); }}><span>{output.role || output.taskId}</span><strong>{output.summary || "Open output"}</strong><em>{output.taskId.replace("specialist-", "Step · ")}</em></button>)}
      {selectedOutput && <div className="run-inspector-detail"><strong>{selectedOutput.role || selectedOutput.taskId}</strong><p><b>Findings:</b> {selectedOutput.findings?.join(" · ") || "No findings recorded."}</p>{selectedOutput.assumptions?.length > 0 && <p><b>Assumptions:</b> {selectedOutput.assumptions.join(" · ")}</p>}{selectedOutput.unresolvedQuestions?.length > 0 && <p><b>Unresolved:</b> {selectedOutput.unresolvedQuestions.join(" · ")}</p>}{selectedOutput.recommendedNextStep && <p><b>Recommended next step:</b> {selectedOutput.recommendedNextStep}</p>}</div>}
      {run.finalPackage && <details className="run-inspector-final" open><summary><span>Final synthesis</span><strong>{run.finalPackage.summary || "Human-review package"}</strong><em>Human review package</em></summary><div>{run.finalPackage.findings?.length > 0 && <p><b>Findings:</b> {run.finalPackage.findings.join(" · ")}</p>}{run.finalPackage.risks?.length > 0 && <p><b>Risks:</b> {run.finalPackage.risks.join(" · ")}</p>}{run.finalPackage.recommendedNextStep && <p><b>Recommended next step:</b> {run.finalPackage.recommendedNextStep}</p>}<button type="button" onClick={() => onInspectOutput?.("final-review")}>Open full package</button></div></details>}
      {outputCount > 0 && <button type="button" className="run-inspector-canvas-toggle" onClick={onToggleCanvasArtifacts}>{canvasArtifactsVisible ? "Hide run outputs on canvas" : "Show run outputs on canvas"}</button>}
    </section>
    {(run.events ?? []).slice(-4).map((event, index) => <div className="autopilot-event" key={`${event.occurredAt ?? "event"}-${index}`}>{event.label ?? event.message ?? event.type}</div>)}
    <label className="autopilot-follow"><input type="checkbox" checked={follow} onChange={(event) => onFollow(event.target.checked)} /> Follow active work</label>
    {run.status === "working" && <button type="button" onClick={onStop}>Stop run</button>}
    {["error", "cancelled"].includes(run.status) && <div className="autopilot-human-actions"><strong>{run.status === "error" ? "Run failed before human review" : "Run stopped before human review"}</strong><button type="button" onClick={onRetry}>Retry run</button></div>}
    {run.status === "complete" && run.finalPackage && <div className="autopilot-human-actions"><strong>Human review required</strong><button type="button" onClick={onPromote}>Stage for reconciliation</button><textarea rows="2" value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Optional revised-run instruction" /><button type="button" onClick={() => onRevise(instruction)}>Request revised run</button><button type="button" onClick={onPause}>Pause</button><button type="button" onClick={onReject}>Reject</button></div>}
    {run.error && <div className="autopilot-error">{run.error}</div>}
  </aside>;
}

function AgentNotificationTray({ notifications, onDismiss, onOpen }) {
  if (notifications.length === 0) return null;

  return (
    <aside className="agent-notification-tray" aria-label="Agent run notifications" aria-live="polite">
      {notifications.map((notification) => (
        <section className="agent-notification" key={notification.id}>
          <div>
            <span>Agent update</span>
            <strong>{notification.title}</strong>
            <p>{notification.summary}</p>
          </div>
          <div className="agent-notification-actions">
            <button type="button" onClick={() => onOpen(notification)}>Open run</button>
            <button type="button" onClick={() => onDismiss(notification.id)} aria-label="Dismiss agent notification">×</button>
          </div>
        </section>
      ))}
    </aside>
  );
}

function NotificationDrawer({ episode, open, onClose, onOpenRelated }) {
  if (!open || !episode) return null;

  const notifications = (episode.activity ?? []).filter((event) => (
    event.actor?.kind === "codex" ||
    event.actor?.kind === "system" ||
    event.type?.includes("run_") ||
    event.type?.includes("task_completed") ||
    event.type?.includes("agent_responded")
  )).slice().reverse();

  return (
    <aside id="episode-notifications-drawer" className="notification-drawer" aria-label="Episode notifications">
      <header className="notification-header">
        <div>
          <div className="drawer-eyebrow">Episode notifications</div>
          <h2>What changed</h2>
          <p>Agent progress, completed work, and items that may need your attention.</p>
        </div>
        <button type="button" className="drawer-close" onClick={onClose} aria-label="Close notifications">×</button>
      </header>

      <div className="notification-body">
        {notifications.length ? notifications.map((event) => (
          <article key={event.id} className={`notification-item ${event.type?.includes("failed") ? "attention" : ""}`}>
            <div className="notification-item-marker" aria-hidden="true">{event.type?.includes("failed") ? "!" : event.actor?.kind === "codex" ? "●" : "•"}</div>
            <div>
              <time>{new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
              <strong>{event.title}</strong>
              {event.summary && <p>{event.summary}</p>}
              {event.relatedNodeId && <button type="button" onClick={() => onOpenRelated(event.relatedNodeId)}>Open related work</button>}
            </div>
          </article>
        )) : <div className="notification-empty"><strong>No agent updates yet</strong><p>Completed runs and agent responses will be collected here.</p></div>}
      </div>
    </aside>
  );
}

function EpisodeProgressGuide({ episode, viewStage, liveOrchestrationRun, onSelectStage, onOpenIntake, onOpenActivity, onOpenOrchestration, onOpenSources }) {
  const autopilot = episode.autopilotRun;
  const orchestrationRuns = Object.entries(episode.runtime?.codex?.orchestration ?? {});
  const activeOrchestration = liveOrchestrationRun?.episodeId === episode.id && ["queued", "working"].includes(liveOrchestrationRun.status)
    ? [liveOrchestrationRun.nodeId, liveOrchestrationRun]
    : null;
  const pendingThreads = (episode.additions ?? []).filter((item) => item.kind === "thread" && item.status === "pending").length;
  const generatedOutputs = (episode.additions ?? []).filter(isGeneratedRunArtifact).length;
  const sourceCount = episode.sources?.length ?? 0;
  const completedAutopilotTasks = Object.values(autopilot?.taskStates ?? {}).filter((status) => ["complete", "completed"].includes(status)).length;
  const autopilotTaskCount = Object.keys(autopilot?.taskStates ?? {}).length;
  const setupNeedsReview = ["pending", "proposed"].includes(episode.intake?.status);
  const finalReviewReady = autopilot?.status === "complete" && autopilot.finalPackage;

  let nextTitle = "Review this stage and continue when it is justified.";
  let nextDetail = "No additional prompt is required unless you need to clarify or challenge a specific finding.";
  let nextAction = null;

  if (setupNeedsReview) {
    nextTitle = "Review the proposed episode structure.";
    nextDetail = "Autopilot produced a draft. Accept it, ask for a revision, or leave it unaccepted—this is a human decision.";
    nextAction = { label: "Review setup", onClick: onOpenIntake };
  } else if (activeOrchestration) {
    nextTitle = "First Mate is processing this workflow step.";
    nextDetail = "No prompt is required while the read-only run is active. Its outputs will appear when each specialist finishes.";
    nextAction = { label: "Open First Mate", onClick: () => onOpenOrchestration(activeOrchestration[0]) };
  } else if (finalReviewReady) {
    nextTitle = "Review the final Autopilot package.";
    nextDetail = "The run is complete. You can stage its Return Packet for reconciliation, request a revised run, or keep the package as inspectable draft work.";
    nextAction = { label: "Open activity", onClick: onOpenActivity };
  } else if (viewStage === 2) {
    nextTitle = "Record the human disposition.";
    nextDetail = "Agents cannot complete this step. Review the retained evidence and make the final decision yourself.";
  }

  return (
    <section className="episode-progress-guide" aria-label="Episode progress guide">
      <header>
        <div><span>Episode cockpit</span><h2>Where this episode stands</h2></div>
        <div className="episode-progress-summary">
          {sourceCount > 0 && <button type="button" className="episode-progress-source-count" onClick={onOpenSources}>{sourceCount} source {sourceCount === 1 ? "file" : "files"}</button>}
          <div className="episode-progress-output-count">{generatedOutputs} retained output{generatedOutputs === 1 ? "" : "s"}</div>
        </div>
      </header>
      <div className="episode-progress-stages">
        {EPISODE_STAGES.map((stage, index) => <button type="button" key={stage.name} className={index === viewStage ? "active" : index < episode.currentStage ? "complete" : ""} disabled={index > episode.currentStage} onClick={() => onSelectStage(index)}><b>{index < episode.currentStage ? "✓" : index + 1}</b><span>{stage.name}</span></button>)}
      </div>
      <div className="episode-progress-grid">
        <div><span>Autopilot</span><strong>{autopilot ? autopilot.status === "working" ? "Running" : autopilot.status === "complete" ? "Package ready" : `Run ${autopilot.status}` : "Not started"}</strong><small>{autopilot ? `${completedAutopilotTasks} of ${autopilotTaskCount} tasks completed` : "Optional agent-assisted analysis"}</small></div>
        <div><span>First Mate</span><strong>{activeOrchestration ? "Working" : orchestrationRuns.length > 0 ? "Outputs retained" : "Not started"}</strong><small>{activeOrchestration ? "Read-only specialist work in progress" : "Optional targeted orchestration"}</small></div>
        <div><span>Prompts</span><strong>{pendingThreads > 0 ? "Reply pending" : "Nothing required"}</strong><small>{pendingThreads > 0 ? `${pendingThreads} agent conversation${pendingThreads === 1 ? "" : "s"} awaiting a reply` : "Ask only when a finding needs clarification"}</small></div>
      </div>
      <div className="episode-progress-next"><div><span>Next for you</span><strong>{nextTitle}</strong><p>{nextDetail}</p></div>{nextAction && <button type="button" onClick={nextAction.onClick}>{nextAction.label}</button>}</div>
    </section>
  );
}

function GovernancePanel({ episode, project, onAcceptReadback, onRequestReadbackRevision, onAuthorize, onRecordState, onAcceptReturnItem, onCommitReturn, onRejectReturn }) {
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

function OrchestrationDetailOverlay({
  nodeTitle,
  nodeType,
  detailId,
  plan,
  executionState = {},
  onClose,
}) {
  const assignments = plan?.assignments ?? [];
  const tasks = plan?.tasks ?? [];
  const assignment = assignments.find(
    (item) => item.id === detailId
  );
  const task = tasks.find(
    (item) => item.id === assignment?.taskId
  );
  const firstMate = detailId === "first-mate";

  return (
    <aside className="node-orchestration-detail">
      <header>
        <div>
          <div className="concept-preview-label">Concept preview</div>
          <h2>{firstMate ? "First Mate" : assignment?.role}</h2>
          <span>{nodeType} · {nodeTitle}</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close orchestration detail">×</button>
      </header>

      {firstMate ? (
        <>
          <div className="orchestration-detail-section">
            <span>Assigned work</span>
            {assignments.map((item) => {
              const assignedTask = tasks.find(
                (candidate) => candidate.id === item.taskId
              );
              return (
                <p key={item.id}>○ {item.role}: {assignedTask?.title}</p>
              );
            })}
          </div>
          <div className="orchestration-detail-section">
            <span>Human required</span>
            <p>Review returned package</p>
          </div>
          <div className="orchestration-detail-section">
            <span>Authority</span>
            <p>May coordinate approved work. Cannot change scope, advance stages, or make final disposition.</p>
          </div>
        </>
      ) : (
        <>
          <div className="orchestration-detail-section">
            <span>Assigned task</span>
            <p>{task?.title}</p>
          </div>
          <div className="orchestration-detail-section">
            <span>Status</span>
            <StatusIndicator status={executionState[assignment?.id] ?? "Queued"} label={executionState[assignment?.id] ?? "Queued"} size="md" className="orchestration-detail-status" />
          </div>
          <div className="orchestration-detail-section">
            <span>Input · Expected output</span>
            <p>Approved action + evidence · {task?.output}</p>
          </div>
          <div className="orchestration-detail-section">
            <span>Authority</span>
            <p>May draft or analyze. Cannot send, approve, or change scope.</p>
          </div>
        </>
      )}
    </aside>
  );
}

class OrchestrationErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Orchestration preview error", error, errorInfo);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <aside className="node-orchestration-detail orchestration-error" role="alert">
        <header>
          <div>
            <div className="concept-preview-label">Concept preview</div>
            <h2>Orchestration preview error</h2>
          </div>
          <button type="button" onClick={this.props.onClose} aria-label="Close preview">×</button>
        </header>
        <p>Something went wrong while preparing the preview.</p>
        <button type="button" className="node-orchestration-error-close" onClick={this.props.onClose}>
          Close preview
        </button>
      </aside>
    );
  }
}

function NodeOrchestrationWindow({
  open,
  minimized,
  node,
  nodeTitle,
  nodeType,
  nodeBody,
  summary: _summary,
  executionState = {},
  orchestrationRun,
  phase,
  clusterVisible,
  plan,
  onMinimize,
  onClose,
  onExpand,
  onFullscreen,
  onPreviewPlan,
  onBack,
  onApprove,
  onReset,
  onRun,
  onCancelRun,
  onInspectArtifacts,
  flowWrapperRef,
  reactFlowInstance,
  viewportRevision,
}) {
  const windowRef = useRef(null);
  const basePositionRef = useRef({ left: 0, top: 0 });
  const [position, setPosition] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [runConfirmed, setRunConfirmed] = useState(false);
  const dragRef = useRef(null);

  useLayoutEffect(() => {
    if (!open || !node || !reactFlowInstance || !flowWrapperRef.current) {
      return;
    }

    const wrapperRect = flowWrapperRef.current.getBoundingClientRect();
    const nodeWidth = node.measured?.width ?? node.width ?? 250;
    const nodeScreen = reactFlowInstance.flowToScreenPosition(node.position);
    const nodeRight = reactFlowInstance.flowToScreenPosition({
      x: node.position.x + nodeWidth,
      y: node.position.y,
    });
    const cardWidth = windowRef.current?.offsetWidth ?? 300;
    const rightSpace = wrapperRect.right - nodeRight.x;
    const side = rightSpace >= cardWidth + 18 ? "right" : "left";
    const preferredLeft = side === "right"
      ? nodeRight.x - wrapperRect.left + 18
      : nodeScreen.x - wrapperRect.left - cardWidth - 18;
    const baseLeft = Math.max(12, Math.min(preferredLeft, wrapperRect.width - cardWidth - 12));
    const cardHeight = windowRef.current?.offsetHeight ?? 270;
    const baseTop = Math.max(12, Math.min(nodeScreen.y - wrapperRect.top, wrapperRect.height - cardHeight - 12));

    basePositionRef.current = {
      left: baseLeft,
      top: baseTop,
    };

    setPosition({
      left: Math.max(12, Math.min(baseLeft + dragOffset.x, wrapperRect.width - cardWidth - 12)),
      top: Math.max(12, Math.min(baseTop + dragOffset.y, wrapperRect.height - cardHeight - 12)),
      side,
    });
  }, [
    flowWrapperRef,
    dragOffset,
    node,
    open,
    reactFlowInstance,
    viewportRevision,
  ]);

  useEffect(() => {
    function handlePointerMove(event) {
      if (!dragRef.current || !flowWrapperRef.current || !windowRef.current) {
        return;
      }

      const wrapperRect = flowWrapperRef.current.getBoundingClientRect();
      const card = windowRef.current.getBoundingClientRect();
      const base = basePositionRef.current;
      const nextLeft = base.left + dragRef.current.offset.x + event.clientX - dragRef.current.x;
      const nextTop = base.top + dragRef.current.offset.y + event.clientY - dragRef.current.y;
      const left = Math.max(12, Math.min(nextLeft, wrapperRect.width - card.width - 12));
      const top = Math.max(12, Math.min(nextTop, wrapperRect.height - card.height - 12));
      const nextOffset = {
        x: left - base.left,
        y: top - base.top,
      };

      setDragOffset(nextOffset);
      setPosition((current) => ({
        ...current,
        left,
        top,
      }));
    }

    function handlePointerUp() {
      dragRef.current = null;
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [flowWrapperRef]);

  if (!open || minimized || !node || !position) {
    return null;
  }

  const validPlan = isValidOrchestrationPlan(plan)
    ? plan
    : null;
  const liveExecutionState = orchestrationRun?.taskStates ?? executionState;

  return (
    <aside
      ref={windowRef}
      className={`node-orchestration-window ${position.side}`}
      style={{ left: position.left, top: position.top }}
      aria-label={`Orchestration preview for ${nodeTitle}`}
    >
      <header
        className="node-orchestration-window-header"
        onPointerDown={(event) => {
          if (event.target.closest("button")) {
            return;
          }
          dragRef.current = {
            x: event.clientX,
            y: event.clientY,
            offset: dragOffset,
          };
        }}
      >
        <div>
          <div className="concept-preview-label">Concept preview</div>
          <h2>
            {phase === "request"
              ? "Orchestration request"
              : phase === "proposed"
              ? "Proposed orchestration"
              : "Node orchestration"}
          </h2>
          <span>{nodeType} · {nodeTitle}</span>
        </div>
        <div className="node-orchestration-controls">
          {phase === "preview-approved" && (
            <>
              <button type="button" onClick={onExpand} aria-label={clusterVisible ? "Hide task cluster" : "Show task cluster"}>{clusterVisible ? "—" : "↗"}</button>
              <button type="button" onClick={onFullscreen} aria-label="Open full-screen orchestration">⛶</button>
            </>
          )}
          <button type="button" onClick={onMinimize} aria-label="Minimize orchestration">—</button>
          <button type="button" onClick={onClose} aria-label="Close orchestration">×</button>
        </div>
      </header>

      {phase === "request" && (
        <>
          <div className="node-orchestration-window-body request-body">
            <div className="request-field">
              <span>Node</span>
              <strong>{nodeTitle}</strong>
            </div>
            <div className="request-field">
              <span>Goal</span>
              <strong>{nodeTitle}</strong>
              {nodeBody && <p>{nodeBody}</p>}
            </div>
            <div className="request-field">
              <span>Context</span>
              <p>Episode + selected node</p>
            </div>
            <div className="request-authority">
              <span>Authority</span>
              <strong>Propose only · No execution</strong>
            </div>
          </div>
          <div className="node-orchestration-window-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="button" className="primary" onClick={onPreviewPlan}>Preview First Mate</button>
          </div>
        </>
      )}

      {phase === "proposed" && (
        <>
          <div className="node-orchestration-window-body proposed-body">
            {!validPlan ? (
              <>
                <strong>Unable to preview orchestration</strong>
                <span>The local plan is not available yet.</span>
              </>
            ) : (
              <>
                <strong>First Mate · Proposed orchestration</strong>
                <span>Preview only · requires human approval before any local run.</span>
                <div className="request-field">
                  <span>Objective</span>
                  <strong>{validPlan.objective}</strong>
                </div>
                <div className="node-orchestration-plan-list">
                  {validPlan.assignments.map((assignment, index) => {
                    const task = validPlan.tasks[index];
                    if (!task) {
                      return null;
                    }

                    return (
                      <div key={assignment.id} className="node-orchestration-plan-item">
                        <strong>{index + 1}. {assignment.role}</strong>
                        <span>{task.title}</span>
                        {task.dependsOn.length > 0 && (
                          <span>
                            Depends on: {task.dependsOn.map((dependencyId) =>
                              validPlan.assignments.find((item) => item.id === dependencyId)?.role
                            ).filter(Boolean).join(" + ")}
                          </span>
                        )}
                        <span>Output: {task.output}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="request-authority">
                  <span>Human gate</span>
                  <strong>{validPlan.humanGates[0]}</strong>
                  <span>Authority</span>
                  <strong>Planning only · No execution</strong>
                </div>
              </>
            )}
          </div>
          <div className="node-orchestration-window-actions">
            <button type="button" onClick={onBack}>Back</button>
            <button type="button" className="primary" onClick={onApprove} disabled={!validPlan}>Approve preview</button>
          </div>
        </>
      )}

      {phase === "preview-approved" && (
        <>
          <div className="node-orchestration-window-body">
            {!validPlan ? (
              <>
                <strong>Unable to show orchestration</strong>
                <span>The approved preview data is not available.</span>
              </>
            ) : (
              <>
                <strong>First Mate · Local Codex</strong>
                <span>Read-only orchestration · Preview approved</span>
                <div className="node-orchestration-status-list">
                  {selectOrchestrationTasks(validPlan).map((task) => {
                    const assignment = validPlan.assignments.find((item) => item.taskId === task.id);
                    return (
                    <StatusIndicator key={assignment.id} status={liveExecutionState[assignment.id] ?? "Queued"} label={`${assignment.role} · ${liveExecutionState[assignment.id] ?? "Queued"}`} size="sm" className="node-orchestration-status-list-item" />
                    );
                  })}
                </div>
                <div className="orchestration-run-guard">
                  <strong>Maximum 3 specialist turns</strong>
                  <span>Local Codex runtime only · read-only · no stage advancement or decisions.</span>
                  <label><input type="checkbox" checked={runConfirmed} onChange={(event) => setRunConfirmed(event.target.checked)} disabled={orchestrationRun?.status === "working" || orchestrationRun?.status === "queued"} /> I understand and approve this analysis run.</label>
                </div>
                {orchestrationRun?.status && <div className="orchestration-run-status"><StatusIndicator status={orchestrationRun.status} label={`Run ${orchestrationRun.status}`} size="sm" />{orchestrationRun.runId && <span>{orchestrationRun.runId}</span>}</div>}
                {orchestrationRun?.error && <div className="intake-error">{orchestrationRun.error}</div>}
                {(orchestrationRun?.taskOutputs ?? []).map((output) => <div className="orchestration-task-output" key={output.taskId}><strong>{output.role}</strong><span>{output.summary}</span><button type="button" onClick={() => onInspectArtifacts?.(output.taskId)}>Inspect artifacts</button></div>)}
              </>
            )}
          </div>
          <div className="node-orchestration-window-actions approved-actions">
            <button type="button" onClick={onExpand} disabled={!validPlan}>{clusterVisible ? "Hide task cluster" : "Show task cluster"}</button>
            {orchestrationRun?.status === "working" || orchestrationRun?.status === "queued" ? <button type="button" onClick={onCancelRun}>Cancel run</button> : <button type="button" className="primary" onClick={onRun} disabled={!validPlan || !runConfirmed}>Run orchestration</button>}
            <button type="button" onClick={onReset}>Reset preview</button>
          </div>
        </>
      )}
    </aside>
  );
}

/* -------------------------------------------------------------------------- */
/* RIGHT DRAWER                                                               */
/* -------------------------------------------------------------------------- */

function ConversationMessages({
  thread,
  compact = false,
}) {
  const messages = thread?.messages ?? [];
  const visibleMessages = compact
    ? messages.slice(-4)
    : messages;
  const pending = thread?.status === "pending";

  return (
    <div className="conversation-messages">
      {!thread && (
        <div className="drawer-empty anchored-empty">
          <div className="drawer-empty-icon">◌</div>
          <strong>No conversation yet</strong>
          <p>
            Ask the agent about this node. The conversation will stay
            anchored here.
          </p>
        </div>
      )}

      {visibleMessages.map((message) => (
        <div
          key={message.id}
          className={`drawer-message ${message.role}`}
        >
          <div className="drawer-message-inner">
            <div className="drawer-message-role">
              {message.role === "human" ? "You" : "Agent"}
            </div>
            <div className="drawer-message-bubble">
              {message.content}
            </div>
          </div>
        </div>
      ))}

      {compact && messages.length > visibleMessages.length && (
        <div className="anchored-history-note">
          Showing the latest part of this conversation
        </div>
      )}

      {pending && (
        <div className="drawer-agent-pending">
          <span />
          Waiting for agent response…
        </div>
      )}
    </div>
  );
}

function ConversationComposer({
  thread,
  onSend,
}) {
  const [draft, setDraft] = useState("");
  const pending = thread?.status === "pending";

  function submit(event) {
    event.preventDefault();

    const clean = draft.trim();

    if (!clean || pending) {
      return;
    }

    onSend(clean);
    setDraft("");
  }

  return (
    <form className="drawer-composer" onSubmit={submit}>
      <div className="drawer-composer-box">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={pending}
          placeholder={
            pending
              ? "Waiting for the agent to respond..."
              : thread
              ? "Continue this node conversation..."
              : "Ask the agent about this node..."
          }
        />

        <div className="drawer-composer-actions">
          <button
            type="submit"
            className="drawer-send-button"
            disabled={pending || !draft.trim()}
          >
            Ask agent
          </button>
        </div>
      </div>
    </form>
  );
}

function AnchoredConversationCard({
  episode,
  stageIndex,
  anchorNodeId,
  anchorTitle,
  anchorType,
  thread,
  nodes,
  flowWrapperRef,
  reactFlowInstance,
  viewportRevision,
  onSend,
  onExpand,
  onFullscreen,
  onMinimize,
  orchestrationEligible,
  orchestrationApproved,
  orchestrationSummary,
  onOrchestrate,
  contextSummary,
  onViewContext,
}) {
  const cardRef = useRef(null);
  const [placement, setPlacement] = useState("right");
  const [position, setPosition] = useState(null);
  const anchorNode = nodes.find((node) => node.id === anchorNodeId);

  useLayoutEffect(() => {
    if (!anchorNode || !reactFlowInstance || !flowWrapperRef.current) {
      return;
    }

    const wrapper = flowWrapperRef.current;
    const card = cardRef.current;
    const wrapperRect = wrapper.getBoundingClientRect();
    const nodeWidth = anchorNode.measured?.width ?? anchorNode.width ?? 250;
    const nodeHeight = anchorNode.measured?.height ?? anchorNode.height ?? 150;
    const cardWidth = card?.offsetWidth ?? 320;
    const cardHeight = card?.offsetHeight ?? 300;
    const nodeScreen = reactFlowInstance.flowToScreenPosition({
      x: anchorNode.position.x,
      y: anchorNode.position.y,
    });
    const nodeRightScreen = reactFlowInstance.flowToScreenPosition({
      x: anchorNode.position.x + nodeWidth,
      y: anchorNode.position.y,
    });
    const nodeBottomScreen = reactFlowInstance.flowToScreenPosition({
      x: anchorNode.position.x,
      y: anchorNode.position.y + nodeHeight,
    });
    const nodeLeft = nodeScreen.x - wrapperRect.left;
    const nodeTop = nodeScreen.y - wrapperRect.top;
    const nodeRight = nodeRightScreen.x - wrapperRect.left;
    const nodeBottom = nodeBottomScreen.y - wrapperRect.top;
    const gap = 20;
    const rightSpace = wrapperRect.width - nodeRight;
    const nextPlacement =
      rightSpace >= cardWidth + gap ? "right" : "left";
    const preferredLeft =
      nextPlacement === "right"
        ? nodeRight + gap
        : nodeLeft - cardWidth - gap;
    const left = Math.max(
      12,
      Math.min(preferredLeft, wrapperRect.width - cardWidth - 12)
    );
    const top = Math.max(
      12,
      Math.min(nodeTop, wrapperRect.height - cardHeight - 12)
    );

    if (placement !== nextPlacement) {
      setPlacement(nextPlacement);
    }

    const nextPosition = {
      left,
      top,
      connectorY: Math.max(20, nodeTop + (nodeBottom - nodeTop) / 2 - top),
    };

    if (
      !position ||
      position.left !== nextPosition.left ||
      position.top !== nextPosition.top ||
      position.connectorY !== nextPosition.connectorY
    ) {
      setPosition(nextPosition);
    }
  }, [
    anchorNode,
    flowWrapperRef,
    placement,
    position,
    reactFlowInstance,
    viewportRevision,
  ]);

  if (!anchorNode || !position) {
    return null;
  }

  return (
    <section
      ref={cardRef}
      className={`anchored-conversation ${placement}`}
      style={{ left: position.left, top: position.top }}
      aria-label={`Conversation for ${anchorTitle}`}
    >
      <span
        className="anchored-conversation-connector"
        style={{ top: position.connectorY }}
      />

      <header className="anchored-conversation-header">
        <div className="anchored-conversation-copy">
          <div className="drawer-eyebrow">{anchorType}</div>
          <h2>{anchorTitle}</h2>
          <div className="anchored-conversation-stage">
            {episode.id} · {EPISODE_STAGES[thread?.stageIndex ?? stageIndex]?.name}
          </div>

          {orchestrationEligible && (
            <button
              type="button"
              className="anchored-orchestration-action"
              onClick={onOrchestrate}
            >
              {orchestrationApproved
                ? `${orchestrationSummary.total} agents`
                : "Orchestrate"}
            </button>
          )}
        </div>

        <div className="anchored-conversation-controls">
          <button type="button" onClick={onExpand} aria-label="Expand conversation">
            ↗
          </button>
          <button type="button" onClick={onFullscreen} aria-label="Open full-screen conversation">
            ⛶
          </button>
          <button type="button" onClick={onMinimize} aria-label="Minimize node conversation">
            —
          </button>
        </div>
      </header>

      <div className="anchored-conversation-thread">
          {contextSummary ? (
          <div className="anchored-context-summary">
            <strong>{contextSummary.source}</strong>
            <p>{contextSummary.summary}</p>
            <button type="button" onClick={onViewContext}>View context</button>
          </div>
        ) : (
          <ConversationMessages thread={thread} compact />
        )}
      </div>

      <ConversationComposer
        key={`${anchorNodeId}:${thread?.id ?? ""}`}
        thread={thread}
        onSend={onSend}
      />
    </section>
  );
}

function FullscreenConversation({
  open,
  onClose,
  episode,
  stageIndex,
  anchorTitle,
  anchorType,
  thread,
  onSend,
}) {
  if (!open || !episode) {
    return null;
  }

  const resolvedStageIndex =
    thread?.stageIndex ?? stageIndex ?? episode.currentStage;

  return (
    <div className="fullscreen-conversation-overlay">
      <section className="fullscreen-conversation" role="dialog" aria-modal="true">
        <header className="fullscreen-conversation-header">
          <div>
            <div className="drawer-eyebrow">Focused node conversation</div>
            <h2>{anchorTitle}</h2>
            <div className="drawer-anchor-meta">
              <span>{episode.id}</span>
              <span>{EPISODE_STAGES[resolvedStageIndex]?.name}</span>
              <span>{anchorType}</span>
            </div>
          </div>

          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close full-screen conversation">
            ×
          </button>
        </header>

        <div className="fullscreen-conversation-thread">
          <ConversationMessages thread={thread} />
        </div>

        <ConversationComposer
          key={`${anchorTitle}:${thread?.id ?? ""}`}
          thread={thread}
          onSend={onSend}
        />
      </section>
    </div>
  );
}

function SourceViewer({ sourceId, onClose }) {
  const [source, setSource] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getEpisodeSource(sourceId).then((result) => { if (!cancelled) setSource(result); });
    return () => { cancelled = true; };
  }, [sourceId]);

  return <div className="source-viewer-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="source-viewer" role="dialog" aria-modal="true" aria-label="Source material">
      <header><div><div className="drawer-eyebrow">Local source</div><h2>{source?.fileName ?? "Loading source…"}</h2><span>{source?.fileType} · {source?.charCount?.toLocaleString() ?? "—"} chars</span></div><button type="button" onClick={onClose} aria-label="Close source viewer">×</button></header>
      <pre>{source?.text ?? "Loading extracted text…"}</pre>
    </section>
  </div>;
}

function SourceLibrary({ episode, onClose, onOpenSource }) {
  const sources = episode?.sources ?? [];

  return <div className="source-viewer-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="source-library" role="dialog" aria-modal="true" aria-label="Episode source material">
      <header>
        <div>
          <div className="drawer-eyebrow">Episode source material</div>
          <h2>{sources.length} uploaded {sources.length === 1 ? "file" : "files"}</h2>
          <p>Files stay in this browser. Codex only receives bounded extracted text when you start an analysis.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close source material">×</button>
      </header>
      {sources.length > 0 ? <div className="source-library-list">
        {sources.map((source) => <button type="button" key={source.sourceId} onClick={() => { onOpenSource(source.sourceId); onClose(); }}>
          <span className="source-library-file-icon" aria-hidden="true">⌁</span>
          <span><strong>{source.fileName}</strong><small>{source.fileType || source.extension?.toUpperCase() || "File"} · {source.charCount.toLocaleString()} extracted characters · Stored locally</small></span>
          <span className="source-library-open">Open</span>
        </button>)}
      </div> : <p className="source-library-empty">No source material has been attached to this episode.</p>}
    </section>
  </div>;
}

function NodeChatDrawer({
  open,
  onClose,

  episode,

  anchorNodeId,
  anchorTitle,
  anchorType,

  thread,

  onSend,
  stageIndex,
  contextContent,

  canRemoveNode,
  onRemoveNode,
  initialView = "conversation",
  nodeDetails,
  sourceManifest = [],
  nodeSourceManifest = [],
  onOpenSource,
  onAttachSources,
  onExportReview,
  attachmentsBusy = false,
}) {
  const [
    draft,
    setDraft,
  ] = useState("");

  const bottomRef =
    useRef(null);

  const messages =
    thread?.messages ?? [];

  const pending =
    thread?.status ===
    "pending";

  const [view, setView] = useState(initialView);
  const composerRef = useRef(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setDraft("");
  }, [
    open,
    anchorNodeId,
    thread?.id,
  ]);

  useEffect(() => {
    if (open) setView(initialView);
  }, [open, initialView, anchorNodeId]);

  useEffect(() => {
    if (open && view === "conversation") {
      composerRef.current?.focus();
    }
  }, [open, view]);

  useEffect(() => {
    if (!open) {
      return;
    }

    bottomRef.current?.scrollIntoView(
      {
        behavior: "smooth",
      }
    );
  }, [
    open,
    messages.length,
    pending,
  ]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(
      event
    ) {
      if (
        event.key === "Escape"
      ) {
        onClose();
      }
    }

    window.addEventListener(
      "keydown",
      handleKeyDown
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown
      );
    };
  }, [open, onClose]);

  if (
    !open ||
    !episode ||
    !anchorNodeId
  ) {
    return null;
  }

  function submit(
    event
  ) {
    event.preventDefault();

    const clean =
      draft.trim();

    if (
      !clean ||
      pending
    ) {
      return;
    }

    onSend(clean);

    setDraft("");
  }

  return (
    <aside className="node-chat-drawer">
      <header className="drawer-header">
        <div className="drawer-header-copy">
          <div className="drawer-eyebrow">
            {view === "details" ? "Branch node details" : "Node conversation"}
          </div>

          <h2>
            {anchorTitle}
          </h2>

          <div className="drawer-anchor-meta">
            <span>
              {anchorType}
            </span>

            <span>
              {episode.id}
            </span>

            <span>
              {
                EPISODE_STAGES[
                  thread?.stageIndex ??
                    stageIndex ??
                    episode.currentStage
                ]?.name
              }
            </span>
          </div>
        </div>

        <button
          type="button"
          className="drawer-close"
          onClick={onClose}
          aria-label="Close node conversation"
        >
          ×
        </button>
      </header>

      <div className="drawer-tabs" role="tablist" aria-label="Node surface">
        <button type="button" className={view === "details" ? "active" : ""} role="tab" aria-selected={view === "details"} onClick={() => setView("details")}>Details</button>
        <button type="button" className={view === "conversation" ? "active" : ""} role="tab" aria-selected={view === "conversation"} onClick={() => setView("conversation")}>Conversation</button>
      </div>

      {view === "details" && (
        <div className="drawer-node-details">
          <div className="drawer-detail-eyebrow">{nodeDetails?.state ?? "Node details"} · {nodeDetails?.kind ?? anchorType}</div>
          <h3>{anchorTitle}</h3>
          {anchorNodeId === "context" && (
            <section>
              <span>Full context</span>
              <p className="drawer-context-raw">{contextContent || "No additional context was provided yet."}</p>
              {sourceManifest.length > 0 && <div className="drawer-source-list"><span>Attached sources</span>{sourceManifest.map((source) => <button type="button" key={source.sourceId} onClick={() => onOpenSource(source.sourceId)}>{source.fileName} · {source.charCount.toLocaleString()} chars</button>)}</div>}
            </section>
          )}
          {nodeDetails?.description && <section><span>Purpose / Description</span><p>{nodeDetails.description}</p></section>}
          {nodeDetails?.rationale && <section><span>Why this node exists</span><p>{nodeDetails.rationale}</p></section>}
          {nodeDetails?.dependsOn?.length > 0 && <section><span>Dependencies</span>{nodeDetails.dependsOn.map((dependency) => <p key={dependency.id}>• {dependency.title}</p>)}</section>}
          {nodeDetails?.expectedOutcome && <section><span>Expected outcome</span><p>{nodeDetails.expectedOutcome}</p></section>}
          {nodeDetails?.provenance && <section><span>Source / Provenance</span><p>{nodeDetails.provenance}</p></section>}
          {nodeDetails?.sourceReferences?.length > 0 && <section><span>Source references</span>{nodeDetails.sourceReferences.map((source) => <button type="button" className="drawer-source-reference" key={source.sourceId} onClick={() => onOpenSource(source.sourceId)}>{source.fileName}</button>)}</section>}
          {nodeDetails?.agentOutput && <section className="drawer-agent-output">
            <div className="drawer-agent-output-heading"><span>Agent output</span><em>{nodeDetails.agentOutput.role || "Codex analysis"}</em></div>
            <p className="drawer-agent-output-summary">{nodeDetails.agentOutput.summary}</p>
            <div className="drawer-agent-output-grid">
              <div><strong>Findings</strong>{nodeDetails.agentOutput.findings.length ? <ul>{nodeDetails.agentOutput.findings.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <p>No findings were retained.</p>}</div>
              <div><strong>Assumptions</strong>{nodeDetails.agentOutput.assumptions.length ? <ul>{nodeDetails.agentOutput.assumptions.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <p>None recorded.</p>}</div>
              <div><strong>Open questions</strong>{nodeDetails.agentOutput.unresolvedQuestions.length ? <ul>{nodeDetails.agentOutput.unresolvedQuestions.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <p>None recorded.</p>}</div>
            </div>
            <div className="drawer-agent-next-step"><strong>Recommended next step</strong><p>{nodeDetails.agentOutput.recommendedNextStep || "Review the retained findings before deciding the next human action."}</p></div>
            <button type="button" className="drawer-export-review-button" onClick={() => onExportReview?.(nodeDetails)}>Download review (.md)</button>
          </section>}
          {nodeDetails?.authority && <section><span>Authority</span><p>{nodeDetails.authority}</p></section>}
          {nodeDetails?.acceptedAt && <section><span>Accepted by human</span><p>{new Date(nodeDetails.acceptedAt).toLocaleString()}</p></section>}
          <button type="button" className="drawer-ask-agent-button" onClick={() => { setView("conversation"); window.setTimeout(() => composerRef.current?.focus(), 0); }}>Ask agent about this node</button>
        </div>
      )}

      {view === "conversation" && <div className="drawer-thread">
        <section className="drawer-node-sources">
          <div>
            <span className="drawer-eyebrow">Node context</span>
            <strong>{nodeSourceManifest.length ? `${nodeSourceManifest.length} attached source${nodeSourceManifest.length === 1 ? "" : "s"}` : "No node-specific sources"}</strong>
          </div>
          {nodeSourceManifest.length > 0 && <div className="drawer-source-list">{nodeSourceManifest.map((source) => <button type="button" key={source.sourceId} onClick={() => onOpenSource(source.sourceId)}>{source.fileName}</button>)}</div>}
          <label className="drawer-node-source-upload">
            <span>{attachmentsBusy ? "Preparing source…" : "Attach files to this node"}</span>
            <input type="file" multiple accept=".txt,.md,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => { const files = [...event.target.files]; event.target.value = ""; if (files.length) onAttachSources?.(files); }} disabled={attachmentsBusy} />
          </label>
          <small>Only this node conversation will use these files automatically.</small>
        </section>
        {anchorNodeId === "context" && (
          <section className="drawer-context-detail">
            <div className="drawer-eyebrow">Known context</div>
            <h3>Source</h3>
            <p>{anchorTitle}</p>
            <h3>Full context</h3>
            <p className="drawer-context-raw">
              {contextContent || "No additional context was provided yet."}
            </p>
            {sourceManifest.length > 0 && <div className="drawer-source-list"><span>Attached sources</span>{sourceManifest.map((source) => <button type="button" key={source.sourceId} onClick={() => onOpenSource(source.sourceId)}>{source.fileName}</button>)}</div>}
          </section>
        )}

        {!thread && (
          <div className="drawer-empty">
            <div className="drawer-empty-icon">
              ◌
            </div>

            <strong>
              No conversation yet
            </strong>

            <p>
              Ask the agent something
              about this node. The
              conversation will remain
              anchored here and appear
              as a reasoning branch on
              the canvas.
            </p>
          </div>
        )}

        {messages.map(
          (message) => (
            <div
              key={
                message.id
              }
              className={`drawer-message ${message.role}`}
            >
              <div className="drawer-message-inner">
                <div className="drawer-message-role">
                  {message.role ===
                  "human"
                    ? "You"
                    : "Agent"}
                </div>

                <div className="drawer-message-bubble">
                  {
                    message.content
                  }
                </div>
              </div>
            </div>
          )
        )}

        {pending && (
          <div className="drawer-agent-pending">
            <span />

            Waiting for agent
            response…
          </div>
        )}

        <div
          ref={
            bottomRef
          }
        />
      </div>}

      {view === "conversation" && <form
        className="drawer-composer"
        onSubmit={submit}
      >
        <div className="drawer-composer-box">
          <textarea
            ref={composerRef}
            value={draft}
            onChange={(
              event
            ) =>
              setDraft(
                event.target
                  .value
              )
            }
            disabled={pending}
            placeholder={
              pending
                ? "Waiting for the agent to respond..."
                : thread
                ? "Continue this node conversation..."
                : "Ask the agent about this node..."
            }
          />

          <div className="drawer-composer-actions">
            <button
              type="submit"
              className="drawer-send-button"
              disabled={
                pending ||
                !draft.trim()
              }
            >
              Ask agent
            </button>
          </div>
        </div>

        <div className="drawer-footer">
          <span>
            Agent can inspect and
            respond. Stage progression
            and disposition remain
            human-owned.
          </span>

          {canRemoveNode && (
            <button
              type="button"
              className="drawer-remove-button"
              onClick={
                onRemoveNode
              }
            >
              Remove node
            </button>
          )}
        </div>
      </form>}
    </aside>
  );
}

function ActivityDrawer({ episode, open, onClose }) {
  const [filter, setFilter] = useState("all");
  const events = episode?.activity ?? [];
  const filteredEvents = events.filter((event) => {
    if (filter === "all") return true;
    if (filter === "human") return event.actor?.kind === "human";
    if (filter === "codex") return event.actor?.kind === "codex";
    return ["proposal", "human-review", "accepted", "execution-preview"].includes(event.authorityImpact);
  });
  const interventions = events.filter((event) => event.actor?.kind === "human" && event.authorityImpact);

  if (!open || !episode) return null;

  return (
    <aside id="episode-activity-drawer" className="activity-drawer" aria-label="Episode activity">
      <header className="activity-header">
        <div>
          <div className="drawer-eyebrow">Episode activity</div>
          <h2>{episode.id}</h2>
          <p>{episode.name || episode.title}</p>
        </div>
        <button type="button" className="drawer-close" onClick={onClose} aria-label="Close Episode activity">×</button>
      </header>

      <div className="activity-body">
        <section className="activity-snapshot">
          <div className="activity-section-label">Current state</div>
          <p><span>Stage</span>{EPISODE_STAGES[episode.currentStage]?.name}</p>
          <p><span>Structure</span>{episode.intake?.status === "accepted" ? "Accepted" : episode.intake?.status === "proposed" ? "Proposed" : "Not accepted"}</p>
          <p><span>Codex intake</span>{episode.runtime?.codex?.lastRunAt ? "Complete" : "Not run"}</p>
          <p><span>Human disposition</span>{episode.disposition ?? "Not reached"}</p>
        </section>

        <section className="activity-interventions">
          <div className="activity-section-label">Human interventions</div>
          {interventions.length ? <><strong>{interventions.length} intervention{interventions.length === 1 ? "" : "s"}</strong>{interventions.slice(-3).map((event) => <p key={event.id}>{event.title}<small>{event.summary}</small></p>)}</> : <p>No explicit human intervention recorded yet.</p>}
        </section>

        <div className="activity-filters" role="tablist" aria-label="Activity filters">
          {["all", "human", "codex", "governance"].map((value) => <button key={value} type="button" className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}
        </div>

        <div className="activity-timeline">
          {filteredEvents.length ? filteredEvents.map((event) => (
            <article key={event.id} className={`activity-event ${event.authorityImpact ?? ""}`}>
              <time>{new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
              <div className="activity-event-marker" aria-hidden="true">{event.actor?.kind === "human" ? "♙" : event.actor?.kind === "codex" ? "●" : "•"}</div>
              <div className="activity-event-copy"><strong>{event.title}</strong><span>{event.actor?.kind === "codex" ? "Codex" : event.actor?.kind === "human" ? "Human" : "System"}</span>{event.summary && <p>{event.summary}</p>}</div>
            </article>
          )) : <p className="activity-empty">No activity recorded for this filter.</p>}
        </div>
      </div>
    </aside>
  );
}

/* -------------------------------------------------------------------------- */
/* APP                                                                        */
/* -------------------------------------------------------------------------- */

export default function App() {
  const loadedEpisodes =
    useMemo(
      () =>
        loadEpisodes(),
      []
    );

  const [
    episodes,
    setEpisodes,
  ] = useState(
    loadedEpisodes
  );

  const [projects, setProjects] = useState(() => loadProjects());
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [openProjectMenuId, setOpenProjectMenuId] = useState(null);
  const [openEpisodeMenuId, setOpenEpisodeMenuId] = useState(null);
  const [movingEpisodeId, setMovingEpisodeId] = useState(null);
  const [renamingEpisode, setRenamingEpisode] = useState(null);
  const [episodeSearch, setEpisodeSearch] = useState("");
  const [expandedProjects, setExpandedProjects] = useState({});
  const [newEpisodeProjectId, setNewEpisodeProjectId] = useState(null);
  const [workflowExpanded, setWorkflowExpanded] = useState(true);

  const [
    activeEpisodeId,
    setActiveEpisodeId,
  ] = useState(
    loadedEpisodes[0]?.id ??
      null
  );

  const [
    viewStage,
    setViewStage,
  ] = useState(0);

  const [
    sidebarOpen,
    setSidebarOpen,
  ] = useState(true);

  const [
    createOpen,
    setCreateOpen,
  ] = useState(false);

  const [
    selectedNodeId,
    setSelectedNodeId,
  ] = useState(null);

  const [
    traceNodeId,
    setTraceNodeId,
  ] = useState(null);

  const [
    drawerOpen,
    setDrawerOpen,
  ] = useState(false);

  const [
    activityOpen,
    setActivityOpen,
  ] = useState(false);

  const [activitySeenByEpisode, setActivitySeenByEpisode] = useState({});
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationSeenByEpisode, setNotificationSeenByEpisode] = useState({});

  const [
    drawerView,
    setDrawerView,
  ] = useState("conversation");

  const [
    fullscreenOpen,
    setFullscreenOpen,
  ] = useState(false);

  const [
    anchoredConversationMinimized,
    setAnchoredConversationMinimized,
  ] = useState(false);

  const [
    orchestrationNodeId,
    setOrchestrationNodeId,
  ] = useState(null);

  const [
    orchestrationPreviews,
    setOrchestrationPreviews,
  ] = useState({});

  const [
    orchestrationExpanded,
    setOrchestrationExpanded,
  ] = useState(false);

  const [
    orchestrationMinimized,
    setOrchestrationMinimized,
  ] = useState(false);

  const [
    orchestrationDetailId,
    setOrchestrationDetailId,
  ] = useState(null);

  const [
    intakePanelOpen,
    setIntakePanelOpen,
  ] = useState(false);

  const [codexStatus, setCodexStatus] = useState({
    cliAvailable: false,
    authenticated: false,
    ready: false,
    message: "Checking local Codex…",
  });

  const [codexRunningEpisodeId, setCodexRunningEpisodeId] = useState(null);
  const [codexRun, setCodexRun] = useState(null);
  const codexEventSourceRef = useRef(null);
  const orchestrationEventSourceRef = useRef(null);
  const autopilotEventSourceRef = useRef(null);
  const [orchestrationRun, setOrchestrationRun] = useState(null);
  const [autopilotRun, setAutopilotRun] = useState(null);
  const [followAutopilotWork, setFollowAutopilotWork] = useState(true);
  const [showGeneratedArtifacts, setShowGeneratedArtifacts] = useState(false);
  const [showAutopilotInspector, setShowAutopilotInspector] = useState(true);
  const [showEpisodeCockpit, setShowEpisodeCockpit] = useState(false);
  const [showCanvasHeader, setShowCanvasHeader] = useState(true);
  const [agentNotifications, setAgentNotifications] = useState([]);
  const [sourceViewerId, setSourceViewerId] = useState(null);
  const [sourceLibraryOpen, setSourceLibraryOpen] = useState(false);
  const [nodeSourceBusy, setNodeSourceBusy] = useState(false);

  const [
    viewportRevision,
    setViewportRevision,
  ] = useState(0);

  const flowWrapperRef = useRef(null);

  const [
    activeThreadId,
    setActiveThreadId,
  ] = useState(null);

  const [
    reactFlowInstance,
    setReactFlowInstance,
  ] = useState(null);

  const [
    nodes,
    setNodes,
    onNodesChange,
  ] = useNodesState([]);

  const [
    edges,
    setEdges,
    onEdgesChange,
  ] = useEdgesState([]);

  /* ---------------------------------------------------------------------- */
  /* ACTIVE DATA                                                            */
  /* ---------------------------------------------------------------------- */

  const activeEpisode =
    useMemo(
      () =>
        episodes.find(
          (episode) =>
            episode.id ===
            activeEpisodeId
        ) ??
        episodes[0],
      [
        episodes,
        activeEpisodeId,
      ]
    );

  function getProjectName(projectId) {
    return projects.find((project) => project.id === projectId)?.name ?? null;
  }

  const activeProject = activeEpisode?.projectId
    ? projects.find((project) => project.id === activeEpisode.projectId) ?? null
    : null;

  const activeStageTemplate =
    EPISODE_STAGES[
      viewStage
    ];

  const activeThread =
    useMemo(() => {
      if (
        !activeEpisode ||
        !activeThreadId
      ) {
        return null;
      }

      return (
        activeEpisode.additions?.find(
          (item) =>
            item.id ===
              activeThreadId &&
            item.kind ===
              "thread"
        ) ?? null
      );
    }, [
      activeEpisode,
      activeThreadId,
    ]);

  const visibleTopologyKey =
    useMemo(() => {
      if (!activeEpisode) {
        return "";
      }

      const additionIds = (
        activeEpisode.additions ?? []
      )
        .filter(
          (item) =>
            item.stageIndex ===
            viewStage
        )
        .map((item) => item.id)
        .join("|");

      return `${activeEpisode.id}:${viewStage}:${additionIds}`;
    }, [activeEpisode, viewStage]);

  /* ---------------------------------------------------------------------- */
  /* PERSISTENCE                                                            */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        episodes
      )
    );
  }, [episodes]);

  useEffect(() => {
    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
  }, [projects]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/codex/status")
      .then((response) => response.json())
      .then((status) => { if (!cancelled) setCodexStatus(status); })
      .catch(() => {
        if (!cancelled) setCodexStatus({ cliAvailable: false, authenticated: false, ready: false, message: "Local Codex runtime unavailable" });
      });
    return () => { cancelled = true; };
  }, []);

  useLayoutEffect(() => {
    if (!activeEpisode) {
      return;
    }

    setViewStage(
      activeEpisode.currentStage
    );

    setWorkflowExpanded(true);

    setSelectedNodeId(
      null
    );

    setTraceNodeId(null);

    setActiveThreadId(
      null
    );

    setDrawerOpen(
      false
    );

    setFullscreenOpen(false);
    setActivityOpen(false);
    setNotificationsOpen(false);
    setDrawerView("details");

    setAnchoredConversationMinimized(false);
    setOrchestrationNodeId(null);
    setOrchestrationExpanded(false);
    setOrchestrationMinimized(false);
    setOrchestrationDetailId(null);
    setOrchestrationPreviews(activeEpisode.runtime?.codex?.orchestration ?? {});
    setOrchestrationRun(null);
    setAutopilotRun(activeEpisode.autopilotRun ?? null);
    setFollowAutopilotWork(Boolean(activeEpisode.autopilotRun?.status === "working"));
    setIntakePanelOpen(
      ["pending", "proposed"].includes(activeEpisode.intake?.status)
    );
  }, [activeEpisodeId]);

  /* ---------------------------------------------------------------------- */
  /* BASIC HELPERS                                                          */
  /* ---------------------------------------------------------------------- */

  function updateEpisode(
    episodeId,
    updater
  ) {
    setEpisodes(
      (current) =>
        current.map(
          (episode) =>
            episode.id ===
            episodeId
              ? updater(
                  episode
                )
              : episode
        )
    );
  }

  function appendActivity(episodeId, event) {
    updateEpisode(episodeId, (episode) => ({
      ...episode,
      activity: [...(episode.activity ?? []), createActivityEvent({ episodeId, ...event })],
    }));
  }

  function updateProject(projectId, updater) {
    if (!projectId) return;
    setProjects((current) => current.map((project) => project.id === projectId ? updater(project) : project));
  }

  function acceptReadback() {
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

  function recordProjectState() {
    if (!activeProject) return;
    const summary = window.prompt("Describe the current authoritative project state.", activeProject.state?.summary ?? "");
    if (!summary?.trim()) return;
    const now = new Date().toISOString();
    updateProject(activeProject.id, (project) => ({
      ...project,
      state: { id: `state-${crypto.randomUUID()}`, summary: summary.trim(), sourceIds: [], authority: AUTHORITY_STATES.AUTHORITATIVE, createdAt: now },
      stateHistory: [...(project.stateHistory ?? []), { id: `state-change-${crypto.randomUUID()}`, type: "manual", value: summary.trim(), owner: project.ownerName, createdAt: now, authority: AUTHORITY_STATES.AUTHORITATIVE }],
    }));
    appendActivity(activeEpisode.id, { type: "project.state_recorded", actor: "human", title: "Project State recorded", summary: summary.trim(), authorityImpact: "accepted" });
  }

  function updateActiveEpisode(
    updater
  ) {
    if (
      !activeEpisodeId
    ) {
      return;
    }

    updateEpisode(
      activeEpisodeId,
      updater
    );
  }

  async function attachNodeSources(nodeId, files) {
    if (!activeEpisode || !nodeId || files.length === 0) return;
    if ((activeEpisode.sources?.length ?? 0) + files.length > MAX_SOURCE_FILES) {
      throw new Error(`An episode can contain up to ${MAX_SOURCE_FILES} files.`);
    }
    setNodeSourceBusy(true);
    try {
      const records = [];
      for (const file of files) records.push(await extractSourceFile(file));
      const manifest = sourceManifestFromRecords(records);
      const validation = validateSourceManifest([...(activeEpisode.sources ?? []), ...manifest]);
      if (!validation.valid) throw new Error(validation.error);
      await saveEpisodeSources(records, activeEpisode.id);
      updateEpisode(activeEpisode.id, (episode) => ({
        ...episode,
        sources: [...(episode.sources ?? []), ...manifest],
        nodeSourceIds: {
          ...(episode.nodeSourceIds ?? {}),
          [nodeId]: [...new Set([...(episode.nodeSourceIds?.[nodeId] ?? []), ...manifest.map((source) => source.sourceId)])],
        },
      }));
      appendActivity(activeEpisode.id, { type: "source.node_attached", actor: "human", title: "Source attached to node", summary: `${manifest.map((source) => source.fileName).join(", ")} · available only in this node conversation.`, relatedNodeId: nodeId, authorityImpact: "source-management" });
    } finally {
      setNodeSourceBusy(false);
    }
  }

  function exportEpisodeReview(episode) {
    if (!episode) return;
    const run = episode.autopilotRun;
    const lines = [
      `# ${episode.name || deriveEpisodeName(episode.title)}`,
      "",
      `Episode: ${episode.id}`,
      `Current stage: ${EPISODE_STAGES[episode.currentStage]?.name ?? "Unknown"}`,
      `Workflow template: ${episode.template ? `${episode.template.name} v${episode.template.version}` : "Custom"}`,
      "",
      "## Objective",
      episode.title,
      "",
      "## Context",
      episode.context || "No additional context supplied.",
      "",
      "## Sources",
      ...(episode.sources?.length ? episode.sources.map((source) => `- ${source.fileName} (${source.charCount.toLocaleString()} extracted characters)`) : ["- No source files attached."]),
      "",
      "## Autopilot review package",
      run?.finalPackage?.summary ?? "No final Autopilot package is available.",
      "",
      "### Findings",
      ...(run?.finalPackage?.findings?.length ? run.finalPackage.findings.map((item) => `- ${item}`) : ["- None recorded."]),
      "",
      "### Risks and unresolved questions",
      ...(run?.finalPackage?.risks?.length ? run.finalPackage.risks.map((item) => `- ${item}`) : ["- None recorded."]),
      ...(run?.finalPackage?.unresolvedQuestions?.length ? run.finalPackage.unresolvedQuestions.map((item) => `- Unresolved: ${item}`) : []),
      "",
      "## Human review",
      `Status: ${run?.humanReviewStatus ?? "Not recorded"}`,
      `Recommended next step: ${run?.finalPackage?.recommendedNextStep ?? "Review the episode evidence and decide the next human action."}`,
      "",
      "This package is a draft for human review. It does not authorize external action, stage advancement, or final disposition.",
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${episode.id.toLowerCase()}-review-package.md`;
    link.click();
    URL.revokeObjectURL(url);
    appendActivity(episode.id, { type: "review.package_exported", actor: "human", title: "Review package exported", summary: "A Markdown review package was downloaded for sharing and review.", authorityImpact: "human-review" });
  }

  function exportNodeOutputReview(nodeDetails) {
    if (!activeEpisode || !nodeDetails?.agentOutput) return;
    const output = nodeDetails.agentOutput;
    const lines = [
      `# ${output.role} review`,
      "",
      `Episode: ${activeEpisode.id}`,
      `Stage: ${EPISODE_STAGES[viewStage]?.name ?? "Unknown"}`,
      "",
      "## Summary",
      output.summary,
      "",
      "## Findings",
      ...markdownList(output.findings),
      "",
      "## Evidence sources",
      ...markdownList(nodeDetails.sourceReferences?.map((source) => source.fileName), "No sources were cited in this output."),
      "",
      "## Assumptions",
      ...markdownList(output.assumptions),
      "",
      "## Open questions",
      ...markdownList(output.unresolvedQuestions),
      "",
      "## Recommended next step",
      output.recommendedNextStep || "Review the findings and decide the next human action.",
      "",
      "This is a read-only Codex analysis artifact for human review. It does not authorize external action, stage advancement, or final disposition.",
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activeEpisode.id.toLowerCase()}-${(output.role || "agent-output").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-review.md`;
    link.click();
    URL.revokeObjectURL(url);
    appendActivity(activeEpisode.id, { type: "agent.output_exported", actor: "human", title: "Agent output exported", summary: `${output.role} review downloaded as Markdown.`, authorityImpact: "human-review" });
  }

  function findBaseNode(
    stageIndex,
    nodeId
  ) {
    return (
      EPISODE_STAGES[
        stageIndex
      ]?.nodes.find(
        (node) =>
          node.id ===
          nodeId
      ) ?? null
    );
  }

  function findNodeTitle(
    episode,
    stageIndex,
    nodeId
  ) {
    const base =
      findBaseNode(
        stageIndex,
        nodeId
      );

    if (base) {
      if (
        nodeId === "work"
      ) {
        return episode.title;
      }

      if (
        nodeId === "context"
      ) {
        return "Known context";
      }

      return base.title;
    }

    const workflowNode = episode.workflow?.nodes?.find(
      (node) => node.id === nodeId
    );
    if (workflowNode) {
      return workflowNode.title;
    }

    const workflowGate = episode.workflow?.gates?.find(
      (gate) => gate.id === nodeId
    );
    if (workflowGate) return workflowGate.title;

    const proposalNode = episode.intake?.proposal?.workNodes?.find(
      (node) => node.id === nodeId
    );
    if (proposalNode) {
      return proposalNode.title;
    }

    const proposalGate = episode.intake?.proposal?.humanGates?.find(
      (gate) => gate.id === nodeId
    );
    if (proposalGate) return proposalGate.title;

    const addition =
      episode.additions?.find(
        (item) =>
          item.stageIndex ===
            stageIndex &&
          item.id ===
            nodeId
      );

    if (
      addition?.kind ===
      "thread"
    ) {
      return (
        firstHumanMessage(
          addition
        )?.content ??
        "Node thread"
      );
    }

    return (
      addition?.title ??
      nodeId
    );
  }

  function getNodeTypeLabel(
    episode,
    stageIndex,
    nodeId
  ) {
    const base =
      findBaseNode(
        stageIndex,
        nodeId
      );

    if (base) {
      return base.type;
    }

    const workflowNode = episode.workflow?.nodes?.find(
      (node) => node.id === nodeId
    );
    if (workflowNode) {
      return workflowNode.kind;
    }

    if (episode.workflow?.gates?.some((gate) => gate.id === nodeId)) {
      return "Human checkpoint";
    }

    const proposalNode = episode.intake?.proposal?.workNodes?.find(
      (node) => node.id === nodeId
    );
    if (proposalNode) {
      return proposalNode.kind;
    }

    if (episode.intake?.proposal?.humanGates?.some((gate) => gate.id === nodeId)) {
      return "Human checkpoint";
    }

    const addition =
      episode.additions?.find(
        (item) =>
          item.stageIndex ===
            stageIndex &&
          item.id ===
            nodeId
      );

    return (
      addition?.label ??
      addition?.kind ??
      "Branch node"
    );
  }

  function getNodePosition(
    episode,
    stageIndex,
    nodeId
  ) {
    const saved =
      episode.layouts?.[
        stageIndex
      ]?.[nodeId];

    if (saved) {
      return saved;
    }

    const base =
      findBaseNode(
        stageIndex,
        nodeId
      );

    if (base) {
      return base.position;
    }

    const workflowNode = episode.workflow?.nodes?.find(
      (node) => node.id === nodeId
    );
    if (workflowNode) {
      return workflowNode.position;
    }

    const workflowGate = episode.workflow?.gates?.find(
      (gate) => gate.id === nodeId
    );
    if (workflowGate) return workflowGate.position;

    const addition =
      episode.additions?.find(
        (item) =>
          item.stageIndex ===
            stageIndex &&
          item.id ===
            nodeId
      );

    return (
      addition?.position ?? {
        x: 900,
        y: 200,
      }
    );
  }

  function getThreadsForNode(
    episode,
    stageIndex,
    nodeId
  ) {
    return (
      episode.additions ?? []
    ).filter(
      (item) =>
        item.kind ===
          "thread" &&
        item.stageIndex ===
          stageIndex &&
        item.parentNodeId ===
          nodeId
    );
  }

  function getThreadStats(
    episode,
    stageIndex,
    nodeId
  ) {
    const threads =
      getThreadsForNode(
        episode,
        stageIndex,
        nodeId
      );

    const messageCount =
      threads.reduce(
        (
          total,
          thread
        ) =>
          total +
          (
            thread.messages ??
            []
          ).length,
        0
      );

    const pending =
      threads.some(
        (thread) =>
          thread.status ===
          "pending"
      );

    const latestThread =
      threads[
        threads.length - 1
      ] ?? null;

    return {
      threads,
      messageCount,
      pending,
      latestThread,
    };
  }

  function getOrchestrationNodeRecord(nodeId) {
    const renderedNode = nodes.find(
      (node) => node.id === nodeId
    );

    if (renderedNode) {
      return renderedNode;
    }

    const baseNode = findBaseNode(
      viewStage,
      nodeId
    );

    return {
      id: nodeId,
      type: "card",
      data: {
        label: baseNode?.type ?? "Work node",
        title: findNodeTitle(
          activeEpisode,
          viewStage,
          nodeId
        ),
        body: baseNode?.body ?? "",
      },
    };
  }

  function getOrchestrationSourceNode(nodeId) {
    const renderedNode = nodes.find((node) => node.id === nodeId);
    if (renderedNode) return renderedNode;
    const workflowNode = getVisibleStageNodes().find((node) => node.id === nodeId);
    return workflowNode
      ? {
          id: workflowNode.id,
          kind: workflowNode.kind,
          data: {
            workflowKind: workflowNode.kind,
            proposed: workflowNode.proposed === true,
          },
        }
      : null;
  }

  function getLocalOrchestrationRequest(nodeId) {
    const node = getOrchestrationSourceNode(nodeId);
    if (
      !activeEpisode ||
      !nodeId ||
      !isOrchestrationEligibleNode(node)
    ) {
      return null;
    }

    return createOrchestrationRequest({
      episode: activeEpisode,
      node: getOrchestrationNodeRecord(nodeId),
      threads: getThreadsForNode(
        activeEpisode,
        viewStage,
        nodeId
      ),
      context: {
        expectedOutcome: "A reviewed orchestration proposal.",
      },
    });
  }

  function getLocalOrchestrationPlan(nodeId) {
    const node = getOrchestrationSourceNode(nodeId);
    if (
      !activeEpisode ||
      !nodeId ||
      !isOrchestrationEligibleNode(node)
    ) {
      return null;
    }

    const request = getLocalOrchestrationRequest(nodeId);
    const plan = createOrchestrationPlan({
      episode: activeEpisode,
      node: getOrchestrationNodeRecord(nodeId),
      threads: getThreadsForNode(
        activeEpisode,
        viewStage,
        nodeId
      ),
      context: {
        expectedOutcome: "A reviewed orchestration proposal.",
      },
    });

    return {
      ...plan,
      request,
    };
  }

  function pushAgentNotification({ title, summary, nodeId }) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setAgentNotifications((current) => [...current, { id, title, summary, nodeId }].slice(-4));
  }

  function openNodeOrchestration(nodeId) {
    const node = getOrchestrationSourceNode(nodeId);
    if (
      !activeEpisode ||
      !nodeId ||
      !isOrchestrationEligibleNode(node)
    ) {
      return;
    }

    setSelectedNodeId(nodeId);
    setOrchestrationNodeId(nodeId);
    setOrchestrationMinimized(false);
    setOrchestrationDetailId(null);
    setOrchestrationExpanded(false);
    appendActivity(activeEpisode.id, {
      type: "orchestration.requested",
      actor: "human",
      title: "Human requested orchestration preview",
      summary: findNodeTitle(activeEpisode, viewStage, nodeId),
      relatedNodeId: nodeId,
      authorityImpact: "execution-preview",
    });
  }

  function previewFirstMate() {
    if (!orchestrationNodeId) {
      return;
    }

    setOrchestrationPreviews((current) => ({
      ...current,
      [orchestrationNodeId]: {
        state: "proposed",
        plan: getLocalOrchestrationPlan(orchestrationNodeId),
      },
    }));
    appendActivity(activeEpisode.id, {
      type: "orchestration.plan_created",
      actor: "system",
      title: "Local planner created orchestration proposal",
      summary: "Preview only · no execution occurred.",
      relatedNodeId: orchestrationNodeId,
      authorityImpact: "execution-preview",
    });
  }

  function saveOrchestrationPreview(nodeId, nextValue) {
    setOrchestrationPreviews((current) => ({ ...current, [nodeId]: nextValue }));
    if (!activeEpisode) return;
    updateEpisode(activeEpisode.id, (episode) => ({
      ...episode,
      runtime: {
        ...(episode.runtime ?? {}),
        codex: {
          ...(episode.runtime?.codex ?? {}),
          orchestration: {
            ...(episode.runtime?.codex?.orchestration ?? {}),
            [nodeId]: nextValue,
          },
        },
      },
    }));
  }

  function backToOrchestrationRequest() {
    if (!orchestrationNodeId) {
      return;
    }

    setOrchestrationPreviews((current) => ({
      ...current,
      [orchestrationNodeId]: {
        state: "request",
        plan:
          current[orchestrationNodeId]?.plan ??
          getLocalOrchestrationPlan(orchestrationNodeId),
      },
    }));
  }

  function approveOrchestrationPreview() {
    if (!orchestrationNodeId) {
      return;
    }
    if (activeEpisode.governance?.readback?.status !== "accepted" || !activeEpisode.governance?.baseline || !activeProject?.state?.id || activeEpisode.governance.baseline.projectStateId !== activeProject.state.id) {
      appendActivity(activeEpisode.id, { type: "orchestration.authorization_blocked", actor: "system", title: "Orchestration not authorized", summary: "Accept the Readback and ensure the Episode baseline matches current Project State before authorizing this run.", relatedNodeId: orchestrationNodeId, authorityImpact: "prohibited" });
      return;
    }

    const plan = orchestrationPreviews[orchestrationNodeId]?.plan ?? getLocalOrchestrationPlan(orchestrationNodeId);
    const executionState = selectOrchestrationTasks(plan).reduce(
      (state, task) => ({ ...state, [task.id]: "Queued" }),
      {}
    );
    const provisionalRoute = createAgentRoute({ role: "First Mate coordinator" });
    const lease = createWorkLease({ episode: activeEpisode, agentRoute: provisionalRoute, objective: findNodeTitle(activeEpisode, viewStage, orchestrationNodeId), action: "orchestration" });
    const route = { ...provisionalRoute, leaseId: lease.id, authority: AUTHORITY_STATES.AUTHORIZED };
    updateEpisode(activeEpisode.id, (episode) => ({ ...episode, governance: { ...episode.governance, workLeases: [...(episode.governance.workLeases ?? []), lease], agentRoutes: [...(episode.governance.agentRoutes ?? []), route] } }));
    saveOrchestrationPreview(orchestrationNodeId, {
      state: "preview-approved",
      plan,
      executionState,
      runStatus: "queued",
      runId: null,
      taskOutputs: [],
      error: null,
      workLeaseId: lease.id,
    });
    setOrchestrationExpanded(false);
    setOrchestrationMinimized(false);
    appendActivity(activeEpisode.id, {
      type: "orchestration.preview_approved",
      actor: "human",
      title: "Human approved orchestration preview",
      summary: `Human approved a bounded read-only orchestration run under ${lease.id}.`,
      relatedNodeId: orchestrationNodeId,
      authorityImpact: "execution-preview",
    });
  }

  async function runOrchestration() {
    if (!activeEpisode || !orchestrationNodeId) return;
    const preview = orchestrationPreviews[orchestrationNodeId];
    const plan = preview?.plan ?? getLocalOrchestrationPlan(orchestrationNodeId);
    if (!plan || preview?.state !== "preview-approved" || orchestrationRun?.status === "working" || preview?.runStatus === "working") return;
    const lease = (activeEpisode.governance?.workLeases ?? []).find((item) => item.id === preview.workLeaseId);
    const leaseValidation = validateWorkLease({ lease, episodeId: activeEpisode.id, baselineId: activeEpisode.governance?.baseline?.id ?? null, action: "orchestration", projectStateId: activeProject?.state?.id ?? null });
    if (!leaseValidation.valid) {
      appendActivity(activeEpisode.id, { type: "orchestration.authorization_blocked", actor: "system", title: "Orchestration not authorized", summary: leaseValidation.error, relatedNodeId: orchestrationNodeId, authorityImpact: "prohibited" });
      return;
    }
    const route = (activeEpisode.governance?.agentRoutes ?? []).find((item) => item.leaseId === lease.id);
    const node = getOrchestrationNodeRecord(orchestrationNodeId);
    const sourceRecords = [];
    const relevantSourceIds = node.data?.sourceIds ?? [];
    try {
      for (const source of activeEpisode.sources ?? []) {
        if (relevantSourceIds.length > 0 && !relevantSourceIds.includes(source.sourceId)) continue;
        const stored = await getEpisodeSource(source.sourceId);
        if (!stored) throw new Error(`Source ${source.fileName} is missing from local storage.`);
        sourceRecords.push(sourceForAnalysis(source, stored));
      }
    } catch (error) {
      appendActivity(activeEpisode.id, { type: "orchestration.run_failed", actor: "system", title: "Read-only orchestration failed", summary: error.message, relatedNodeId: orchestrationNodeId, authorityImpact: "analysis" });
      return;
    }
    const tasks = selectOrchestrationTasks(plan);
    const initialRun = {
      episodeId: activeEpisode.id,
      nodeId: orchestrationNodeId,
      status: "queued",
      runId: null,
      taskStates: tasks.reduce((state, task) => ({ ...state, [task.id]: "Queued" }), {}),
      taskOutputs: [],
      events: [],
      startedAt: new Date().toISOString(),
    };
    setOrchestrationRun(initialRun);
    saveOrchestrationPreview(orchestrationNodeId, {
      ...preview,
      runStatus: "queued",
      runId: null,
      taskOutputs: [],
      error: null,
      startedAt: initialRun.startedAt,
    });
    appendActivity(activeEpisode.id, {
      type: "orchestration.run_started",
      actor: "human",
      title: "Human started read-only orchestration",
      summary: `Up to ${tasks.length} specialist turns using the local Codex runtime.`,
      relatedNodeId: orchestrationNodeId,
      authorityImpact: "analysis",
    });
    try {
      const response = await fetch("/api/codex/orchestration/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          approved: true,
          episodeId: activeEpisode.id,
          nodeId: orchestrationNodeId,
          episodeName: activeEpisode.name,
          objective: activeEpisode.title,
          context: activeEpisode.context,
          node: { id: node.id, kind: node.data?.workflowKind, title: node.data?.title, body: node.data?.body, sourceIds: node.data?.sourceIds ?? [] },
          threads: getThreadsForNode(activeEpisode, viewStage, orchestrationNodeId),
          sources: sourceRecords,
          plan,
          baseline: activeEpisode.governance.baseline,
          projectState: activeProject?.state ?? null,
          workLease: lease,
          agentRoute: route,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.runId) throw new Error(result.message || "Local orchestration runtime unavailable.");
      setOrchestrationRun((current) => current ? { ...current, status: "working", runId: result.runId } : current);
      saveOrchestrationPreview(orchestrationNodeId, {
        ...preview,
        runStatus: "working",
        runId: result.runId,
        taskOutputs: [],
        error: null,
        startedAt: initialRun.startedAt,
      });
      const eventSource = new EventSource(`/api/codex/runs/${result.runId}/events`);
      orchestrationEventSourceRef.current = eventSource;
      eventSource.onmessage = (event) => {
        const normalized = JSON.parse(event.data);
        setOrchestrationRun((current) => current && current.nodeId === orchestrationNodeId ? applyOrchestrationEvent(current, normalized) : current);
        if (normalized.type === "task" && normalized.status === "complete") {
          const completedTask = tasks.find((task) => task.id === normalized.taskId);
          pushAgentNotification({
            title: `${completedTask?.role ?? "Specialist"} completed`,
            summary: normalized.label ?? "A read-only output is ready to inspect.",
            nodeId: orchestrationNodeId,
          });
          appendActivity(activeEpisode.id, {
            type: "orchestration.task_completed",
            actor: "codex",
            title: "Orchestration specialist completed",
            summary: normalized.label ?? normalized.taskId,
            relatedNodeId: orchestrationNodeId,
            authorityImpact: "analysis",
          });
        }
        if (["completed", "cancelled", "error"].includes(normalized.type)) {
          const outputs = normalized.outputs ?? [];
          const status = normalized.type === "completed" ? "complete" : normalized.type;
          setOrchestrationRun((current) => current && current.nodeId === orchestrationNodeId
            ? { ...current, status, taskOutputs: outputs, finishedAt: new Date().toISOString() }
            : current);
          const artifacts = outputs.length > 0 ? mapOrchestrationArtifacts(outputs, { nodeId: orchestrationNodeId, nodeKind: node.data?.workflowKind, runId: result.runId, stageIndex: viewStage }) : [];
          updateEpisode(activeEpisode.id, (episode) => {
            const completedRoute = route ?? createAgentRoute({ lease, role: "First Mate coordinator" });
            const packageValue = {
              findings: outputs.flatMap((output) => output.findings ?? []),
              evidenceSourceIds: [...new Set(outputs.flatMap((output) => output.evidenceSourceIds ?? []))],
              summary: outputs.map((output) => output.summary).join(" "),
              conflicts: [],
              unresolvedQuestions: outputs.flatMap((output) => output.unresolvedQuestions ?? []),
              recommendedNextStep: "Review the specialist outputs and reconcile what should become Project State.",
            };
            return {
              ...episode,
              additions: artifacts.length > 0 ? [...(episode.additions ?? []), ...artifacts] : episode.additions,
              governance: {
                ...episode.governance,
                workLeases: episode.governance.workLeases.map((item) => item.id === lease.id ? { ...item, status: status === "complete" ? "completed" : status === "cancelled" ? "cancelled" : "expired", completedAt: new Date().toISOString() } : item),
                agentRoutes: episode.governance.agentRoutes.map((item) => item.id === completedRoute.id ? { ...item, status: status === "complete" ? "completed" : status } : item),
                returns: status === "complete" ? [...(episode.governance.returns ?? []), createReturnPacket({ runId: result.runId, lease, route: completedRoute, packageValue, outputs })] : episode.governance.returns,
              },
              runtime: { ...(episode.runtime ?? {}), codex: { ...(episode.runtime?.codex ?? {}), orchestration: { ...(episode.runtime?.codex?.orchestration ?? {}), [orchestrationNodeId]: { ...preview, state: "preview-approved", runStatus: status, runId: result.runId, taskOutputs: outputs, artifactIds: artifacts.map((artifact) => artifact.id), error: normalized.message ?? null, completedAt: new Date().toISOString() } } } },
            };
          });
          appendActivity(activeEpisode.id, { type: `orchestration.run_${status}`, actor: status === "complete" ? "codex" : "human", title: status === "complete" ? "Read-only orchestration completed" : status === "cancelled" ? "Read-only orchestration cancelled" : "Read-only orchestration failed", summary: normalized.message ?? `${outputs.length} specialist output${outputs.length === 1 ? "" : "s"} retained.`, relatedNodeId: orchestrationNodeId, authorityImpact: "analysis" });
          pushAgentNotification({
            title: status === "complete" ? "First Mate run completed" : `First Mate run ${status}`,
            summary: normalized.message ?? `${outputs.length} specialist output${outputs.length === 1 ? "" : "s"} are ready to inspect.`,
            nodeId: orchestrationNodeId,
          });
          eventSource.close();
          orchestrationEventSourceRef.current = null;
        }
      };
      eventSource.onerror = () => {
        if (eventSource.readyState === EventSource.CLOSED || orchestrationEventSourceRef.current !== eventSource) return;
        setOrchestrationRun((current) => current ? { ...current, status: "error", error: "Local orchestration runtime unavailable." } : current);
        updateEpisode(activeEpisode.id, (episode) => ({ ...episode, governance: { ...episode.governance, workLeases: episode.governance.workLeases.map((item) => item.id === lease.id ? { ...item, status: "expired", completedAt: new Date().toISOString() } : item), agentRoutes: episode.governance.agentRoutes.map((item) => item.leaseId === lease.id ? { ...item, status: "expired" } : item) } }));
        eventSource.close();
        orchestrationEventSourceRef.current = null;
      };
    } catch (error) {
      setOrchestrationRun((current) => current ? { ...current, status: "error", error: error.message } : current);
      saveOrchestrationPreview(orchestrationNodeId, { ...preview, runStatus: "error", error: error.message });
      updateEpisode(activeEpisode.id, (episode) => ({ ...episode, governance: { ...episode.governance, workLeases: episode.governance.workLeases.map((item) => item.id === lease.id ? { ...item, status: "expired", completedAt: new Date().toISOString() } : item), agentRoutes: episode.governance.agentRoutes.map((item) => item.leaseId === lease.id ? { ...item, status: "expired" } : item) } }));
      appendActivity(activeEpisode.id, { type: "orchestration.run_failed", actor: "codex", title: "Read-only orchestration failed", summary: error.message, relatedNodeId: orchestrationNodeId, authorityImpact: "analysis" });
    }
  }

  function cancelOrchestration() {
    if (!orchestrationRun?.runId) return;
    void fetch(`/api/codex/runs/${orchestrationRun.runId}`, { method: "DELETE" });
    setOrchestrationRun((current) => current ? { ...current, status: "cancelled" } : current);
    saveOrchestrationPreview(orchestrationNodeId, { ...(orchestrationPreviews[orchestrationNodeId] ?? {}), runStatus: "cancelled", runId: orchestrationRun.runId });
    if (activeEpisode) updateEpisode(activeEpisode.id, (episode) => ({ ...episode, governance: { ...episode.governance, workLeases: episode.governance.workLeases.map((lease) => lease.id === orchestrationPreviews[orchestrationNodeId]?.workLeaseId ? { ...lease, status: "cancelled", completedAt: new Date().toISOString() } : lease) } }));
  }

  function inspectOrchestrationArtifacts(taskId) {
    const preview = orchestrationPreviews[orchestrationNodeId];
    const output = (orchestrationRun?.taskOutputs ?? preview?.taskOutputs ?? []).find((item) => item.taskId === taskId);
    const runId = orchestrationRun?.runId ?? preview?.runId;
    const artifact = activeEpisode?.additions?.find((item) => item.orchestrationRunId === runId && item.taskRole === output?.role);
    if (artifact) openDetailsForNode(artifact.id);
  }

  function resetOrchestrationPreview() {
    if (!orchestrationNodeId) {
      return;
    }

    setOrchestrationPreviews((current) => {
      const next = { ...current };
      delete next[orchestrationNodeId];
      return next;
    });
    setOrchestrationNodeId(null);
    setOrchestrationExpanded(false);
    setOrchestrationMinimized(false);
    setOrchestrationDetailId(null);
  }

  function findEpisodeById(episodeId) {
    return episodes.find((episode) => episode.id === episodeId) ?? null;
  }

  function submitEpisodeStructure(proposal) {
    const episode = findEpisodeById(proposal?.episodeId);
    if (!episode) {
      throw new Error("Episode not found.");
    }
    if (!["pending", "proposed"].includes(episode.intake?.status)) {
      throw new Error("Episode intake is not awaiting a proposal.");
    }

    const normalizedProposal = {
      episodeId: episode.id,
      objective: proposal.objective,
      context: {
        summary: proposal.context?.summary ?? proposal.context_summary ?? "",
        suggestedSources: proposal.context?.suggestedSources ?? proposal.suggested_sources ?? [],
      },
      workNodes: (proposal.workNodes ?? proposal.work_nodes ?? []).map((node) => ({ ...node, sourceIds: node.sourceIds ?? node.source_ids ?? [] })),
      humanGates: proposal.humanGates ?? proposal.human_gates ?? [],
      assumptions: proposal.assumptions ?? [],
      unresolved: proposal.unresolved ?? [],
    };
    const validation = validateEpisodeStructureProposal(normalizedProposal, episode.id, episode.sources ?? []);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    updateEpisode(episode.id, (current) => ({
      ...current,
      intake: {
        ...normalizeEpisodeIntake(current.intake),
        status: "proposed",
        proposal: normalizedProposal,
      },
    }));
    appendActivity(episode.id, {
      type: "proposal.created",
      actor: "codex",
      title: "Episode structure proposed",
      summary: `${normalizedProposal.workNodes.length} work nodes · ${normalizedProposal.humanGates.length} human checkpoints`,
      metadata: {
        afterWorkNodeCount: normalizedProposal.workNodes.length,
        afterHumanGateCount: normalizedProposal.humanGates.length,
      },
      authorityImpact: "proposal",
    });
    setActiveEpisodeId(episode.id);
    setViewStage(0);
    setIntakePanelOpen(true);
    return normalizedProposal;
  }

  function requestIntakeRevision(revisionInstruction = "") {
    if (!activeEpisode) return;
    const previousProposal = activeEpisode.intake?.proposal;
    appendActivity(activeEpisode.id, {
      type: "proposal.revision_requested",
      actor: "human",
      title: "Human requested revision",
      summary: revisionInstruction.trim() || "Requested a revised Episode structure.",
      metadata: {
        beforeWorkNodeCount: previousProposal?.workNodes?.length ?? 0,
        beforeHumanGateCount: previousProposal?.humanGates?.length ?? 0,
        beforeProposalId: previousProposal?.id ?? null,
      },
      authorityImpact: "human-review",
    });
    updateEpisode(activeEpisode.id, (episode) => ({
      ...episode,
      intake: {
        ...normalizeEpisodeIntake(episode.intake),
        status: "pending",
        previousProposal: episode.intake?.proposal ?? null,
      },
    }));
    if (activeEpisode.runtime?.codex?.intakeThreadId) {
      void runNativeCodexIntake(activeEpisode, revisionInstruction);
    }
  }

  function acceptEpisodeStructure() {
    const proposal = activeEpisode?.intake?.proposal;
    if (!activeEpisode || !proposal) return;

    const validation = validateEpisodeStructureProposal(proposal, activeEpisode.id, activeEpisode.sources ?? []);
    if (!validation.valid) return;
    const nodes = proposal.workNodes.map((node, index) => ({
      id: node.id,
      type: node.kind,
      kind: node.kind,
      title: node.title,
      body: node.description,
      meta: node.rationale,
      description: node.description,
      rationale: node.rationale,
      dependsOn: node.dependsOn ?? [],
      sourceIds: node.sourceIds ?? [],
      expectedOutcome: node.expectedOutcome,
      position: {
        x: 120 + (index % 3) * 330,
        y: 300 + Math.floor(index / 3) * 240,
      },
    }));
    const dependencies = proposal.workNodes.flatMap((node) =>
      node.dependsOn?.length
        ? node.dependsOn.map((dependency) => [dependency, node.id])
        : [["work", node.id]]
    );
    const terminalNodes = proposal.workNodes.filter(
      (node) => !proposal.workNodes.some((candidate) => candidate.dependsOn?.includes(node.id))
    );
    const workflowGates = createWorkflowGates(proposal.humanGates);

    updateEpisode(activeEpisode.id, (episode) => ({
      ...episode,
      intake: {
        ...normalizeEpisodeIntake(episode.intake),
        status: "accepted",
        acceptedAt: new Date().toISOString(),
      },
      workflow: {
        nodes,
        gates: workflowGates,
        edges: [
          ...dependencies,
          ...createWorkflowGateEdges(
            workflowGates,
            terminalNodes.map((node) => node.id)
          ),
        ],
      },
    }));
    appendActivity(activeEpisode.id, {
      type: "proposal.accepted",
      actor: "human",
      title: "Structure accepted",
      summary: `${proposal.workNodes?.length ?? 0} work nodes · ${proposal.humanGates?.length ?? 0} human checkpoints`,
      metadata: {
        proposalId: proposal.id ?? null,
        workNodeCount: proposal.workNodes?.length ?? 0,
        humanGateCount: proposal.humanGates?.length ?? 0,
      },
      authorityImpact: "accepted",
    });
    setIntakePanelOpen(false);
  }

  /* ---------------------------------------------------------------------- */
  /* OPEN CHAT                                                              */
  /* ---------------------------------------------------------------------- */

  function getNodeDetails(nodeId) {
    if (!activeEpisode || !nodeId) {
      return null;
    }

    const workflowNode = activeEpisode.workflow?.nodes?.find(
      (node) => node.id === nodeId
    );
    const proposalNode = activeEpisode.intake?.proposal?.workNodes?.find(
      (node) => node.id === nodeId
    );
    const addition = activeEpisode.additions?.find(
      (item) => item.id === nodeId
    );
    const baseNode = findBaseNode(viewStage, nodeId);
    const source = workflowNode ?? proposalNode ?? addition ?? baseNode;

    if (!source) {
      return null;
    }

    const sourceReferences = (source.sourceIds ?? []).map((sourceId) =>
      activeEpisode.sources?.find((item) => item.sourceId === sourceId) ?? { sourceId, fileName: "Unknown source" }
    );

    const dependencies = source.dependsOn?.length
      ? source.dependsOn
      : workflowNode
      ? (activeEpisode.workflow?.edges ?? [])
          .filter((edge) => edge[1] === nodeId && edge[0] !== "work")
          .map((edge) => edge[0])
      : source.parentNodeId
      ? [source.parentNodeId]
      : [];
    const dependencyTitles = dependencies.map((dependencyId) => ({
      id: dependencyId,
      title: findNodeTitle(activeEpisode, viewStage, dependencyId),
    }));
    const expectedOutcome =
      source.expectedOutcome ?? source.output ?? source.expectedOutput;
    const isProposal = Boolean(proposalNode) && !workflowNode;
    const isAccepted = Boolean(workflowNode);
    const isAgentOutput = Boolean(addition && isGeneratedRunArtifact(addition));
    const outputRole = addition?.taskRole ?? addition?.metadata?.taskRole;
    const titleSummary = typeof addition?.title === "string" && outputRole && addition.title.startsWith(`${outputRole} · `)
      ? addition.title.slice(outputRole.length + 3)
      : addition?.body;
    const findings = addition?.findings ?? (addition?.metadata?.taskId ? String(addition.body ?? "").split(/\n\s*\n/).filter(Boolean) : []);

    return {
      state: isProposal
        ? "Proposed · Not accepted"
        : isAccepted
        ? "Accepted work node"
        : "Node details",
      kind: source.workflowKind ?? source.kind ?? source.type ?? "work node",
      description: source.description ?? source.body,
      rationale: source.rationale ?? source.meta,
      dependsOn: dependencyTitles,
      expectedOutcome,
      provenance: isProposal || isAccepted
        ? `Codex Episode Intake · Episode ${activeEpisode.id}`
        : null,
      authority: isProposal || isAccepted
        ? "Analysis / proposal only. No execution or stage advancement."
        : null,
      acceptedAt: isAccepted ? activeEpisode.intake?.acceptedAt : null,
      sourceReferences,
      agentOutput: isAgentOutput ? {
        role: outputRole ?? "Codex analysis",
        summary: titleSummary || "A retained agent output is ready for review.",
        findings,
        assumptions: addition.assumptions ?? addition.metadata?.assumptions ?? [],
        unresolvedQuestions: addition.unresolvedQuestions ?? addition.metadata?.unresolvedQuestions ?? [],
        recommendedNextStep: addition.recommendedNextStep ?? addition.metadata?.recommendedNextStep ?? "",
      } : null,
    };
  }

  function openContextDrawer() {
    if (!activeEpisode) {
      return;
    }

    setSelectedNodeId("context");
    setActiveThreadId(null);
    setAnchoredConversationMinimized(false);
    setDrawerView("details");
    setDrawerOpen(true);
  }

  function openDetailsForNode(nodeId) {
    if (!activeEpisode || !nodeId || !getNodeDetails(nodeId)) {
      return;
    }

    const stats = getThreadStats(activeEpisode, viewStage, nodeId);
    setSelectedNodeId(nodeId);
    setActiveThreadId(stats.latestThread?.id ?? null);
    setAnchoredConversationMinimized(false);
    setDrawerView("details");
    setDrawerOpen(true);
  }

  function openDrawerForNode(
    nodeId
  ) {
    if (
      !activeEpisode ||
      !nodeId
    ) {
      return;
    }

    const selected =
      activeEpisode.additions?.find(
        (item) =>
          item.id ===
          nodeId
      );

    /*
     * If user selected an actual thread
     * node, open that exact thread.
     */

    if (
      selected?.kind ===
      "thread"
    ) {
      setSelectedNodeId(
        selected.parentNodeId
      );

      setActiveThreadId(
        selected.id
      );

      setAnchoredConversationMinimized(false);

      setDrawerView("conversation");
      setDrawerOpen(false);

      return;
    }

    /*
     * Otherwise open latest thread
     * attached to the selected node.
     */

    const stats =
      getThreadStats(
        activeEpisode,
        viewStage,
        nodeId
      );

    setSelectedNodeId(
      nodeId
    );

    setAnchoredConversationMinimized(false);

    setActiveThreadId(
      stats.latestThread?.id ??
        null
    );

    setDrawerView("conversation");
    setDrawerOpen(false);
  }

  function closeDrawer() {
    setDrawerOpen(
      false
    );
  }

  /* ---------------------------------------------------------------------- */
  /* BRANCH POSITIONING                                                     */
  /* ---------------------------------------------------------------------- */

  function makeAdditionPosition(
    episode,
    stageIndex,
    parentNodeId
  ) {
    const X_DISTANCE =
      390;

    const Y_SLOT =
      300;

    const parentPosition =
      parentNodeId
        ? getNodePosition(
            episode,
            stageIndex,
            parentNodeId
          )
        : {
            x: 400,
            y: 100,
          };

    const siblings =
      (
        episode.additions ??
        []
      ).filter(
        (item) =>
          item.stageIndex ===
            stageIndex &&
          item.parentNodeId ===
            parentNodeId
      );

    let candidate = {
      x:
        parentPosition.x +
        X_DISTANCE,

      y:
        parentPosition.y +
        siblings.length *
          Y_SLOT,
    };

    const occupiedDynamic =
      (
        episode.additions ??
        []
      )
        .filter(
          (item) =>
            item.stageIndex ===
            stageIndex
        )
        .map((item) => ({
          x:
            episode.layouts?.[
              stageIndex
            ]?.[
              item.id
            ]?.x ??
            item.position?.x ??
            0,

          y:
            episode.layouts?.[
              stageIndex
            ]?.[
              item.id
            ]?.y ??
            item.position?.y ??
            0,
        }));

    const occupiedBase =
      (
        EPISODE_STAGES[
          stageIndex
        ]?.nodes ?? []
      ).map((item) => ({
        x:
          episode.layouts?.[
            stageIndex
          ]?.[
            item.id
          ]?.x ??
          item.position.x,

        y:
          episode.layouts?.[
            stageIndex
          ]?.[
            item.id
          ]?.y ??
          item.position.y,
      }));

    const occupied = [
      ...occupiedDynamic,
      ...occupiedBase,
    ];

    function overlaps(
      position
    ) {
      const WIDTH =
        315;

      const HEIGHT =
        240;

      const GAP =
        45;

      return occupied.some(
        (other) =>
          Math.abs(
            position.x -
              other.x
          ) <
            WIDTH +
              GAP &&
          Math.abs(
            position.y -
              other.y
          ) <
            HEIGHT +
              GAP
      );
    }

    let safety = 0;

    while (
      overlaps(
        candidate
      ) &&
      safety < 40
    ) {
      candidate = {
        ...candidate,

        y:
          candidate.y +
          Y_SLOT,
      };

      safety += 1;
    }

    return candidate;
  }

  /* ---------------------------------------------------------------------- */
  /* DELETE BRANCH                                                          */
  /* ---------------------------------------------------------------------- */

  function collectBranchIds(
    additions,
    rootId
  ) {
    const ids =
      new Set([
        rootId,
      ]);

    let changed = true;

    while (changed) {
      changed = false;

      additions.forEach(
        (item) => {
          if (
            item.parentNodeId &&
            ids.has(
              item.parentNodeId
            ) &&
            !ids.has(
              item.id
            )
          ) {
            ids.add(
              item.id
            );

            changed = true;
          }
        }
      );
    }

    return ids;
  }

  function removeNodeById(
    nodeId
  ) {
    if (
      !activeEpisode
    ) {
      return;
    }

    const addition =
      activeEpisode.additions?.find(
        (item) =>
          item.id ===
          nodeId
      );

    if (!addition) {
      return;
    }

    const confirmed =
      window.confirm(
        "Remove this branch node and any child branches beneath it?"
      );

    if (!confirmed) {
      return;
    }

    const removedIds =
      collectBranchIds(
        activeEpisode.additions ??
          [],
        nodeId
      );

    updateActiveEpisode(
      (episode) => {
        const cleanedLayouts =
          {};

        Object.entries(
          episode.layouts ??
            {}
        ).forEach(
          ([
            stageKey,
            layout,
          ]) => {
            cleanedLayouts[
              stageKey
            ] = {};

            Object.entries(
              layout ?? {}
            ).forEach(
              ([
                savedNodeId,
                position,
              ]) => {
                if (
                  !removedIds.has(
                    savedNodeId
                  )
                ) {
                  cleanedLayouts[
                    stageKey
                  ][savedNodeId] =
                    position;
                }
              }
            );
          }
        );

        return {
          ...episode,

          additions:
            (
              episode.additions ??
              []
            ).filter(
              (item) =>
                !removedIds.has(
                  item.id
                )
            ),

          layouts:
            cleanedLayouts,
        };
      }
    );

    if (
      activeThreadId &&
      removedIds.has(
        activeThreadId
      )
    ) {
      setActiveThreadId(
        null
      );
    }

    setSelectedNodeId(
      addition.parentNodeId ??
        null
    );

    setDrawerOpen(
      false
    );
  }

  /* ---------------------------------------------------------------------- */
  /* CREATE EPISODE                                                         */
  /* ---------------------------------------------------------------------- */

  async function createEpisode({
    title,
    name,
    context,
    setupMode,
    projectId,
    sources = [],
    sourceEvents = [],
    template = null,
  }) {
    const nextNumber =
      episodes.reduce(
        (
          highest,
          episode
        ) => {
          const value =
            Number(
              episode.id.split(
                "-"
              )[1]
            ) || 0;

          return Math.max(
            highest,
            value
          );
        },
        0
      ) + 1;

    const id =
      `E0-${String(
        nextNumber
      ).padStart(
        3,
        "0"
      )}`;

    const sourceManifest = sourceManifestFromRecords(sources);
    const sourceValidation = validateSourceManifest(sourceManifest);
    if (!sourceValidation.valid) throw new Error(sourceValidation.error);
    await saveEpisodeSources(sources, id);
    const project = projectId ? projects.find((item) => item.id === projectId) ?? null : null;

    const episode = {
      id,

      title,

      name: name || deriveEpisodeName(title),

      context,

      sources: sourceManifest,

      nodeSourceIds: {},

      template: template ? { id: template.id, name: template.name, version: template.version } : null,

      currentStage: 0,

      status: "active",

      disposition: null,

      layouts: {},

      additions: [],

      intake: {
        status: "idle",
        request: null,
        proposal: null,
        acceptedAt: null,
      },

      workflow: {
        nodes: [],
        edges: [],
        gates: [],
      },

      projectId: projectId ?? null,

      governance: {
        ownerName: project?.ownerName ?? "Owner",
        baseline: createEpisodeBaseline(project),
        readback: null,
        readbackHistory: [],
        workLeases: [],
        agentRoutes: [],
        returns: [],
      },

      runtime: {
        codex: {
          intakeThreadId: null,
          lastRunAt: null,
          lastError: null,
          orchestration: {},
        },
      },

      autopilotRun: null,

      activity: [
        createActivityEvent({
          episodeId: id,
          type: "episode.created",
          actor: "human",
          title: "Episode created",
          summary: name || deriveEpisodeName(title),
        }),
        ...(template ? [createActivityEvent({
          episodeId: id,
          type: "episode.template_applied",
          actor: "human",
          title: "Workflow template selected",
          summary: `${template.name} v${template.version} prefilled the episode brief; the workflow remains subject to human review.`,
          authorityImpact: "human-review",
        })] : []),
        ...(sourceManifest.length > 0 ? [createActivityEvent({
          episodeId: id,
          type: "source.ingested",
          actor: "human",
          title: "Source material ingested",
          summary: `${sourceManifest.length} source${sourceManifest.length === 1 ? "" : "s"} extracted and stored locally.`,
          metadata: { sourceIds: sourceManifest.map((source) => source.sourceId) },
        })] : []),
        ...sourceEvents.map((event) => createActivityEvent({
          episodeId: id,
          type: event.type,
          actor: "human",
          title: event.type === "source.extraction_failed" ? "Source extraction failed" : "Source removed before analysis",
          summary: event.message ?? event.fileName,
          metadata: { sourceId: event.sourceId ?? null, fileName: event.fileName ?? null },
          authorityImpact: "source-management",
        })),
      ],
    };

    if (setupMode === "agent-assisted") {
      episode.intake.request = createEpisodeIntakeRequest({ episode });
    }
    episode.governance.readback = createReadback(episode);
    episode.activity.push(createActivityEvent({
        episodeId: id,
        type: "readback.proposed",
        actor: "system",
        title: "Readback ready for owner review",
        summary: "The Workroom generated a bounded context readback. No work has been authorized.",
        authorityImpact: "proposal",
      }));

    setEpisodes(
      (current) => [
        ...current,
        episode,
      ]
    );

    setActiveEpisodeId(
      id
    );

    setViewStage(0);

    setSelectedNodeId(
      null
    );

    setIntakePanelOpen(false);

    setCreateOpen(
      false
    );
    setNewEpisodeProjectId(null);

  }

  async function runAutopilotEpisode(episode, instruction = "") {
    if (!episode?.id || autopilotEventSourceRef.current || episode.autopilotRun?.status === "working") return;
    const lease = (episode.governance?.workLeases ?? []).find((item) => item.status === "active" && item.action === "analysis");
    const project = episode.projectId ? projects.find((item) => item.id === episode.projectId) ?? null : null;
    const leaseValidation = validateWorkLease({ lease, episodeId: episode.id, baselineId: episode.governance?.baseline?.id ?? null, action: "analysis", projectStateId: project?.state?.id ?? null });
    if (episode.governance?.readback?.status !== "accepted" || !leaseValidation.valid) {
      appendActivity(episode.id, { type: "autopilot.authorization_blocked", actor: "system", title: "Analysis not authorized", summary: leaseValidation.error ?? "Accept the Readback before authorizing a Work Lease.", authorityImpact: "prohibited" });
      return;
    }
    const route = (episode.governance?.agentRoutes ?? []).find((item) => item.leaseId === lease.id) ?? createAgentRoute({ lease, role: "Read-only technical analyst" });
    const startedAt = new Date().toISOString();
    const initial = { ...(episode.autopilotRun ?? {}), episodeId: episode.id, status: "queued", runId: null, startedAt, finishedAt: null, instruction, activeTaskId: null, activeNodeId: null, taskStates: { "intake-planner": "queued" }, outputs: [], errors: [], error: null, finalPackage: null, humanReviewStatus: "pending", workLeaseId: lease.id, events: [], context: { objective: episode.title, sourceCount: episode.sources?.length ?? 0, sourceNames: (episode.sources ?? []).map((source) => source.fileName).slice(0, 4) } };
    setAutopilotRun(initial);
    updateEpisode(episode.id, (current) => ({ ...current, autopilotRun: initial, intake: { ...normalizeEpisodeIntake(current.intake), status: "pending" } }));
    appendActivity(episode.id, { type: "autopilot.run_started", actor: "codex", title: "Autopilot episode run started", summary: `Bounded local run · maximum ${MAX_AUTOPILOT_TURNS} Codex turns.`, authorityImpact: "proposal" });
    try {
      const sources = [];
      for (const source of episode.sources ?? []) {
        const stored = await getEpisodeSource(source.sourceId);
        if (!stored) throw new Error(`Source ${source.fileName} is missing from local storage.`);
        sources.push(sourceForAnalysis(source, stored));
      }
      const response = await fetch("/api/codex/autopilot/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ episodeId: episode.id, episodeName: episode.name, objective: episode.title, context: [episode.context, instruction].filter(Boolean).join("\n\n"), sources, consent: true, baseline: episode.governance?.baseline, projectState: project?.state ?? null, workLease: lease, agentRoute: route }) });
      const result = await response.json();
      if (!response.ok || !result.runId) throw new Error(result.message || "Local Autopilot runtime unavailable.");
      setAutopilotRun((current) => current ? { ...current, status: "working", runId: result.runId } : current);
      updateEpisode(episode.id, (current) => ({ ...current, autopilotRun: { ...(current.autopilotRun ?? initial), status: "working", runId: result.runId } }));
      const eventSource = new EventSource(`/api/codex/runs/${result.runId}/events`);
      autopilotEventSourceRef.current = eventSource;
      eventSource.onmessage = (event) => {
        const normalized = JSON.parse(event.data);
        setAutopilotRun((current) => current ? applyAutopilotEvent(current, normalized) : current);
        updateEpisode(episode.id, (current) => ({ ...current, autopilotRun: applyAutopilotEvent(current.autopilotRun ?? initial, normalized) }));
        if (normalized.type === "draft-plan" && normalized.plan) {
          updateEpisode(episode.id, (current) => ({ ...current, intake: { ...normalizeEpisodeIntake(current.intake), status: "proposed", proposal: normalized.plan }, autopilotRun: { ...(current.autopilotRun ?? initial), draftPlan: normalized.plan, taskStates: { ...(current.autopilotRun?.taskStates ?? {}), "intake-planner": "completed" } } }));
          appendActivity(episode.id, { type: "autopilot.plan_ready", actor: "codex", title: "Autopilot draft plan ready", summary: "Draft run plan is not accepted; specialist analysis may continue.", authorityImpact: "proposal" });
        }
        if (normalized.type === "task" && normalized.status === "complete" && normalized.output) {
          const nodeId = normalized.nodeId ?? normalized.output.nodeId ?? normalized.output.taskId;
          pushAgentNotification({
            title: `${normalized.output.role ?? "Autopilot specialist"} completed`,
            summary: normalized.output.summary ?? "A run output is ready to inspect.",
            nodeId: nodeId === "final-review" ? "work" : nodeId,
          });
          updateEpisode(episode.id, (current) => {
            const output = normalized.output;
            const exists = (current.additions ?? []).some((item) => item.id === `autopilot-${result.runId}-${output.taskId}`);
            const node = current.intake?.proposal?.workNodes?.find((candidate) => candidate.id === nodeId);
            return { ...current, additions: exists ? current.additions : [...(current.additions ?? []), mapAutopilotArtifact(output, { nodeId: node?.id ?? "work", nodeKind: node?.kind, runId: result.runId })], autopilotRun: { ...(current.autopilotRun ?? initial), outputs: [...(current.autopilotRun?.outputs ?? []).filter((item) => item.taskId !== output.taskId), output], taskStates: { ...(current.autopilotRun?.taskStates ?? {}), [output.taskId]: "completed" } } };
          });
          appendActivity(episode.id, { type: "autopilot.task_completed", actor: "codex", title: "Autopilot specialist completed", summary: normalized.label ?? normalized.output.role, authorityImpact: "analysis" });
        }
        if (normalized.type === "completed") {
          updateEpisode(episode.id, (current) => {
            const finalPackage = normalized.finalPackage ?? null;
            const runId = current.autopilotRun?.runId ?? result.runId;
            const finalArtifactId = `autopilot-${runId}-final-review`;
            const additions = finalPackage && !(current.additions ?? []).some((item) => item.id === finalArtifactId)
              ? [...(current.additions ?? []), mapAutopilotArtifact(finalPackage, { nodeId: "work", nodeKind: "evaluation", runId })]
              : current.additions;
            const finalRoute = (current.governance?.agentRoutes ?? []).find((item) => item.leaseId === lease.id) ?? route;
            const returnPacket = finalPackage ? createReturnPacket({ runId, lease, route: finalRoute, packageValue: finalPackage, outputs: normalized.outputs ?? [] }) : null;
            return { ...current, additions, governance: { ...current.governance, workLeases: current.governance.workLeases.map((item) => item.id === lease.id ? { ...item, status: "completed", completedAt: new Date().toISOString() } : item), agentRoutes: current.governance.agentRoutes.map((item) => item.id === finalRoute.id ? { ...item, status: "completed" } : item), returns: returnPacket ? [...(current.governance.returns ?? []), returnPacket] : current.governance.returns }, autopilotRun: { ...(current.autopilotRun ?? initial), status: "complete", draftPlan: normalized.draftPlan ?? current.autopilotRun?.draftPlan, outputs: normalized.outputs ?? current.autopilotRun?.outputs ?? [], finalPackage, finishedAt: new Date().toISOString(), humanReviewStatus: "pending" } };
          });
          appendActivity(episode.id, { type: "autopilot.final_package_ready", actor: "codex", title: "Autopilot final package ready", summary: "Human review required. No stage or disposition changed.", authorityImpact: "human-review" });
          pushAgentNotification({
            title: "Autopilot run completed",
            summary: "The final package is ready for human review.",
            nodeId: "work",
          });
          eventSource.close(); autopilotEventSourceRef.current = null;
        }
        if (["error", "cancelled"].includes(normalized.type)) {
          updateEpisode(episode.id, (current) => ({ ...current, governance: { ...current.governance, workLeases: current.governance.workLeases.map((item) => item.id === lease.id ? { ...item, status: normalized.type === "cancelled" ? "cancelled" : "expired", completedAt: new Date().toISOString() } : item) }, autopilotRun: { ...(current.autopilotRun ?? initial), status: normalized.type, error: normalized.message, finishedAt: new Date().toISOString() } }));
          appendActivity(episode.id, { type: normalized.type === "cancelled" ? "autopilot.run_cancelled" : "autopilot.run_failed", actor: "codex", title: normalized.type === "cancelled" ? "Autopilot run cancelled" : "Autopilot run failed", summary: normalized.message ?? "No further work was completed.", authorityImpact: "analysis" });
          eventSource.close(); autopilotEventSourceRef.current = null;
        }
      };
      eventSource.onerror = () => {
        if (eventSource.readyState === EventSource.CLOSED || autopilotEventSourceRef.current !== eventSource) return;
        updateEpisode(episode.id, (current) => ({ ...current, governance: { ...current.governance, workLeases: current.governance.workLeases.map((item) => item.id === lease.id ? { ...item, status: "expired", completedAt: new Date().toISOString() } : item), agentRoutes: current.governance.agentRoutes.map((item) => item.leaseId === lease.id ? { ...item, status: "expired" } : item) }, autopilotRun: { ...(current.autopilotRun ?? initial), status: "error", error: "Local Autopilot runtime unavailable." } }));
        eventSource.close(); autopilotEventSourceRef.current = null;
      };
    } catch (error) {
      const failedRun = {
        ...initial,
        status: "error",
        error: error.message,
        finishedAt: new Date().toISOString(),
      };
      setAutopilotRun(failedRun);
      updateEpisode(episode.id, (current) => ({ ...current, governance: { ...current.governance, workLeases: current.governance.workLeases.map((item) => item.id === lease.id ? { ...item, status: "expired", completedAt: new Date().toISOString() } : item), agentRoutes: current.governance.agentRoutes.map((item) => item.leaseId === lease.id ? { ...item, status: "expired" } : item) }, autopilotRun: { ...(current.autopilotRun ?? failedRun), ...failedRun } }));
      appendActivity(episode.id, { type: "autopilot.run_failed", actor: "system", title: "Autopilot run failed", summary: error.message, authorityImpact: "analysis" });
    }
  }

  function cancelAutopilotEpisode() {
    if (!autopilotRun?.runId) return;
    void fetch(`/api/codex/runs/${autopilotRun.runId}`, { method: "DELETE" });
    autopilotEventSourceRef.current?.close();
    autopilotEventSourceRef.current = null;
    setAutopilotRun((current) => current ? { ...current, status: "cancelled" } : current);
    if (activeEpisode) updateEpisode(activeEpisode.id, (episode) => ({ ...episode, governance: { ...episode.governance, workLeases: episode.governance.workLeases.map((lease) => lease.id === episode.autopilotRun?.workLeaseId ? { ...lease, status: "cancelled", completedAt: new Date().toISOString() } : lease), agentRoutes: episode.governance.agentRoutes.map((route) => route.leaseId === episode.autopilotRun?.workLeaseId ? { ...route, status: "cancelled" } : route) }, autopilotRun: { ...(episode.autopilotRun ?? {}), status: "cancelled", finishedAt: new Date().toISOString() } }));
  }

  function promoteAutopilotPackage() {
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

  function setAutopilotHumanStatus(status) {
    if (!activeEpisode) return;
    updateEpisode(activeEpisode.id, (episode) => ({ ...episode, autopilotRun: { ...episode.autopilotRun, humanReviewStatus: status } }));
    appendActivity(activeEpisode.id, { type: `autopilot.package_${status}`, actor: "human", title: `Autopilot package ${status}`, summary: "Human review action recorded; stage and disposition unchanged.", authorityImpact: "human-review" });
  }

  async function runNativeCodexIntake(episode, revisionInstruction = "") {
    if (!episode?.id || codexRunningEpisodeId) return;
    const isRevision = Boolean(revisionInstruction.trim() || episode.runtime?.codex?.intakeThreadId);
    appendActivity(episode.id, {
      type: isRevision ? "codex.intake.revision_started" : "codex.intake.started",
      actor: "codex",
      title: isRevision ? "Codex revision started" : "Codex intake started",
      summary: isRevision ? "Revising the proposed Episode structure." : "Analyzing the Episode in read-only mode.",
      authorityImpact: "proposal",
    });
    setCodexRunningEpisodeId(episode.id);
    setCodexRun({ episodeId: episode.id, status: "working", currentPhase: "Starting analysis", events: [], todos: [], runId: null, startedAt: new Date().toISOString() });
    updateEpisode(episode.id, (current) => ({
      ...current,
      intake: { ...normalizeEpisodeIntake(current.intake), status: "pending" },
      runtime: { codex: { ...(current.runtime?.codex ?? {}), lastError: null } },
    }));
    try {
      const sources = [];
      for (const source of episode.sources ?? []) {
        const stored = await getEpisodeSource(source.sourceId);
        if (!stored) throw new Error(`Source ${source.fileName} is missing from local storage.`);
        sources.push(sourceForAnalysis(source, stored));
      }
      if (sources.length > 0) {
        appendActivity(episode.id, {
          type: "source.analysis_consented",
          actor: "human",
          title: "Source-informed Codex analysis consented",
          summary: `${sources.length} local source${sources.length === 1 ? "" : "s"} will be analyzed in read-only mode.`,
          metadata: { sourceIds: sources.map((source) => source.sourceId) },
          authorityImpact: "proposal",
        });
      }
      const response = await fetch("/api/codex/episode-intake/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          episodeId: episode.id,
          episodeName: episode.name,
          objective: episode.title,
          context: episode.context,
          sources,
          sourceConsent: true,
          sourceConsentRequired: sources.length > 0 || Boolean(episode.context?.trim()),
          threadId: episode.runtime?.codex?.intakeThreadId ?? null,
          revisionInstruction,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.runId) throw new Error(result.message || "Local Codex runtime unavailable.");
      setCodexRun((current) => ({ ...current, runId: result.runId }));
      const eventSource = new EventSource(`/api/codex/runs/${result.runId}/events`);
      codexEventSourceRef.current = eventSource;
      eventSource.onmessage = (event) => {
        const normalized = JSON.parse(event.data);
        setCodexRun((current) => {
          if (!current || current.episodeId !== episode.id) return current;
          const next = { ...current, events: [...(current.events ?? []), normalized].slice(-50) };
          if (normalized.type === "phase") next.currentPhase = normalized.label;
          if (normalized.type === "todo") next.todos = normalized.items ?? [];
          if (normalized.type === "activity") next.currentPhase = normalized.label;
          if (normalized.type === "completed") next.status = "complete";
          if (normalized.type === "error") next.status = "error";
          if (normalized.type === "cancelled") next.status = "cancelled";
          return next;
        });
        if (normalized.type === "completed" && normalized.proposal) {
          updateEpisode(episode.id, (current) => ({
            ...current,
            intake: { ...normalizeEpisodeIntake(current.intake), status: "proposed", proposal: normalized.proposal },
            runtime: { codex: { intakeThreadId: normalized.threadId ?? current.runtime?.codex?.intakeThreadId ?? null, lastRunAt: new Date().toISOString(), lastError: null } },
          }));
          appendActivity(episode.id, {
            type: isRevision ? "codex.intake.completed" : "codex.intake.completed",
            actor: "codex",
            title: "Codex intake completed",
            summary: "Structured proposal returned for human review.",
            metadata: { threadId: normalized.threadId ?? null },
            authorityImpact: "proposal",
          });
          if (sources.length > 0) appendActivity(episode.id, {
            type: "source.proposal_completed",
            actor: "codex",
            title: "Source-informed proposal completed",
            summary: `Proposal returned with source citations for ${sources.length} source${sources.length === 1 ? "" : "s"}.`,
            metadata: { sourceIds: sources.map((source) => source.sourceId) },
            authorityImpact: "proposal",
          });
          appendActivity(episode.id, {
            type: isRevision ? "proposal.revised" : "proposal.created",
            actor: "codex",
            title: isRevision ? "Episode structure revised" : "Episode structure proposed",
            summary: `${normalized.proposal.workNodes?.length ?? 0} work nodes · ${normalized.proposal.humanGates?.length ?? 0} human checkpoints`,
            metadata: {
              afterWorkNodeCount: normalized.proposal.workNodes?.length ?? 0,
              afterHumanGateCount: normalized.proposal.humanGates?.length ?? 0,
              previousProposalId: isRevision ? episode.intake?.proposal?.id ?? null : null,
            },
            authorityImpact: "proposal",
          });
          if (activeEpisodeId === episode.id) setIntakePanelOpen(true);
          eventSource.close();
          codexEventSourceRef.current = null;
          setCodexRunningEpisodeId(null);
        }
        if (["error", "cancelled"].includes(normalized.type)) {
          appendActivity(episode.id, {
            type: "codex.intake.failed",
            actor: "codex",
            title: "Codex intake failed",
            summary: normalized.message || "No proposal changes were applied.",
          });
          updateEpisode(episode.id, (current) => ({ ...current, runtime: { codex: { ...(current.runtime?.codex ?? {}), lastError: normalized.message } } }));
          eventSource.close();
          codexEventSourceRef.current = null;
          setCodexRunningEpisodeId(null);
        }
      };
      eventSource.onerror = () => {
        if (eventSource.readyState === EventSource.CLOSED || codexEventSourceRef.current !== eventSource) return;
        setCodexRun((current) => current ? { ...current, status: "error", error: "Local Codex runtime unavailable." } : current);
        eventSource.close();
        codexEventSourceRef.current = null;
        setCodexRunningEpisodeId(null);
      };
    } catch (error) {
      updateEpisode(episode.id, (current) => ({ ...current, runtime: { codex: { ...(current.runtime?.codex ?? {}), lastError: error.message || "Local Codex runtime unavailable." } } }));
      setCodexRun((current) => ({ ...current, status: "error", error: error.message || "Local Codex runtime unavailable." }));
      if (activeEpisodeId === episode.id) setIntakePanelOpen(true);
      setCodexRunningEpisodeId(null);
    }
  }

  function cancelNativeCodexIntake() {
    if (!codexRun?.runId) return;
    void fetch(`/api/codex/runs/${codexRun.runId}`, { method: "DELETE" });
    codexEventSourceRef.current?.close();
    codexEventSourceRef.current = null;
    setCodexRun((current) => current ? { ...current, status: "cancelled", error: "Analysis cancelled. No proposal changes were applied." } : current);
    setCodexRunningEpisodeId(null);
  }

  function createProject({ name, description }) {
    const project = {
      id: `project-${crypto.randomUUID()}`,
      name,
      description,
      createdAt: new Date().toISOString(),
      archived: false,
      ownerName: "Owner",
      state: { id: `state-${crypto.randomUUID()}`, summary: "Project created. Owner must record the current authoritative state before authorizing work.", sourceIds: [], authority: AUTHORITY_STATES.AUTHORITATIVE, createdAt: new Date().toISOString() },
      stateHistory: [],
    };
    setProjects((current) => [...current, project]);
    setExpandedProjects((current) => ({ ...current, [project.id]: true }));
    setNewEpisodeProjectId(createOpen ? project.id : null);
    setProjectModalOpen(false);
  }

  function saveProject({ name, description, projectId }) {
    if (!projectId) {
      createProject({ name, description });
      return;
    }
    setProjects((current) => current.map((project) => project.id === projectId ? { ...project, name, description } : project));
    setEditingProject(null);
    setProjectModalOpen(false);
  }

  function removeProject(projectId) {
    const project = projects.find((item) => item.id === projectId);
    if (!project || !window.confirm(`Remove project “${project.name}”? Its Episodes will move to Unassigned.`)) return;
    setProjects((current) => current.filter((item) => item.id !== projectId));
    setEpisodes((current) => current.map((episode) => episode.projectId === projectId ? { ...episode, projectId: null } : episode));
  }

  function moveEpisode(episodeId, projectId) {
    updateEpisode(episodeId, (episode) => ({ ...episode, projectId: projectId || null }));
  }

  function renameEpisode(name) {
    if (!renamingEpisode) return;
    updateEpisode(renamingEpisode.id, (episode) => ({ ...episode, name }));
    setRenamingEpisode(null);
  }

  function archiveEpisode(episodeId) {
    updateEpisode(episodeId, (episode) => ({ ...episode, status: "archived" }));
    setOpenEpisodeMenuId(null);
  }

  function removeEpisode(episodeId) {
    const episode = episodes.find((item) => item.id === episodeId);
    if (!episode || !window.confirm(`Remove Episode “${episode.name}”?`)) return;
    void deleteEpisodeSources(episodeId);
    setEpisodes((current) => current.filter((item) => item.id !== episodeId));
    if (activeEpisodeId === episodeId) setActiveEpisodeId(episodes.find((item) => item.id !== episodeId)?.id ?? null);
    setOpenEpisodeMenuId(null);
  }

  /* ---------------------------------------------------------------------- */
  /* STAGE FLOW                                                             */
  /* ---------------------------------------------------------------------- */

  function advanceStage() {
    if (
      !activeEpisode ||
      activeEpisode.currentStage >=
        2
    ) {
      return;
    }

    const nextStage =
      activeEpisode.currentStage +
      1;

    updateActiveEpisode(
      (episode) => ({
        ...episode,

        currentStage:
          nextStage,
      })
    );

    appendActivity(activeEpisode.id, {
      type: "stage.advanced",
      actor: "human",
      title: "Human advanced Episode stage",
      summary: `${EPISODE_STAGES[activeEpisode.currentStage]?.name} → ${EPISODE_STAGES[nextStage]?.name}`,
      authorityImpact: "accepted",
    });

    setViewStage(
      nextStage
    );

    setSelectedNodeId(
      null
    );

    setActiveThreadId(
      null
    );

    setDrawerOpen(
      false
    );

    setOrchestrationNodeId(null);
    setOrchestrationExpanded(false);
    setOrchestrationMinimized(false);
    setOrchestrationDetailId(null);
  }

  function recordDisposition(
    disposition
  ) {
    updateActiveEpisode(
      (episode) => ({
        ...episode,

        disposition,

        status:
          "resolved",
      })
    );
    appendActivity(activeEpisode.id, {
      type: "human.disposition_recorded",
      actor: "human",
      title: "Human disposition recorded",
      summary: disposition,
      authorityImpact: "accepted",
    });
  }

  /* ---------------------------------------------------------------------- */
  /* NODE DRAG                                                              */
  /* ---------------------------------------------------------------------- */

  function handleNodeDragStop(
    _event,
    node
  ) {
    updateActiveEpisode(
      (episode) => ({
        ...episode,

        layouts: {
          ...(episode.layouts ??
            {}),

          [viewStage]: {
            ...(
              episode.layouts?.[
                viewStage
              ] ?? {}
            ),

            [node.id]:
              node.position,
          },
        },
      })
    );
  }

  /* ---------------------------------------------------------------------- */
  /* CREATE THREAD                                                          */
  /* ---------------------------------------------------------------------- */

  function createThread(
    parentNodeId,
    question
  ) {
    if (
      !activeEpisode ||
      !parentNodeId ||
      !question.trim()
    ) {
      return null;
    }

    const threadId =
      `thread-${crypto.randomUUID()}`;

    const position =
      makeAdditionPosition(
        activeEpisode,
        viewStage,
        parentNodeId
      );

    const humanMessage =
      createMessage(
        "human",
        question.trim()
      );

    updateActiveEpisode(
      (episode) => ({
        ...episode,

        additions: [
          ...(episode.additions ??
            []),

          {
            id:
              threadId,

            kind:
              "thread",

            stageIndex:
              viewStage,

            parentNodeId,

            messages: [
              humanMessage,
            ],

            status:
              "pending",

            position,
          },
        ],
      })
    );

    setActiveThreadId(
      threadId
    );

    return threadId;
  }

  /* ---------------------------------------------------------------------- */
  /* FOLLOW UP                                                              */
  /* ---------------------------------------------------------------------- */

  function addThreadFollowUp(
    threadId,
    content
  ) {
    updateActiveEpisode(
      (episode) => ({
        ...episode,

        additions:
          (
            episode.additions ??
            []
          ).map(
            (item) => {
              if (
                item.id !==
                  threadId ||
                item.kind !==
                  "thread"
              ) {
                return item;
              }

              if (
                item.status ===
                "pending"
              ) {
                return item;
              }

              return {
                ...item,

                messages: [
                  ...(item.messages ??
                    []),

                  createMessage(
                    "human",
                    content
                  ),
                ],

                status:
                  "pending",
              };
            }
          ),
      })
    );
  }

  function resolveNodeConversation(episodeId, threadId, content, { codexThreadId = null, status = "complete" } = {}) {
    updateEpisode(episodeId, (episode) => ({
      ...episode,
      additions: (episode.additions ?? []).map((item) => item.id === threadId && item.kind === "thread"
        ? { ...item, messages: [...(item.messages ?? []), createMessage("agent", content)], status, codexThreadId: codexThreadId ?? item.codexThreadId ?? null }
        : item),
    }));
  }

  async function runNodeConversation({ threadId, nodeId, question, messages, codexThreadId = null }) {
    if (!activeEpisode || !threadId || !nodeId) return;
    const episodeId = activeEpisode.id;
    const node = getOrchestrationNodeRecord(nodeId);
    const details = getNodeDetails(nodeId);
    const sourceIds = [...new Set([
      ...(details?.sourceReferences?.map((source) => source.sourceId) ?? []),
      ...(activeEpisode.nodeSourceIds?.[nodeId] ?? []),
    ])];
    const sourceRecords = [];
    try {
      for (const source of activeEpisode.sources ?? []) {
        if (sourceIds.length > 0 && !sourceIds.includes(source.sourceId)) continue;
        const stored = await getEpisodeSource(source.sourceId);
        if (!stored) throw new Error(`Source ${source.fileName} is missing from local storage.`);
        sourceRecords.push(sourceForAnalysis(source, stored));
      }
      const response = await fetch("/api/codex/node-conversation/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          episodeId: activeEpisode.id,
          episodeName: activeEpisode.name,
          objective: activeEpisode.title,
          context: activeEpisode.context,
          nodeId,
          node: { id: node.id, kind: node.data?.workflowKind ?? node.data?.label, title: node.data?.title, body: node.data?.body, sourceIds },
          question,
          messages,
          codexThreadId,
          sources: sourceRecords,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.runId) throw new Error(result.message || "Local Codex runtime unavailable.");
      const eventSource = new EventSource(`/api/codex/runs/${result.runId}/events`);
      eventSource.onmessage = (event) => {
        const normalized = JSON.parse(event.data);
        if (normalized.type === "completed") {
          resolveNodeConversation(episodeId, threadId, normalized.response, { codexThreadId: normalized.threadId });
          appendActivity(episodeId, { type: "node.agent_responded", actor: "codex", title: "Codex responded to node question", summary: compactArtifactSummary(normalized.response), relatedNodeId: nodeId, authorityImpact: "analysis" });
          eventSource.close();
        }
        if (["error", "cancelled"].includes(normalized.type)) {
          resolveNodeConversation(episodeId, threadId, normalized.message ?? "Codex could not complete this node response.", { status: normalized.type });
          appendActivity(episodeId, { type: "node.agent_response_failed", actor: "system", title: "Codex node response unavailable", summary: normalized.message ?? "No response was returned.", relatedNodeId: nodeId, authorityImpact: "analysis" });
          eventSource.close();
        }
      };
      eventSource.onerror = () => {
        if (eventSource.readyState === EventSource.CLOSED) return;
        resolveNodeConversation(episodeId, threadId, "The local Codex connection ended before a response was returned.", { status: "error" });
        eventSource.close();
      };
    } catch (error) {
      resolveNodeConversation(episodeId, threadId, error.message || "Codex could not start this node response.", { status: "error" });
      appendActivity(episodeId, { type: "node.agent_response_failed", actor: "system", title: "Codex node response unavailable", summary: error.message, relatedNodeId: nodeId, authorityImpact: "analysis" });
    }
  }

  function handleDrawerSend(
    content
  ) {
    if (
      !selectedNodeId
    ) {
      return;
    }

    const nodeId = activeThread?.parentNodeId ?? selectedNodeId;
    appendActivity(activeEpisode.id, {
      type: "node.question_asked",
      actor: "human",
      title: "Human asked node question",
      summary: compactArtifactSummary(content),
      relatedNodeId: nodeId,
      authorityImpact: "human-review",
    });

    if (activeThread) {
      addThreadFollowUp(
        activeThread.id,
        content
      );

      void runNodeConversation({
        threadId: activeThread.id,
        nodeId,
        question: content,
        messages: [...(activeThread.messages ?? []), { role: "human", content }],
        codexThreadId: activeThread.codexThreadId ?? null,
      });

      return;
    }

    const threadId = createThread(
      selectedNodeId,
      content
    );
    void runNodeConversation({
      threadId,
      nodeId,
      question: content,
      messages: [{ role: "human", content }],
    });
  }

  /* ---------------------------------------------------------------------- */
  /* BUILD FLOW NODES                                                       */
  /* ---------------------------------------------------------------------- */

  function getVisibleStageNodes() {
    if (!activeEpisode || viewStage !== 0) {
      return activeStageTemplate?.nodes ?? [];
    }

    const intake = activeEpisode.intake;
    if (intake?.status === "pending") {
      return activeStageTemplate.nodes.filter(
        (node) => node.id === "work" || node.id === "gate"
      );
    }

    if (intake?.status === "proposed" && intake.proposal) {
      const proposedGates = intake.proposal.humanGates ?? [];
      return [
        activeStageTemplate.nodes.find((node) => node.id === "work"),
        ...intake.proposal.workNodes.map((node, index) => ({
          id: node.id,
          type: node.kind,
          kind: node.kind,
          title: node.title,
          body: node.description,
          meta: "Proposed · " + (node.rationale ?? "Structure proposal"),
          position: { x: 120 + (index % 3) * 330, y: 300 + Math.floor(index / 3) * 240 },
          proposed: true,
        })),
        ...(proposedGates.length > 0
          ? proposedGates.map((gate, index) => ({
              ...gate,
              id: gate.id,
              type: "Human checkpoint",
              kind: "gate",
              title: gate.title,
              meta: `Proposed · after ${(gate.afterNodeIds ?? []).join(", ") || "work nodes"}`,
              dependsOn: gate.afterNodeIds ?? [],
              position: { x: 120 + (index % 3) * 330, y: 620 + Math.floor(index / 3) * 220 },
              proposed: true,
            }))
          : [activeStageTemplate.nodes.find((node) => node.id === "gate")]),
      ].filter(Boolean);
    }

    if (intake?.status === "accepted" && activeEpisode.workflow?.nodes?.length) {
      return [
        activeStageTemplate.nodes.find((node) => node.id === "work"),
        ...activeEpisode.workflow.nodes,
        ...(activeEpisode.workflow.gates?.length
          ? activeEpisode.workflow.gates.map((gate) => ({
              ...gate,
              type: "Human checkpoint",
              kind: "gate",
              title: gate.title,
              meta: `After ${(gate.afterNodeIds ?? []).join(", ") || "work nodes"}`,
            }))
          : [activeStageTemplate.nodes.find((node) => node.id === "gate")]),
      ].filter(Boolean);
    }

    return activeStageTemplate.nodes;
  }

  function getWorkflowCanvasEdges(visibleStageNodes = getVisibleStageNodes()) {
    if (viewStage !== 0) {
      return activeStageTemplate?.edges ?? [];
    }

    const intake = activeEpisode?.intake;
    if (intake?.status === "accepted" && activeEpisode.workflow?.edges?.length) {
      return activeEpisode.workflow.edges;
    }

    const workflowNodes = visibleStageNodes.filter((node) => node.id !== "work" && node.kind !== "gate");
    const dependencies = workflowNodes.flatMap((node) =>
      node.dependsOn?.length
        ? node.dependsOn.map((dependency) => [dependency, node.id])
        : [["work", node.id]]
    );
    const terminalNodes = workflowNodes.filter(
      (node) => !workflowNodes.some((candidate) => candidate.dependsOn?.includes(node.id))
    );
    const gates = visibleStageNodes.filter((node) => node.kind === "gate");
    const gateEdges = gates.flatMap((gate) =>
      gate.afterNodeIds?.length
        ? gate.afterNodeIds.map((nodeId) => [nodeId, gate.id])
        : (terminalNodes.length > 0 ? terminalNodes : [{ id: "work" }]).map((node) => [node.id, gate.id])
    );

    return [...dependencies, ...gateEdges];
  }

  function getWorkflowCanvasTraceEdges(visibleStageNodes = getVisibleStageNodes()) {
    const durableEdges = (activeEpisode?.additions ?? [])
      .filter((item) => item.stageIndex === viewStage && item.parentNodeId && isDurableArtifact(item) && (showGeneratedArtifacts || !isGeneratedRunArtifact(item)))
      .map((item) => [item.parentNodeId, item.id]);
    return [...getWorkflowCanvasEdges(visibleStageNodes), ...durableEdges];
  }

  function organizeVisibleWorkflow() {
    if (!activeEpisode || viewStage !== 0 || !["accepted", "proposed"].includes(activeEpisode.intake?.status)) {
      return;
    }

    const visibleStageNodes = getVisibleStageNodes();
    const positions = layoutWorkflowNodes(
      visibleStageNodes,
      getWorkflowCanvasEdges(visibleStageNodes)
    );
    const reviewArtifactPositions = layoutGeneratedReviewArtifacts(activeEpisode, viewStage, positions);
    const savedPositions = Object.fromEntries([...positions, ...reviewArtifactPositions]);

    updateActiveEpisode((episode) => ({
      ...episode,
      layouts: {
        ...(episode.layouts ?? {}),
        [viewStage]: {
          ...(episode.layouts?.[viewStage] ?? {}),
          ...savedPositions,
        },
      },
    }));
  }

  function buildFlowNodes() {
    if (
      !activeEpisode ||
      !activeStageTemplate
    ) {
      return [];
    }

    const visibleStageNodes = getVisibleStageNodes();
    const workflowMode = viewStage === 0 && ["accepted", "proposed"].includes(activeEpisode.intake?.status);
    const savedWorkflowPositions = activeEpisode.layouts?.[viewStage] ?? {};
    const hasSavedWorkflowPositions = visibleStageNodes.some((node) => savedWorkflowPositions[node.id]);
    const automaticPositions = workflowMode && !hasSavedWorkflowPositions
      ? layoutWorkflowNodes(visibleStageNodes, getWorkflowCanvasEdges(visibleStageNodes))
      : new Map();
    const basePositions = new Map(visibleStageNodes.map((node) => [
      node.id,
      savedWorkflowPositions[node.id] ?? automaticPositions.get(node.id) ?? node.position,
    ]));
    const reviewArtifactPositions = workflowMode
      ? layoutGeneratedReviewArtifacts(activeEpisode, viewStage, basePositions)
      : new Map();
    const trace = getTraceGraph(traceNodeId, getWorkflowCanvasTraceEdges(visibleStageNodes));
    const runArtifactCounts = new Map();
    (activeEpisode.additions ?? []).filter((item) => item.stageIndex === viewStage && item.parentNodeId && isGeneratedRunArtifact(item)).forEach((item) => {
      runArtifactCounts.set(item.parentNodeId, (runArtifactCounts.get(item.parentNodeId) ?? 0) + 1);
    });
    const baseNodes =
      visibleStageNodes.map(
        (node) => {
          let title =
            node.title;

          let body =
            node.body;

          let contextSummary = null;

          if (
            viewStage ===
              0 &&
            node.id ===
              "work"
          ) {
            title =
              activeEpisode.title;

            body =
              "Bounded episode currently under investigation.";
          }

          if (
            viewStage ===
              0 &&
            node.id ===
              "context"
          ) {
            title = "Known context";

            body =
              "Orientation summary for the episode context.";
            contextSummary = getContextSummary(activeEpisode);
          }

          const position =
            savedWorkflowPositions[node.id] ??
            automaticPositions.get(node.id) ??
            node.position;

          const stats =
            getThreadStats(
              activeEpisode,
              viewStage,
              node.id
            );

          const orchestration =
            orchestrationPreviews[node.id];

          let type =
            "card";

          if (
            node.kind ===
            "gate"
          ) {
            type =
              "gate";
          }

          if (
            node.kind ===
            "human"
          ) {
            type =
              "human";
          }

          return {
            id:
              node.id,

            type,

            position,

            data: {
              label:
                node.type,

              secondary:
                false,

              proposed:
                node.proposed ?? false,

              workflowKind:
                node.kind,

              sourceIds:
                node.sourceIds ?? [],

              compactNode:
                Boolean(
                  node.proposed ||
                  activeEpisode.workflow?.nodes?.some(
                    (workflowNode) => workflowNode.id === node.id
                  )
                ),

              selected:
                selectedNodeId === node.id,

              autopilotStatus: activeEpisode.autopilotRun?.taskStates?.[`specialist-${node.id}`] ?? null,

              autopilotActive: activeEpisode.autopilotRun?.activeNodeId === node.id,

              runArtifactCount: runArtifactCounts.get(node.id) ?? 0,

              traceActive: trace.nodeIds.has(node.id),

              traceDimmed: Boolean(traceNodeId && !trace.nodeIds.has(node.id)),

              onTrace: () => setTraceNodeId(traceNodeId === node.id ? null : node.id),

              isContext:
                node.id === "context",

              contextSummary,

              onViewContext: () =>
                openContextDrawer(),

              onViewDetails: () =>
                openDetailsForNode(node.id),

              orchestrationEligible:
                isOrchestrationEligibleNode({
                  id: node.id,
                  kind: node.kind,
                  data: {
                    workflowKind: node.kind,
                    proposed: node.proposed === true,
                  },
                }),

              orchestrationSummary:
                getOrchestrationSummary(
                  node.id,
                  orchestration?.plan,
                  orchestration?.executionState
                ),

              orchestrationApproved:
                orchestration?.state ===
                "preview-approved",

                onOpenOrchestration: () =>
                  openNodeOrchestration(
                    node.id
                  ),

              title,

              body,

              meta:
                node.meta,

              checkpointDependencies:
                node.kind === "gate"
                  ? node.afterNodeIds ?? node.dependsOn ?? []
                  : [],

              threadMessageCount:
                stats.messageCount,

              threadCount:
                stats.threads.length,

              threadPending:
                stats.pending,

              onOpenThread: () =>
                openDrawerForNode(
                  node.id
                ),

              completed:
                viewStage <
                activeEpisode.currentStage,

              canContinue:
                viewStage ===
                  activeEpisode.currentStage &&
                activeEpisode.currentStage <
                  2,

              onContinue:
                advanceStage,

              disposition:
                activeEpisode.disposition,

              onDisposition:
                recordDisposition,
            },
          };
        }
      );

    const additions =
      (
        activeEpisode.additions ??
        []
      )
        .filter(
          (item) =>
            item.stageIndex ===
            viewStage &&
            isDurableArtifact(item) &&
            (showGeneratedArtifacts || !isGeneratedRunArtifact(item))
        )
        .map((item) => {
          const position =
            savedWorkflowPositions[item.id] ??
            reviewArtifactPositions.get(item.id) ??
            automaticPositions.get(item.id) ??
            item.position ??
            makeAdditionPosition(
              activeEpisode,
              viewStage,
              item.parentNodeId
            );

          const stats =
            getThreadStats(
              activeEpisode,
              viewStage,
              item.id
            );

          return {
            id:
              item.id,

            type:
              "card",

            position,

              data: {
              label:
                item.label,

              secondary:
                true,

              title:
                item.title,

                body:
                item.body,

                durableArtifact: true,

                compactNode: true,

              meta:
                item.meta,

              threadMessageCount:
                stats.messageCount,

              threadCount:
                stats.threads.length,

              threadPending:
                stats.pending,

              traceActive: trace.nodeIds.has(item.id),

              traceDimmed: Boolean(traceNodeId && !trace.nodeIds.has(item.id)),

              selected: selectedNodeId === item.id,

              onTrace: () => setTraceNodeId(traceNodeId === item.id ? null : item.id),

              onOpenThread: () =>
                openDrawerForNode(
                  item.id
                ),

              onViewDetails: () =>
                openDetailsForNode(item.id),
            },
          };
        });

    const orchestrationPlan =
      orchestrationPreviews[orchestrationNodeId]?.plan ??
      getLocalOrchestrationPlan(orchestrationNodeId);
    const orchestrationSourceNode = getOrchestrationSourceNode(orchestrationNodeId);
    const orchestrationEligible = isOrchestrationEligibleNode(orchestrationSourceNode);
    const orchestrationExecutionState =
      orchestrationRun?.nodeId === orchestrationNodeId
        ? orchestrationRun.taskStates
        : orchestrationPreviews[orchestrationNodeId]?.executionState ?? {};

    const orchestrationNodes =
      orchestrationExpanded &&
      orchestrationNodeId &&
      orchestrationEligible &&
      isValidOrchestrationPlan(orchestrationPlan)
        ? buildOrchestrationPreviewNodes(
            orchestrationNodeId,
            getNodePosition(
              activeEpisode,
              viewStage,
              orchestrationNodeId
            ),
            orchestrationPlan,
            orchestrationExecutionState,
            orchestrationRun?.status ?? orchestrationPreviews[orchestrationNodeId]?.runStatus ?? null,
            savedWorkflowPositions,
          )
        : [];

    const intakeNodes = activeEpisode.intake?.status === "pending"
      ? [{
          id: "episode-intake",
          type: "intake",
          position: { x: 420, y: 300 },
          data: {
            onOpen: () => setIntakePanelOpen(true),
          },
        }]
      : [];

    const activeAutopilotNodeId = activeEpisode.autopilotRun?.activeNodeId;
    const activeAutopilotTaskId = activeEpisode.autopilotRun?.activeTaskId;
    const activeAutopilotTask = activeAutopilotTaskId && activeEpisode.autopilotRun?.taskStates?.[activeAutopilotTaskId] === "working";
    const autopilotAgentNodes = activeAutopilotNodeId && activeAutopilotTask
      ? [{
          id: `autopilot-agent-${activeAutopilotTaskId}`,
          type: "orchestration",
          position: { x: getNodePosition(activeEpisode, viewStage, activeAutopilotNodeId).x + 340, y: getNodePosition(activeEpisode, viewStage, activeAutopilotNodeId).y - 30 },
          data: {
            orchestrationPreview: true,
            temporaryAgent: true,
            detailId: "first-mate",
            label: "Live specialist",
            title: activeAutopilotTaskId,
            body: "Read-only analysis in progress",
            status: "working",
            statusLabel: "Reviewing source context",
          },
        }]
      : [];

    return [
      ...baseNodes,
      ...intakeNodes,
      ...additions,
      ...orchestrationNodes,
      ...autopilotAgentNodes,
    ];
  }

  /* ---------------------------------------------------------------------- */
  /* BUILD EDGES                                                            */
  /* ---------------------------------------------------------------------- */

  function buildFlowEdges() {
    if (
      !activeEpisode ||
      !activeStageTemplate
    ) {
      return [];
    }

    let visibleStageEdges = activeStageTemplate.edges;
    const visibleStageNodes = getVisibleStageNodes();
    const intake = activeEpisode.intake;

    if (viewStage === 0 && intake?.status === "pending") {
      visibleStageEdges = [["work", "gate"]];
    } else if (viewStage === 0 && intake?.status === "accepted" && activeEpisode.workflow?.edges?.length) {
      visibleStageEdges = activeEpisode.workflow.edges;
    } else if (viewStage === 0 && intake?.status === "proposed" && intake.proposal) {
      const proposedNodes = intake.proposal.workNodes;
      const proposedGates = intake.proposal.humanGates ?? [];
      const dependencies = proposedNodes.flatMap((node) =>
        node.dependsOn?.length
          ? node.dependsOn.map((dependency) => [dependency, node.id])
          : [["work", node.id]]
      );
      const terminalNodes = proposedNodes.filter(
        (node) => !proposedNodes.some((candidate) => candidate.dependsOn?.includes(node.id))
      );
      visibleStageEdges = [
        ...dependencies,
        ...(proposedGates.length > 0
          ? proposedGates.flatMap((gate) =>
              gate.afterNodeIds.length
                ? gate.afterNodeIds.map((nodeId) => [nodeId, gate.id])
                : terminalNodes.map((node) => [node.id, gate.id])
            )
          : terminalNodes.map((node) => [node.id, "gate"])),
      ];
    }

    const stageEdges = Array.from(
      new Map(visibleStageEdges.map((edge) => [edge.join("→"), edge])).values()
    );
    const trace = getTraceGraph(traceNodeId, getWorkflowCanvasTraceEdges(visibleStageNodes));

    const baseEdges =
      stageEdges.map(
        (
          [
            source,
            target,
          ],
          index
        ) => ({
          id:
            `base-${viewStage}-${index}`,

          source,

          target,

          sourceHandle:
            "flow-source",

          targetHandle:
            "flow-target",

          type:
            "smoothstep",

          className: [
            intake?.status === "proposed" && viewStage === 0 ? "proposed-edge" : "dependency-edge",
            visibleStageNodes.some((node) => node.kind === "gate" && node.id === target) ? "checkpoint-edge" : "",
            activeEpisode.autopilotRun?.status === "working" && target !== "work"
              ? (activeEpisode.autopilotRun?.taskStates?.[`specialist-${source}`] === "completed" ? "autopilot-dependency-active" : "autopilot-dependency-waiting")
              : "",
            traceNodeId
              ? trace.edgeKeys.has(getWorkflowEdgeKey(source, target))
                ? "trace-active-edge"
                : "trace-dimmed-edge"
              : "",
          ].filter(Boolean).join(" "),
        })
      );

    const additionEdges =
      (
        activeEpisode.additions ??
        []
      )
        .filter(
          (item) =>
            item.stageIndex ===
              viewStage &&
            item.parentNodeId &&
            isDurableArtifact(item) &&
            (showGeneratedArtifacts || !isGeneratedRunArtifact(item))
        )
        .map((item) => ({
          id:
            `addition-${item.id}`,

          source:
            item.parentNodeId,

          target:
            item.id,

          sourceHandle:
            "branch-source",

          targetHandle:
            "branch-target",

          type:
            "smoothstep",

          className: [
            "branch-edge",
            traceNodeId
              ? trace.edgeKeys.has(getWorkflowEdgeKey(item.parentNodeId, item.id))
                ? "trace-active-edge"
                : "trace-dimmed-edge"
              : "",
          ].filter(Boolean).join(" "),
        }));

    const orchestrationPlan =
      orchestrationPreviews[orchestrationNodeId]?.plan ??
      getLocalOrchestrationPlan(orchestrationNodeId);
    const orchestrationSourceNode = getOrchestrationSourceNode(orchestrationNodeId);
    const orchestrationEligible = isOrchestrationEligibleNode(orchestrationSourceNode);

    const orchestrationEdges =
      orchestrationExpanded &&
      orchestrationNodeId &&
      orchestrationEligible &&
      isValidOrchestrationPlan(orchestrationPlan)
        ? buildOrchestrationPreviewEdges(
            orchestrationNodeId,
            orchestrationPlan
          )
        : [];

    return [
      ...baseEdges,
      ...additionEdges,
      ...orchestrationEdges,
    ];
  }

  /* ---------------------------------------------------------------------- */
  /* REBUILD FLOW                                                           */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    if (!activeEpisode) {
      return;
    }

    const nextNodes =
      buildFlowNodes();

    const nextEdges =
      buildFlowEdges();

    setNodes(
      nextNodes
    );

    setEdges(
      nextEdges
    );

    const selectedArtifact = activeEpisode.additions?.find((item) => item.id === selectedNodeId);
    const selectedNodeStillExists = selectedNodeId && (
      nextNodes.some((node) => node.id === selectedNodeId) ||
      (!showGeneratedArtifacts && isGeneratedRunArtifact(selectedArtifact))
    );

    const traceNodeStillExists = traceNodeId && nextNodes.some(
      (node) => node.id === traceNodeId
    );

    if (selectedNodeId && !selectedNodeStillExists) {
      setSelectedNodeId(null);
      setActiveThreadId(null);
      setDrawerOpen(false);
      setFullscreenOpen(false);
      setAnchoredConversationMinimized(false);
      return;
    }

    if (traceNodeId && !traceNodeStillExists) {
      setTraceNodeId(null);
    }

  }, [
    activeEpisodeId,
    viewStage,
    episodes,
    selectedNodeId,
    traceNodeId,
    orchestrationExpanded,
    orchestrationNodeId,
    orchestrationPreviews,
    orchestrationRun,
    showGeneratedArtifacts,
  ]);

  useEffect(() => {
    if (!reactFlowInstance) {
      return;
    }

    const timeoutId = window.setTimeout(
      () => {
        reactFlowInstance.fitView({
          padding: 0.18,
          duration: 250,
        });
      },
      60
    );

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    reactFlowInstance,
    activeEpisodeId,
    viewStage,
    visibleTopologyKey,
  ]);

  useEffect(() => {
    if (!followAutopilotWork || !reactFlowInstance || autopilotRun?.status !== "working" || !autopilotRun.activeTaskId) return;
    const target = nodes.find((node) => node.id === `autopilot-agent-${autopilotRun.activeTaskId}`) ?? nodes.find((node) => node.id === autopilotRun.activeNodeId);
    if (!target) return;
    reactFlowInstance.setCenter(target.position.x + 140, target.position.y + 90, { zoom: 0.82, duration: 300 });
  }, [autopilotRun?.activeTaskId, autopilotRun?.activeNodeId, autopilotRun?.status, followAutopilotWork, nodes, reactFlowInstance]);

  /* ---------------------------------------------------------------------- */
  /* WEBMCP — LIST EPISODES                                                 */
  /* ---------------------------------------------------------------------- */

  useWebMCP({
    name: "get_pending_episode_intakes",
    description: "List Episodes awaiting human-reviewed agent structuring proposals.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => ({
      intakes: episodes
        .filter((episode) => episode.intake?.status === "pending")
        .map((episode) => ({
          episodeId: episode.id,
          title: episode.title,
          objective: episode.title,
          providedContext: episode.context,
          authority: episode.intake.request?.authority ?? createEpisodeIntakeRequest({ episode }).authority,
        })),
    }),
  });

  useWebMCP({
    name: "get_episode_intake",
    description: "Inspect one Episode intake request and any proposed structure.",
    inputSchema: {
      type: "object",
      properties: { episode_id: { type: "string" } },
      required: ["episode_id"],
    },
    annotations: { readOnlyHint: true },
    execute: async ({ episode_id }) => {
      const episode = findEpisodeById(episode_id);
      if (!episode) throw new Error("Episode not found.");
      return {
        episodeId: episode.id,
        title: episode.title,
        intake: {
          ...normalizeEpisodeIntake(episode.intake),
          request: episode.intake?.request ?? createEpisodeIntakeRequest({ episode }),
        },
      };
    },
  });

  useWebMCP({
    name: "submit_episode_structure",
    description: "Submit a proposed Episode structure for human review. This does not accept or execute it.",
    inputSchema: {
      type: "object",
      properties: {
        episode_id: { type: "string" },
        objective: { type: "string" },
        context_summary: { type: "string" },
        work_nodes: { type: "array" },
        human_gates: { type: "array" },
        assumptions: { type: "array" },
        unresolved: { type: "array" },
      },
      required: ["episode_id", "objective", "context_summary", "work_nodes", "human_gates", "assumptions", "unresolved"],
    },
    annotations: { readOnlyHint: false },
    execute: async ({ episode_id, objective, context_summary, work_nodes, human_gates, assumptions, unresolved }) => {
      const proposal = submitEpisodeStructure({
        episodeId: episode_id,
        objective,
        context_summary,
        work_nodes,
        human_gates,
        assumptions,
        unresolved,
      });
      return { success: true, status: "proposed", proposal };
    },
  });

  useWebMCP({
    name:
      "list_episodes",

    description:
      "List all Workroom episodes and their current progress.",

    inputSchema: {
      type:
        "object",

      properties: {},
    },

    annotations: {
      readOnlyHint:
        true,
    },

    execute:
      async () => ({
        activeEpisodeId,

        episodes:
          episodes.map(
            (episode) => ({
              id:
                episode.id,

              title:
                episode.title,

              context:
                episode.context,

              currentStage:
                episode.currentStage +
                1,

              stageName:
                EPISODE_STAGES[
                  episode.currentStage
                ].name,

              status:
                episode.status,

              disposition:
                episode.disposition,

              project_id: episode.projectId,

              project_name: getProjectName(episode.projectId),
            })
          ),
      }),
  });

  /* ---------------------------------------------------------------------- */
  /* WEBMCP — GET EPISODE                                                   */
  /* ---------------------------------------------------------------------- */

  useWebMCP({
    name:
      "get_episode",

    description:
      "Inspect one Workroom episode including current core nodes, reasoning branches, node threads, and human disposition.",

    inputSchema: {
      type:
        "object",

      properties: {
        episodeId: {
          type:
            "string",

          description:
            "Episode ID. Omit to inspect the active episode.",
        },
      },
    },

    annotations: {
      readOnlyHint:
        true,
    },

    execute:
      async ({
        episodeId,
      } = {}) => {
        const episode =
          episodes.find(
            (item) =>
              item.id ===
              episodeId
          ) ??
          activeEpisode;

        if (!episode) {
          throw new Error(
            "Episode not found."
          );
        }

        const coreNodes =
          EPISODE_STAGES[
            episode.currentStage
          ].nodes.map(
            (node) => ({
              id:
                node.id,

              type:
                node.type,

              title:
                node.id ===
                "work"
                  ? episode.title
                  : node.id ===
                    "context"
                  ? episode.context ||
                    node.title
                  : node.title,
            })
          );

        return {
          id:
            episode.id,

          title:
            episode.title,

          context:
            episode.context,

          currentStage:
            episode.currentStage +
            1,

          stageName:
            EPISODE_STAGES[
              episode.currentStage
            ].name,

          status:
            episode.status,

          disposition:
            episode.disposition,

          project_id: episode.projectId,

          project_name: getProjectName(episode.projectId),

          coreNodes,

          additions:
            episode.additions ??
            [],
        };
      },
  });

  /* ---------------------------------------------------------------------- */
  /* WEBMCP — GET THREAD                                                    */
  /* ---------------------------------------------------------------------- */

  useWebMCP({
    name:
      "get_node_thread",

    description:
      "Inspect the complete conversation history for one Workroom node thread.",

    inputSchema: {
      type:
        "object",

      properties: {
        threadId: {
          type:
            "string",
        },
      },

      required: [
        "threadId",
      ],
    },

    annotations: {
      readOnlyHint:
        true,
    },

    execute:
      async ({
        threadId,
      }) => {
        for (
          const episode of
          episodes
        ) {
          const thread =
            (
              episode.additions ??
              []
            ).find(
              (item) =>
                item.id ===
                  threadId &&
                item.kind ===
                  "thread"
            );

          if (thread) {
            return {
              episodeId:
                episode.id,

              episodeTitle:
                episode.title,

              threadId:
                thread.id,

              stage:
                thread.stageIndex +
                1,

              stageName:
                EPISODE_STAGES[
                  thread.stageIndex
                ]?.name,

              parentNodeId:
                thread.parentNodeId,

              parentNode:
                findNodeTitle(
                  episode,
                  thread.stageIndex,
                  thread.parentNodeId
                ),

              status:
                thread.status,

              messages:
                thread.messages ??
                [],
            };
          }
        }

        throw new Error(
          "Thread not found."
        );
      },
  });

  /* ---------------------------------------------------------------------- */
  /* WEBMCP — GET PENDING                                                   */
  /* ---------------------------------------------------------------------- */

  useWebMCP({
    name:
      "get_pending_node_prompts",

    description:
      "Get pending human questions from Workroom node threads. Each pending item includes the full thread history.",

    inputSchema: {
      type:
        "object",

      properties: {},
    },

    annotations: {
      readOnlyHint:
        true,
    },

    execute:
      async () => {
        const pending = [];

        episodes.forEach(
          (episode) => {
            (
              episode.additions ??
              []
            )
              .filter(
                (item) =>
                  item.kind ===
                    "thread" &&
                  item.status ===
                    "pending"
              )
              .forEach(
                (thread) => {
                  const question =
                    latestHumanMessage(
                      thread
                    );

                  if (
                    !question
                  ) {
                    return;
                  }

                  pending.push({
                    episodeId:
                      episode.id,

                    episodeTitle:
                      episode.title,

                    threadId:
                      thread.id,

                    promptId:
                      thread.id,

                    pendingMessageId:
                      question.id,

                    stageIndex:
                      thread.stageIndex +
                      1,

                    stageName:
                      EPISODE_STAGES[
                        thread.stageIndex
                      ]?.name,

                    parentNodeId:
                      thread.parentNodeId,

                    parentNode:
                      findNodeTitle(
                        episode,
                        thread.stageIndex,
                        thread.parentNodeId
                      ),

                    question:
                      question.content,

                    history:
                      (
                        thread.messages ??
                        []
                      ).map(
                        (
                          message
                        ) => ({
                          role:
                            message.role,

                          content:
                            message.content,
                        })
                      ),
                  });
                }
              );
          }
        );

        return {
          count:
            pending.length,

          prompts:
            pending,
        };
      },
  });

  /* ---------------------------------------------------------------------- */
  /* WEBMCP — RESPOND                                                       */
  /* ---------------------------------------------------------------------- */

  useWebMCP({
    name:
      "respond_to_node_prompt",

    description:
      "Respond to the currently pending question in a Workroom node thread. The response is appended to the same conversation. This cannot advance stages or make the human disposition.",

    inputSchema: {
      type:
        "object",

      properties: {
        promptId: {
          type:
            "string",
        },

        response: {
          type:
            "string",
        },
      },

      required: [
        "promptId",
        "response",
      ],
    },

    annotations: {
      readOnlyHint:
        false,
    },

      execute:
      async ({
        promptId,
        response,
      }) => {
        let found =
          false;

        let responseEpisodeId = null;
        let responseNodeId = null;
        let responseNodeTitle = "Node";

        let pending =
          false;

        episodes.forEach(
          (episode) => {
            (
              episode.additions ??
              []
            ).forEach(
              (item) => {
                if (
                  item.kind ===
                    "thread" &&
                  item.id ===
                    promptId
                ) {
                  found =
                    true;

                  responseEpisodeId = episode.id;
                  responseNodeId = item.parentNodeId;
                  responseNodeTitle = findNodeTitle(episode, item.stageIndex, item.parentNodeId);

                  pending =
                    item.status ===
                    "pending";
                }
              }
            );
          }
        );

        if (!found) {
          throw new Error(
            "Node thread not found."
          );
        }

        if (!pending) {
          throw new Error(
            "This thread does not currently have a pending question."
          );
        }

        const agentMessage =
          createMessage(
            "agent",
            response
          );

        setEpisodes(
          (current) =>
            current.map(
              (episode) => ({
                ...episode,

                additions:
                  (
                    episode.additions ??
                    []
                  ).map(
                    (item) => {
                      if (
                        item.kind !==
                          "thread" ||
                        item.id !==
                          promptId
                      ) {
                        return item;
                      }

                      return {
                        ...item,

                        messages: [
                          ...(item.messages ??
                            []),

                          agentMessage,
                        ],

                        status:
                          "answered",
                      };
                    }
                  ),
              })
            )
        );

        appendActivity(responseEpisodeId, {
          type: "node.agent_response_received",
          actor: "codex",
          title: "Agent responded to node question",
          summary: `${responseNodeTitle}: ${compactArtifactSummary(response)}`,
          relatedNodeId: responseNodeId,
          authorityImpact: "proposal",
        });

        return {
          success:
            true,

          threadId:
            promptId,

          recorded:
            true,
        };
      },
  });

  /* ---------------------------------------------------------------------- */
  /* WEBMCP — ADD EVIDENCE                                                  */
  /* ---------------------------------------------------------------------- */

  useWebMCP({
    name:
      "add_evidence",

    description:
      "Add evidence as a visible reasoning branch. This cannot advance the stage or make a human disposition.",

    inputSchema: {
      type:
        "object",

      properties: {
        episodeId: {
          type:
            "string",
        },

        title: {
          type:
            "string",
        },

        finding: {
          type:
            "string",
        },

        source: {
          type:
            "string",
        },

        parentNodeId: {
          type:
            "string",
        },
      },

      required: [
        "title",
        "finding",
        "source",
      ],
    },

    annotations: {
      readOnlyHint:
        false,
    },

    execute:
      async ({
        episodeId,
        title,
        finding,
        source,
        parentNodeId,
      }) => {
        const episode =
          episodes.find(
            (item) =>
              item.id ===
              episodeId
          ) ??
          activeEpisode;

        if (!episode) {
          throw new Error(
            "Episode not found."
          );
        }

        const id =
          `evidence-${crypto.randomUUID()}`;

        const stageIndex =
          episode.currentStage;

        const defaultParent =
          stageIndex === 0
            ? "work"
            : stageIndex === 1
            ? "evidence"
            : "human";

        const resolvedParent =
          parentNodeId ??
          defaultParent;

        const position =
          makeAdditionPosition(
            episode,
            stageIndex,
            resolvedParent
          );

        const node = {
          id,

          kind:
            "evidence",

          label:
            "Evidence",

          title,

          body:
            finding,

          meta:
            source,

          stageIndex,

          parentNodeId:
            resolvedParent,

          position,
        };

        updateEpisode(
          episode.id,
          (current) => ({
            ...current,

            additions: [
              ...(current.additions ??
                []),

              node,
            ],
          })
        );

        return {
          success:
            true,

          episodeId:
            episode.id,

          evidence:
            node,
        };
      },
  });

  /* ---------------------------------------------------------------------- */
  /* WEBMCP — PROPOSE                                                       */
  /* ---------------------------------------------------------------------- */

  useWebMCP({
    name:
      "propose_action",

    description:
      "Add an agent recommendation as a reasoning branch. The agent may recommend but cannot advance stages or make final disposition.",

    inputSchema: {
      type:
        "object",

      properties: {
        episodeId: {
          type:
            "string",
        },

        action: {
          type:
            "string",
        },

        reasoning: {
          type:
            "string",
        },

        parentNodeId: {
          type:
            "string",
        },
      },

      required: [
        "action",
        "reasoning",
      ],
    },

    annotations: {
      readOnlyHint:
        false,
    },

    execute:
      async ({
        episodeId,
        action,
        reasoning,
        parentNodeId,
      }) => {
        const episode =
          episodes.find(
            (item) =>
              item.id ===
              episodeId
          ) ??
          activeEpisode;

        if (!episode) {
          throw new Error(
            "Episode not found."
          );
        }

        const id =
          `proposal-${crypto.randomUUID()}`;

        const stageIndex =
          episode.currentStage;

        const defaultParent =
          stageIndex === 0
            ? "inquiry"
            : stageIndex === 1
            ? "recommendation"
            : "human";

        const resolvedParent =
          parentNodeId ??
          defaultParent;

        const position =
          makeAdditionPosition(
            episode,
            stageIndex,
            resolvedParent
          );

        const node = {
          id,

          kind:
            "proposal",

          label:
            "Agent recommendation",

          title:
            action,

          body:
            reasoning,

          stageIndex,

          parentNodeId:
            resolvedParent,

          position,
        };

        updateEpisode(
          episode.id,
          (current) => ({
            ...current,

            additions: [
              ...(current.additions ??
                []),

              node,
            ],
          })
        );

        return {
          success:
            true,

          episodeId:
            episode.id,

          proposal:
            node,
        };
      },
  });

  /* ---------------------------------------------------------------------- */
  /* WEBMCP — EVALUATE                                                      */
  /* ---------------------------------------------------------------------- */

  useWebMCP({
    name:
      "evaluate_proposal",

    description:
      "Record an evidence-based evaluation branch. This does not make the human disposition.",

    inputSchema: {
      type:
        "object",

      properties: {
        episodeId: {
          type:
            "string",
        },

        verdict: {
          type:
            "string",

          enum: [
            "pass",
            "pass_with_conditions",
            "fail",
            "revise",
          ],
        },

        confidence: {
          type:
            "number",

          minimum: 0,

          maximum: 100,
        },

        summary: {
          type:
            "string",
        },

        conflicts: {
          type:
            "array",

          items: {
            type:
              "string",
          },
        },

        risks: {
          type:
            "array",

          items: {
            type:
              "string",
          },
        },

        missingEvidence: {
          type:
            "array",

          items: {
            type:
              "string",
          },
        },

        parentNodeId: {
          type:
            "string",
        },
      },

      required: [
        "verdict",
        "confidence",
        "summary",
        "conflicts",
        "risks",
        "missingEvidence",
      ],
    },

    annotations: {
      readOnlyHint:
        false,
    },

    execute:
      async ({
        episodeId,
        verdict,
        confidence,
        summary,
        conflicts,
        risks,
        missingEvidence,
        parentNodeId,
      }) => {
        const episode =
          episodes.find(
            (item) =>
              item.id ===
              episodeId
          ) ??
          activeEpisode;

        if (!episode) {
          throw new Error(
            "Episode not found."
          );
        }

        const id =
          `evaluation-${crypto.randomUUID()}`;

        const stageIndex =
          episode.currentStage;

        const defaultParent =
          stageIndex === 0
            ? "inquiry"
            : stageIndex === 1
            ? "evaluation"
            : "human";

        const resolvedParent =
          parentNodeId ??
          defaultParent;

        const position =
          makeAdditionPosition(
            episode,
            stageIndex,
            resolvedParent
          );

        const node = {
          id,

          kind:
            "evaluation",

          label:
            "Evaluation",

          title:
            verdict
              .replaceAll(
                "_",
                " "
              )
              .toUpperCase(),

          body:
            summary,

          meta:
            `${confidence}% confidence`,

          conflicts,

          risks,

          missingEvidence,

          stageIndex,

          parentNodeId:
            resolvedParent,

          position,
        };

        updateEpisode(
          episode.id,
          (current) => ({
            ...current,

            additions: [
              ...(current.additions ??
                []),

              node,
            ],
          })
        );

        return {
          success:
            true,

          episodeId:
            episode.id,

          evaluation:
            node,
        };
      },
  });

  /* ---------------------------------------------------------------------- */
  /* DRAWER ANCHOR                                                          */
  /* ---------------------------------------------------------------------- */

  let drawerAnchorId =
    selectedNodeId;

  if (
    activeThread?.parentNodeId
  ) {
    drawerAnchorId =
      activeThread.parentNodeId;
  }

  const drawerAnchorTitle =
    drawerAnchorId
      ? findNodeTitle(
          activeEpisode,
          viewStage,
          drawerAnchorId
        )
      : "";

  const drawerAnchorType =
    drawerAnchorId
      ? getNodeTypeLabel(
          activeEpisode,
          viewStage,
          drawerAnchorId
        )
      : "";

  const drawerAnchorAddition =
    activeEpisode.additions?.find(
      (item) =>
        item.id ===
        drawerAnchorId
    );

  const drawerCanRemoveNode =
    Boolean(
      drawerAnchorAddition
    );

  const selectedNodeIsValid = Boolean(
    activeEpisode &&
      selectedNodeId &&
      (getVisibleStageNodes().some((node) => node.id === selectedNodeId) ||
        activeEpisode.additions?.some((item) => item.id === selectedNodeId))
  );

  /* ---------------------------------------------------------------------- */
  /* RENDER                                                                 */
  /* ---------------------------------------------------------------------- */

  if (!activeEpisode) {
    return (
      <main className="app">
        No episodes available.
      </main>
    );
  }

  return (
    <main className="app">
      <NewEpisodeModal
        open={
          createOpen
        }
        onClose={() =>
          setCreateOpen(
            false
          )
        }
        onCreate={
          createEpisode
        }
        projects={projects}
        initialProjectId={newEpisodeProjectId}
        onCreateProject={() => setProjectModalOpen(true)}
      />

      <NewProjectModal
        key={editingProject?.id ?? "new-project"}
        open={projectModalOpen}
        onClose={() => { setProjectModalOpen(false); setEditingProject(null); }}
        onCreate={saveProject}
        project={editingProject}
      />

      {sourceViewerId && <SourceViewer sourceId={sourceViewerId} onClose={() => setSourceViewerId(null)} />}
      {sourceLibraryOpen && <SourceLibrary episode={activeEpisode} onClose={() => setSourceLibraryOpen(false)} onOpenSource={setSourceViewerId} />}

      <RenameEpisodeModal
        key={renamingEpisode?.id ?? "rename-episode"}
        open={Boolean(renamingEpisode)}
        episode={renamingEpisode}
        onClose={() => setRenamingEpisode(null)}
        onSave={renameEpisode}
      />

      <div className="workroom">
        {/* TOP BAR */}

        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="button"
              onClick={() =>
                setSidebarOpen(
                  (value) =>
                    !value
                )
              }
            >
              ☰ Tree view
            </button>

            <strong>
              SSI-WRX Workroom
            </strong>

            <span className="badge">
              {
                activeEpisode.id
              }
            </span>
          </div>

          <div className="topbar-actions">
            <button
              type="button"
              className="button"
              onClick={() =>
                reactFlowInstance?.fitView(
                  {
                    padding:
                      0.18,

                    duration:
                      250,
                  }
                )
              }
            >
              Fit canvas
            </button>

            {viewStage === 0 && ["accepted", "proposed"].includes(activeEpisode.intake?.status) && (
              <button
                type="button"
                className="button"
                onClick={organizeVisibleWorkflow}
              >
                Arrange for review
              </button>
            )}

            {["pending", "proposed"].includes(activeEpisode.intake?.status) && !intakePanelOpen && (
              <button
                type="button"
                className="button"
                onClick={() => setIntakePanelOpen(true)}
              >
                Review setup
              </button>
            )}

            <button
              type="button"
              className="button"
              onClick={() => {
                setShowCanvasHeader((value) => !value);
                if (showCanvasHeader) setShowEpisodeCockpit(false);
              }}
            >
              {showCanvasHeader ? "Focus canvas" : "Show header"}
            </button>

            {traceNodeId && (
              <button
                type="button"
                className="button"
                onClick={() => setTraceNodeId(null)}
              >
                Clear trace
              </button>
            )}

            {(activeEpisode.additions ?? []).some((item) => item.stageIndex === viewStage && isGeneratedRunArtifact(item)) && (
              <button
                type="button"
                className="button"
                onClick={() => setShowGeneratedArtifacts((value) => !value)}
              >
                {showGeneratedArtifacts ? "Hide run outputs" : "Show run outputs"}
              </button>
            )}

            <span className="badge">
              Human authority
            </span>
          </div>
        </header>

        <div
          className={`workspace ${
            sidebarOpen
              ? ""
              : "sidebar-collapsed"
          }`}
        >
          {/* SIDEBAR */}

          <aside className="sidebar">
            <div className="sidebar-content">
              <div className="sidebar-section-header">
                <span>Projects</span>
                <div className="sidebar-project-actions">
                  <button type="button" className="small-button" onClick={() => setProjectModalOpen(true)}>+ New Project</button>
                  <button type="button" className="small-button" onClick={() => { setNewEpisodeProjectId(null); setCreateOpen(true); }}>+ Episode</button>
                </div>
              </div>
              <label className="episode-search">
                <input aria-label="Search episodes" value={episodeSearch} onChange={(event) => setEpisodeSearch(event.target.value)} placeholder="Search episodes..." />
                {episodeSearch && <button type="button" className="episode-search-clear" aria-label="Clear episode search" onClick={() => setEpisodeSearch("")}>×</button>}
              </label>
              <div className="project-tree">
                {(() => {
                  const query = episodeSearch.trim().toLowerCase();
                  const projectMatches = (project) =>
                    !query || project.name.toLowerCase().includes(query) || episodes.some((episode) => episode.projectId === project.id && (episode.id.toLowerCase().includes(query) || episode.name.toLowerCase().includes(query) || episode.title.toLowerCase().includes(query)));
                  const hasMatchingEpisode = episodes.some((episode) => {
                    const projectName = projects.find((project) => project.id === episode.projectId)?.name ?? "Unassigned";
                    return !query || episode.id.toLowerCase().includes(query) || episode.name.toLowerCase().includes(query) || episode.title.toLowerCase().includes(query) || projectName.toLowerCase().includes(query);
                  });
                  const renderWorkflow = (episode) => {
                    if (episode.id !== activeEpisodeId) {
                      return null;
                    }

                    return <div className="episode-workflow" aria-label="Episode workflow">
                      <button type="button" className="episode-workflow-toggle" onClick={() => setWorkflowExpanded((current) => !current)} aria-expanded={workflowExpanded}>
                        <span>{workflowExpanded ? "▾" : "▸"}</span>
                        <strong>Workflow</strong>
                      </button>
                      {workflowExpanded && <div className="tree">
                        {EPISODE_STAGES.map((stage, index) => {
                          const unlocked = index <= episode.currentStage;
                          const current = index === viewStage;
                          const childNodes = index === 0 && episode.intake?.status === "accepted" && episode.workflow?.nodes?.length
                            ? episode.workflow.nodes
                            : stage.nodes;

                          return <div key={stage.name}>
                            <button type="button" disabled={!unlocked} className={`tree-stage ${current ? "active" : ""} ${!unlocked ? "locked" : ""}`} onClick={() => {
                              if (!unlocked) return;
                              setViewStage(index);
                              setSelectedNodeId(null);
                              setActiveThreadId(null);
                              setDrawerOpen(false);
                              setOrchestrationNodeId(null);
                              setOrchestrationExpanded(false);
                              setOrchestrationMinimized(false);
                              setOrchestrationDetailId(null);
                              setOrchestrationPreviews({});
                            }}>
                              <span>{index < episode.currentStage ? "✓" : index === episode.currentStage ? "▾" : "›"}</span>
                              <span>{index + 1}. {stage.name}</span>
                            </button>
                            {current && childNodes.filter((node) => node.kind !== "gate").map((node) => <button type="button" key={node.id} className="tree-node" onClick={() => {
                              setSelectedNodeId(node.id);
                              setAnchoredConversationMinimized(false);
                              setActiveThreadId(null);
                            }}>
                              <span className="tree-icon" />
                              {node.type ?? node.title ?? node.kind}
                            </button>)}
                          </div>;
                        })}
                      </div>}
                    </div>;
                  };
                  const renderEpisode = (episode) => (
                    <div className="project-episode" key={episode.id}>
                      <button type="button" className={`episode ${episode.id === activeEpisodeId ? "active" : ""}`} onClick={() => setActiveEpisodeId(episode.id)}>
                        <span className="episode-symbol">E</span>
                        <span className="episode-copy"><small>{episode.id}</small><strong title={episode.title}>{episode.name || deriveEpisodeName(episode.title)}</strong><small>Stage {episode.currentStage + 1} · {episode.intake?.status === "pending" ? "Pending intake" : episode.status === "archived" ? "Archived" : "Active"}</small></span>
                      </button>
                      {openEpisodeMenuId === episode.id && <div className="episode-menu-wrap">
                        <button type="button" className="episode-menu-button" aria-label={`Episode options for ${episode.name}`} aria-expanded="true" onClick={(event) => { event.stopPropagation(); setOpenEpisodeMenuId(null); setMovingEpisodeId(null); }}>⋮</button>
                        <div className="episode-menu" role="menu">
                          <button type="button" role="menuitem" onClick={() => { setRenamingEpisode(episode); setOpenEpisodeMenuId(null); }}>Rename episode</button>
                          <button type="button" role="menuitem" onClick={() => { exportEpisodeReview(episode); setOpenEpisodeMenuId(null); }}>Export review package</button>
                          <button type="button" role="menuitem" onClick={() => setMovingEpisodeId(episode.id)}>Move to project</button>
                          {movingEpisodeId === episode.id && <select autoFocus className="episode-menu-select" aria-label={`Move ${episode.name} to project`} value={episode.projectId ?? ""} onChange={(event) => { moveEpisode(episode.id, event.target.value); setOpenEpisodeMenuId(null); setMovingEpisodeId(null); }}><option value="">Unassigned</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>}
                          <button type="button" role="menuitem" onClick={() => archiveEpisode(episode.id)}>Archive</button>
                          <button type="button" role="menuitem" className="danger" onClick={() => removeEpisode(episode.id)}>Remove</button>
                        </div>
                      </div>}
                      {openEpisodeMenuId !== episode.id && <button type="button" className="episode-menu-button" aria-label={`Episode options for ${episode.name}`} title="Episode options" onClick={(event) => { event.stopPropagation(); setOpenEpisodeMenuId(episode.id); setMovingEpisodeId(null); }}>⋮</button>}
                      {renderWorkflow(episode)}
                    </div>
                  );
                  const renderGroup = (project, projectEpisodes) => {
                    const expanded = query || expandedProjects[project.id] !== false;
                    return <div className="project-group" key={project.id}>
                      <div className="project-row">
                        <button type="button" className="project-toggle" onClick={() => setExpandedProjects((current) => ({ ...current, [project.id]: !current[project.id] }))}><span>{expanded ? "▾" : "▸"}</span><strong>{project.name}</strong><small>{projectEpisodes.length}</small></button>
                        {project.id !== "unassigned" && <div className="project-row-actions">
                          <button type="button" className="project-add" aria-label={`Create episode in ${project.name}`} onClick={() => { setNewEpisodeProjectId(project.id); setCreateOpen(true); }}>+</button>
                          <div className="project-menu-wrap">
                            <button type="button" className="project-menu-button" aria-label={`More options for ${project.name}`} title="Project options" aria-expanded={openProjectMenuId === project.id} onClick={(event) => { event.stopPropagation(); setOpenProjectMenuId((current) => current === project.id ? null : project.id); }}>⋮</button>
                            {openProjectMenuId === project.id && <div className="project-menu" role="menu">
                              <button type="button" role="menuitem" onClick={() => { setEditingProject(project); setProjectModalOpen(true); setOpenProjectMenuId(null); }}>Rename</button>
                              <button type="button" role="menuitem" className="danger" onClick={() => { removeProject(project.id); setOpenProjectMenuId(null); }}>Remove</button>
                            </div>}
                          </div>
                        </div>}
                      </div>
                      {expanded && projectEpisodes.filter((episode) => !query || episode.id.toLowerCase().includes(query) || episode.name.toLowerCase().includes(query) || episode.title.toLowerCase().includes(query) || project.name.toLowerCase().includes(query)).map(renderEpisode)}
                    </div>;
                  };
                  return <>
                    {projects.filter((project) => !project.archived && projectMatches(project)).map((project) => renderGroup(project, episodes.filter((episode) => episode.projectId === project.id && episode.status !== "archived")))}
                    {renderGroup({ id: "unassigned", name: "Unassigned" }, episodes.filter((episode) => !episode.projectId && episode.status !== "archived").filter((episode) => !query || episode.id.toLowerCase().includes(query) || episode.name.toLowerCase().includes(query) || episode.title.toLowerCase().includes(query)))}
                    {query && !hasMatchingEpisode && <div className="episode-search-empty">No matching episodes</div>}
                  </>;
                })()}
              </div>

            </div>
          </aside>

          {/* MAIN */}

          <section className="main">
            {showCanvasHeader && <div className="canvas-header">
              <div>
                <div className="breadcrumb">
                  {activeEpisode.id} · {viewStage === activeEpisode.currentStage ? `Stage ${activeEpisode.currentStage + 1} of 3` : `Viewing Stage ${viewStage + 1} · Episode at Stage ${activeEpisode.currentStage + 1} of 3`}
                </div>

                <h1>
                  {activeEpisode.name || deriveEpisodeName(activeEpisode.title)}
                </h1>

                <p className="episode-objective">
                  {activeEpisode.title}
                </p>

                <div className="stage-guidance">
                  <span>Stage {viewStage + 1} · {activeStageTemplate.name}</span>
                  <p>{activeStageTemplate.description}</p>
                </div>
              </div>

              <div className="canvas-badges">
                <button
                  type="button"
                  className={`action-button action-button-secondary notification-trigger ${notificationsOpen ? "active" : ""}`}
                  aria-expanded={notificationsOpen}
                  aria-controls="episode-notifications-drawer"
                  aria-label="Notifications"
                  title="Notifications"
                  onClick={() => {
                    if (notificationsOpen) {
                      setNotificationsOpen(false);
                      return;
                    }
                    const latestNotification = getLatestAgentNotification(activeEpisode.activity);
                    setNotificationSeenByEpisode((current) => ({ ...current, [activeEpisode.id]: latestNotification?.id ?? null }));
                    setNotificationsOpen(true);
                    setActivityOpen(false);
                    setDrawerOpen(false);
                  }}
                >
                  <NotificationIcon />
                  {getLatestAgentNotification(activeEpisode.activity)?.id !== notificationSeenByEpisode[activeEpisode.id] && <span className="notification-unseen-dot" aria-label="Unseen notifications" />}
                </button>
                <button
                  type="button"
                  className={`action-button action-button-secondary activity-trigger ${activityOpen ? "active" : ""}`}
                  aria-expanded={activityOpen}
                  aria-controls="episode-activity-drawer"
                  onClick={() => {
                    if (activityOpen) {
                      setActivityOpen(false);
                      return;
                    }
                    const latestActivity = activeEpisode.activity?.at(-1);
                    setActivitySeenByEpisode((current) => ({
                      ...current,
                      [activeEpisode.id]: latestActivity?.id ?? null,
                    }));
                    setActivityOpen(true);
                    setNotificationsOpen(false);
                    setDrawerOpen(false);
                  }}
                >
                  <ActivityIcon />
                  <span>Activity{activeEpisode.activity?.length ? ` · ${activeEpisode.activity.length}` : ""}</span>
                  {activeEpisode.activity?.length > 0 && activitySeenByEpisode[activeEpisode.id] !== activeEpisode.activity.at(-1)?.id && <span className="activity-unseen-dot" aria-label="Unseen activity" />}
                </button>
                <div className="canvas-status-context">
                <button
                  type="button"
                  className={`badge episode-cockpit-trigger ${showEpisodeCockpit ? "active" : ""}`}
                  aria-expanded={showEpisodeCockpit}
                  aria-label={showEpisodeCockpit ? "Hide episode status" : "Show episode status"}
                  onClick={() => setShowEpisodeCockpit((value) => !value)}
                >
                  <span className="episode-cockpit-stage"><strong>{activeEpisode.currentStage + 1}</strong><span>Stage</span></span>
                  <span className="episode-cockpit-label">{showEpisodeCockpit ? "Hide status" : "Status"}</span>
                </button>

                <span className="badge codex-status-badge" title="Runtime: Local Codex · Mode: Analysis only">
                  <StatusIndicator
                    status={codexStatus.message === "Checking local Codex…" ? "waiting" : codexStatus.ready ? "ready" : codexStatus.authenticated === false && codexStatus.cliAvailable ? "human-required" : codexStatus.cliAvailable ? "waiting" : "error"}
                    label={codexStatus.ready ? "Codex Ready" : codexStatus.message}
                    size="sm"
                  />
                </span>
                </div>
              </div>
            </div>}

            {showEpisodeCockpit && <EpisodeProgressGuide
              episode={activeEpisode}
              viewStage={viewStage}
              liveOrchestrationRun={orchestrationRun}
              onSelectStage={(stageIndex) => {
                setViewStage(stageIndex);
                setSelectedNodeId(null);
                setTraceNodeId(null);
              }}
              onOpenIntake={() => setIntakePanelOpen(true)}
              onOpenActivity={() => {
                const latestActivity = activeEpisode.activity?.at(-1);
                setActivitySeenByEpisode((current) => ({ ...current, [activeEpisode.id]: latestActivity?.id ?? null }));
                setActivityOpen(true);
                setDrawerOpen(false);
              }}
              onOpenOrchestration={openNodeOrchestration}
              onOpenSources={() => setSourceLibraryOpen(true)}
            />}

            {showEpisodeCockpit && <GovernancePanel
              episode={activeEpisode}
              project={activeProject}
              onAcceptReadback={acceptReadback}
              onRequestReadbackRevision={requestReadbackRevision}
              onAuthorize={authorizeAutopilotAnalysis}
              onRecordState={recordProjectState}
              onAcceptReturnItem={acceptReturnItem}
              onCommitReturn={commitReturnReconciliation}
              onRejectReturn={rejectReturn}
            />}

            {/* CANVAS */}

            <div
              ref={flowWrapperRef}
              className={`flow-wrapper ${showAutopilotInspector && (autopilotRun?.episodeId === activeEpisode.id || activeEpisode.autopilotRun) ? "with-run-inspector" : ""}`}
            >
              <ReactFlow
                nodes={
                  nodes
                }
                edges={
                  edges
                }
                nodeTypes={
                  NODE_TYPES
                }
                onNodesChange={
                  onNodesChange
                }
                onEdgesChange={
                  onEdgesChange
                }
                onNodeClick={(
                  _event,
                  node
                ) => {
                  if (node.data?.orchestrationPreview) {
                    setOrchestrationDetailId(
                      node.data.detailId
                    );
                    return;
                  }

                  const addition =
                    activeEpisode.additions?.find(
                      (item) =>
                        item.id ===
                        node.id
                    );

                  /*
                   * Thread nodes open their
                   * conversation directly.
                   */

                  if (
                    addition?.kind ===
                    "thread"
                  ) {
                    setSelectedNodeId(
                      addition.parentNodeId
                    );

                    setActiveThreadId(
                      addition.id
                    );

                    setAnchoredConversationMinimized(false);

                    setDrawerOpen(false);

                    return;
                  }

                            setSelectedNodeId(
                              node.id
                            );

                            setAnchoredConversationMinimized(false);

                  const stats =
                    getThreadStats(
                      activeEpisode,
                      viewStage,
                      node.id
                    );

                  setActiveThreadId(
                    stats.latestThread?.id ??
                      null
                  );
                }}
                onNodeDragStop={
                  handleNodeDragStop
                }
                onMove={() =>
                  setViewportRevision(
                    (value) => value + 1
                  )
                }
                onInit={
                  setReactFlowInstance
                }
                nodesConnectable={
                  false
                }
                edgesReconnectable={
                  false
                }
                minZoom={
                  0.35
                }
                maxZoom={
                  1.6
                }
                fitView
                fitViewOptions={{
                  padding:
                    0.18,
                }}
              >
                <MiniMap
                  className="workflow-minimap"
                  pannable
                  zoomable
                  nodeColor={(node) => node.data?.traceDimmed ? "#e5e5e5" : node.data?.workflowKind === "gate" ? "#d8d8d8" : node.data?.proposed ? "#f3f3f1" : "#bdbdbd"}
                />

                <Background
                  gap={
                    22
                  }
                  size={
                    1
                  }
                />

                <Controls
                  showInteractive={
                    false
                  }
                />
              </ReactFlow>

              <div className="canvas-legend" aria-label="Workflow edge legend">
                <span className="canvas-legend-title">Workflow edges</span>
                <span><i className="legend-swatch dependency" />Dependency</span>
                <span><i className="legend-swatch branch" />Branch / evidence</span>
                <span><i className="legend-swatch proposed" />Proposed</span>
                <span><i className="legend-swatch checkpoint" />Human checkpoint</span>
              </div>

              <AgentNotificationTray
                notifications={agentNotifications}
                onDismiss={(id) => setAgentNotifications((current) => current.filter((notification) => notification.id !== id))}
                onOpen={(notification) => {
                  setAgentNotifications((current) => current.filter((item) => item.id !== notification.id));
                  if (isOrchestrationEligibleNode(getOrchestrationSourceNode(notification.nodeId))) {
                    openNodeOrchestration(notification.nodeId);
                  } else {
                    openDetailsForNode(notification.nodeId);
                  }
                }}
              />

              {!showAutopilotInspector && (autopilotRun?.episodeId === activeEpisode.id || activeEpisode.autopilotRun) && <button type="button" className="autopilot-inspector-reopen" onClick={() => setShowAutopilotInspector(true)}>Show run inspector</button>}

              {showAutopilotInspector && <AutopilotRunPanel
                run={autopilotRun?.episodeId === activeEpisode.id ? autopilotRun : activeEpisode.autopilotRun}
                onStop={cancelAutopilotEpisode}
                onRetry={() => runAutopilotEpisode(activeEpisode)}
                follow={followAutopilotWork}
                onFollow={setFollowAutopilotWork}
                onPromote={promoteAutopilotPackage}
                onRevise={(instruction) => runAutopilotEpisode(activeEpisode, instruction.trim())}
                onPause={() => setAutopilotHumanStatus("paused")}
                onReject={() => setAutopilotHumanStatus("rejected")}
                outputCount={(activeEpisode.additions ?? []).filter((item) => item.stageIndex === viewStage && isGeneratedRunArtifact(item)).length}
                canvasArtifactsVisible={showGeneratedArtifacts}
                onToggleCanvasArtifacts={() => setShowGeneratedArtifacts((value) => !value)}
                onInspectOutput={(taskId) => {
                  const artifact = (activeEpisode.additions ?? []).find((item) => isGeneratedRunArtifact(item) && (getArtifactTaskId(item) === taskId || item.id?.endsWith(`-${taskId}`)));
                  if (artifact) openDetailsForNode(artifact.id);
                }}
                onHide={() => setShowAutopilotInspector(false)}
              />}

              <EpisodeIntakePanel
                open={intakePanelOpen}
                episode={activeEpisode}
                intake={activeEpisode.intake}
                onClose={() => setIntakePanelOpen(false)}
                onRequestRevision={requestIntakeRevision}
                onAccept={acceptEpisodeStructure}
                codexRunning={codexRunningEpisodeId === activeEpisode.id}
                codexStatus={codexStatus}
                codexRun={codexRun?.episodeId === activeEpisode.id ? codexRun : null}
                onCancelAnalysis={cancelNativeCodexIntake}
                onRetryAnalysis={() => runNativeCodexIntake(activeEpisode)}
              />

              <ActivityDrawer
                episode={activeEpisode}
                open={activityOpen}
                onClose={() => setActivityOpen(false)}
              />

              <NotificationDrawer
                episode={activeEpisode}
                open={notificationsOpen}
                onClose={() => setNotificationsOpen(false)}
                onOpenRelated={(nodeId) => {
                  setNotificationsOpen(false);
                  if (isOrchestrationEligibleNode(getOrchestrationSourceNode(nodeId))) {
                    openNodeOrchestration(nodeId);
                  } else {
                    openDetailsForNode(nodeId);
                  }
                }}
              />

              <OrchestrationErrorBoundary
                key={`${orchestrationNodeId ?? "orchestration-idle"}-${orchestrationPreviews[orchestrationNodeId]?.state ?? "request"}`}
                onClose={() => {
                  setOrchestrationNodeId(null);
                  setOrchestrationExpanded(false);
                  setOrchestrationMinimized(false);
                  setOrchestrationDetailId(null);
                }}
              >
                <NodeOrchestrationWindow
                  open={Boolean(orchestrationNodeId)}
                  minimized={orchestrationMinimized}
                  node={nodes.find(
                    (node) => node.id === orchestrationNodeId
                  )}
                  nodeTitle={findNodeTitle(
                    activeEpisode,
                    viewStage,
                    orchestrationNodeId
                  )}
                  nodeType={getNodeTypeLabel(
                    activeEpisode,
                    viewStage,
                    orchestrationNodeId
                  )}
                  nodeBody={nodes.find(
                    (node) => node.id === orchestrationNodeId
                  )?.data?.body ?? ""}
                  summary={getOrchestrationPlanSummary(
                    orchestrationPreviews[orchestrationNodeId]?.plan ??
                    getLocalOrchestrationPlan(orchestrationNodeId),
                    orchestrationPreviews[orchestrationNodeId]?.executionState
                  )}
                  executionState={
                    orchestrationPreviews[orchestrationNodeId]?.executionState
                  }
                  orchestrationRun={orchestrationRun?.nodeId === orchestrationNodeId ? orchestrationRun : null}
                  phase={
                    orchestrationPreviews[orchestrationNodeId]?.state ??
                    "request"
                  }
                  clusterVisible={orchestrationExpanded}
                  plan={
                    orchestrationPreviews[orchestrationNodeId]?.plan ??
                    getLocalOrchestrationPlan(orchestrationNodeId)
                  }
                  onMinimize={() =>
                    setOrchestrationMinimized(true)
                  }
                  onClose={() => {
                    setOrchestrationNodeId(null);
                    setOrchestrationExpanded(false);
                    setOrchestrationDetailId(null);
                  }}
                  onExpand={() => {
                    setOrchestrationExpanded((value) => !value);
                    setOrchestrationMinimized(false);
                  }}
                  onFullscreen={() =>
                    setOrchestrationDetailId("first-mate")
                  }
                  onPreviewPlan={previewFirstMate}
                  onBack={backToOrchestrationRequest}
                  onApprove={approveOrchestrationPreview}
                  onReset={resetOrchestrationPreview}
                  onRun={runOrchestration}
                  onCancelRun={cancelOrchestration}
                  onInspectArtifacts={inspectOrchestrationArtifacts}
                  flowWrapperRef={flowWrapperRef}
                  reactFlowInstance={reactFlowInstance}
                  viewportRevision={viewportRevision}
                />

                {orchestrationDetailId && (
                  <OrchestrationDetailOverlay
                    nodeTitle={findNodeTitle(
                      activeEpisode,
                      viewStage,
                      orchestrationNodeId
                    )}
                    nodeType={getNodeTypeLabel(
                      activeEpisode,
                      viewStage,
                      orchestrationNodeId
                    )}
                    detailId={orchestrationDetailId}
                    plan={
                      orchestrationPreviews[orchestrationNodeId]?.plan ??
                      getLocalOrchestrationPlan(orchestrationNodeId)
                    }
                    executionState={
                      orchestrationPreviews[orchestrationNodeId]?.executionState
                    }
                    onClose={() => setOrchestrationDetailId(null)}
                  />
                )}
              </OrchestrationErrorBoundary>
            </div>

            {!drawerOpen &&
              !anchoredConversationMinimized &&
              selectedNodeIsValid && (
              <AnchoredConversationCard
                episode={activeEpisode}
                stageIndex={viewStage}
                anchorNodeId={selectedNodeId}
                anchorTitle={drawerAnchorTitle}
                anchorType={drawerAnchorType}
                thread={activeThread}
                nodes={nodes}
                flowWrapperRef={flowWrapperRef}
                reactFlowInstance={reactFlowInstance}
                viewportRevision={viewportRevision}
                onSend={handleDrawerSend}
                onExpand={() => {
                  setDrawerView("conversation");
                  setDrawerOpen(true);
                }}
                onFullscreen={() => setFullscreenOpen(true)}
                onMinimize={() =>
                  setAnchoredConversationMinimized(true)
                }
                orchestrationEligible={Boolean(
                  isOrchestrationEligibleNode(
                    getOrchestrationSourceNode(selectedNodeId)
                  )
                )}
                orchestrationApproved={
                  orchestrationPreviews[selectedNodeId]?.state ===
                  "preview-approved"
                }
                orchestrationSummary={getOrchestrationPlanSummary(
                  orchestrationPreviews[selectedNodeId]?.plan ??
                  getLocalOrchestrationPlan(selectedNodeId),
                  orchestrationPreviews[selectedNodeId]?.executionState
                )}
                onOrchestrate={() => openNodeOrchestration(selectedNodeId)}
                contextSummary={
                  selectedNodeId === "context"
                    ? getContextSummary(activeEpisode)
                    : null
                }
                onViewContext={openContextDrawer}
              />
            )}

            {/* RIGHT DRAWER */}

            <NodeChatDrawer
              open={drawerOpen && selectedNodeIsValid}
              onClose={
                closeDrawer
              }
              episode={
                activeEpisode
              }
              anchorNodeId={
                drawerAnchorId
              }
              anchorTitle={
                drawerAnchorTitle
              }
              anchorType={
                drawerAnchorType
              }
              thread={
                activeThread
              }
              stageIndex={
                viewStage
              }
              contextContent={activeEpisode.context}
              sourceManifest={activeEpisode.sources ?? []}
              nodeSourceManifest={(activeEpisode.sources ?? []).filter((source) => (activeEpisode.nodeSourceIds?.[drawerAnchorId] ?? []).includes(source.sourceId))}
              onOpenSource={setSourceViewerId}
              onAttachSources={(files) => { void attachNodeSources(drawerAnchorId, files).catch((error) => window.alert(error.message || "Could not attach those files.")); }}
              attachmentsBusy={nodeSourceBusy}
              initialView={drawerView}
              nodeDetails={getNodeDetails(drawerAnchorId)}
              onExportReview={exportNodeOutputReview}
              onSend={
                handleDrawerSend
              }
              canRemoveNode={
                drawerCanRemoveNode
              }
              onRemoveNode={() =>
                removeNodeById(
                  drawerAnchorId
                )
              }
            />

            <FullscreenConversation
              open={fullscreenOpen && selectedNodeIsValid}
              onClose={() => setFullscreenOpen(false)}
              episode={activeEpisode}
              stageIndex={viewStage}
              anchorTitle={drawerAnchorTitle}
              anchorType={drawerAnchorType}
              thread={activeThread}
              onSend={handleDrawerSend}
            />
          </section>
        </div>
      </div>
    </main>
  );
}
