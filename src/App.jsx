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
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";

import { useWebMCP } from "use-webmcp-tool";

import {
  createOrchestrationPlan,
  createOrchestrationRequest,
  getOrchestrationPlanSummary,
} from "./orchestration";

import "./App.css";

/* -------------------------------------------------------------------------- */
/* STORAGE                                                                    */
/* -------------------------------------------------------------------------- */

const STORAGE_KEY = "ssi-wrx-workroom-v4";

function getContextSummary(episode) {
  return {
    source: episode?.title ?? "Synthetic episode",
    confirmed: [
      "Visible bounded follow-up work",
      "Human approval remains final",
    ],
    proposed: [
      "Connector-assisted context retrieval",
      "Workroom-native orchestrator",
    ],
    unresolved: [
      "Runtime choice",
      "Default connectors",
      "Orchestration start condition",
    ],
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

function latestAgentMessage(
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
      "agent"
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

    context:
      legacyContext,

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
      return INITIAL_EPISODES;
    }

    const parsed =
      JSON.parse(raw);

    if (
      !Array.isArray(parsed) ||
      parsed.length === 0
    ) {
      return INITIAL_EPISODES;
    }

    return parsed.map(
      normalizeEpisode
    );
  } catch {
    return INITIAL_EPISODES;
  }
}

/* -------------------------------------------------------------------------- */
/* NEW EPISODE MODAL                                                         */
/* -------------------------------------------------------------------------- */

function NewEpisodeModal({
  open,
  onClose,
  onCreate,
}) {
  const [title, setTitle] =
    useState("");

  const [context, setContext] =
    useState("");

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
      setContext("");
    }
  }, [open]);

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

    onCreate({
      title:
        cleanTitle,

      context:
        cleanContext,
    });

    setTitle("");
    setContext("");
  }

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
              placeholder="e.g. Is our conversation → follow-up workflow simple enough for a new team member to use confidently?"
            />
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

          <div className="episode-modal-note">
            <div className="episode-note-icon">
              ↳
            </div>

            <div>
              <strong>
                The workroom will
                recover the rest.
              </strong>

              <p>
                Workflow, governing
                intention, evidence,
                hidden judgment,
                evaluation structure,
                and next decisions can
                emerge as the episode
                develops.
              </p>
            </div>
          </div>

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
                !title.trim()
              }
            >
              Create episode
            </button>
          </div>
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

      <div className="node-title">
        {data.title}
      </div>

      {data.contextSummary && (
        <div className="context-summary">
          <strong>{data.contextSummary.source}</strong>
          {[
            ["Confirmed", data.contextSummary.confirmed],
            ["Proposed", data.contextSummary.proposed],
            ["Unresolved", data.contextSummary.unresolved],
          ].map(([label, items]) => (
            <div key={label} className="context-summary-group">
              <span>{label}</span>
              {items.slice(0, 3).map((item) => (
                <div key={item}>• {item}</div>
              ))}
            </div>
          ))}
        </div>
      )}

      {data.body && (
        <div className="node-body">
          {data.body}
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
        Stage gate
      </div>

      <div className="node-title">
        {data.title}
      </div>

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
          <strong>Future orchestration</strong>
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
        <span className="orchestration-summary-status complete">
          <span className="status-dot" /> 2 complete
        </span>
        <span className="orchestration-summary-status working">
          <span className="status-dot" /> 1 working
        </span>
        <span className="orchestration-summary-status human-required">
          <span className="status-dot" /> 1 human required
        </span>
        {humanAttentionRequired && (
          <span className="orchestration-attention">
            <span className="status-dot" /> Human attention required
          </span>
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
            <span
              className={`preview-agent-status ${orchestrationStatusClass(
                agent.status
              )}`}
            >
              <span className="status-dot" />
              {agent.status}
            </span>
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
            <p
              className={`orchestration-detail-status ${orchestrationStatusClass(
                selectedAgent?.status ?? "Waiting"
              )}`}
            >
              <span className="status-dot" />
              {selectedAgent?.status}
            </p>
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

function getOrchestrationSummary(nodeId, plan) {
  return getOrchestrationPlanSummary(
    plan ??
      createOrchestrationPlan({
        episode: { id: "concept-preview" },
        node: { id: nodeId },
      })
  );
}

function orchestrationSummaryStatus(summary) {
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
  plan
) {
  const baseX = parentPosition.x;
  const baseY = parentPosition.y;
  const preview = [
    {
      id: `orchestration-${parentNodeId}-first-mate`,
      type: "orchestration",
      draggable: false,
      position: { x: baseX + 330, y: baseY + 30 },
      data: {
        label: "First Mate",
        title: "Coordinating 3 agents",
        status: "working",
        statusLabel: "Working",
        result: "Concept only · no execution",
        orchestrationPreview: true,
        detailId: "first-mate",
      },
    },
    ...(plan.assignments ?? []).map((assignment, index) => {
      const task = plan.tasks[index];
      return {
      id: `orchestration-${parentNodeId}-${assignment.id}`,
      type: "orchestration",
      draggable: false,
      position: {
        x: baseX + 650,
        y: baseY - 70 + index * 105,
      },
      data: {
        label: assignment.role,
        title: task.title,
        status: orchestrationStatusClass(assignment.status),
        statusLabel: `Mock · ${assignment.status}`,
        result: `Output: ${task.output}`,
        orchestrationPreview: true,
        detailId: assignment.id,
      },
      };
    }),
    {
      id: `orchestration-${parentNodeId}-output`,
      type: "orchestrationOutput",
      draggable: false,
      position: { x: baseX + 960, y: baseY + 245 },
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
  ) ?? plan[plan.length - 1];
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
      <span className="status-dot" />
      {summary.total} agents
    </button>
  );
}

function OrchestrationPreviewNode({ data }) {
  return (
    <div className={`flow-node orchestration-flow-node ${data.status}`}>
      <Handle type="target" position={Position.Top} id="flow-target" className="flow-handle" />
      <div className="node-label">{data.label}</div>
      <div className="node-title">{data.title}</div>
      <div className={`orchestration-flow-status ${data.status}`}>
        <span className="status-dot" />
        {data.statusLabel}
      </div>
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

function OrchestrationDetailOverlay({
  nodeTitle,
  nodeType,
  detailId,
  plan,
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
            <p className={`orchestration-detail-status ${orchestrationStatusClass(assignment?.status ?? "Waiting")}`}>
              <span className="status-dot" /> {assignment?.status}
            </p>
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
  summary,
  phase,
  plan,
  onMinimize,
  onClose,
  onExpand,
  onFullscreen,
  onPreviewPlan,
  onBack,
  onApprove,
  onReset,
  flowWrapperRef,
  reactFlowInstance,
  viewportRevision,
}) {
  const windowRef = useRef(null);
  const basePositionRef = useRef({ left: 0, top: 0 });
  const [position, setPosition] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
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
  const humanAttention = summary.humanRequired > 0;

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
              <button type="button" onClick={onExpand} aria-label="Expand orchestration">↗</button>
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
                <span>Concept preview — nothing has run.</span>
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
                <strong>First Mate</strong>
                <span>Coordinating {summary.total} agents · Preview approved</span>
                <div className="node-orchestration-status-list">
                  {validPlan.assignments.map((assignment) => (
                    <span key={assignment.id} className={orchestrationStatusClass(assignment.status)}>
                      <span className="status-dot" /> {assignment.role} · Mock {assignment.status}
                    </span>
                  ))}
                </div>
                <div className={`node-orchestration-human ${humanAttention ? "attention" : ""}`}>
                  <span className="status-dot" />
                  Human attention: {humanAttention ? "Required" : "None"}
                </div>
                <span className="node-orchestration-mock-note">Mock execution state · Nothing has run.</span>
              </>
            )}
          </div>
          <div className="node-orchestration-window-actions approved-actions">
            <button type="button" onClick={onExpand} disabled={!validPlan}>Expand orchestration →</button>
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
            type="button"
            className="drawer-secondary-button"
            disabled={pending}
            onClick={() =>
              setDraft(
                "What hidden judgment, conflict, assumption, or missing evidence would materially change this node?"
              )
            }
          >
            Find missing judgment
          </button>

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
            <p>Full context is available in the drawer.</p>
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
            Node conversation
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

      <div className="drawer-thread">
        {anchorNodeId === "context" && (
          <section className="drawer-context-detail">
            <div className="drawer-eyebrow">Known context</div>
            <h3>Source</h3>
            <p>{anchorTitle}</p>
            <h3>Full context</h3>
            <p className="drawer-context-raw">
              {contextContent || "No additional context was provided yet."}
            </p>
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
      </div>

      <form
        className="drawer-composer"
        onSubmit={submit}
      >
        <div className="drawer-composer-box">
          <textarea
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
              type="button"
              className="drawer-secondary-button"
              disabled={pending}
              onClick={() =>
                setDraft(
                  "What hidden judgment, conflict, assumption, or missing evidence would materially change this node?"
                )
              }
            >
              Find missing judgment
            </button>

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
      </form>
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
    drawerOpen,
    setDrawerOpen,
  ] = useState(false);

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
    if (!activeEpisode) {
      return;
    }

    setViewStage(
      activeEpisode.currentStage
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

    setAnchoredConversationMinimized(false);
    setOrchestrationNodeId(null);
    setOrchestrationExpanded(false);
    setOrchestrationMinimized(false);
    setOrchestrationDetailId(null);
    setOrchestrationPreviews({});
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

  function getLocalOrchestrationRequest(nodeId) {
    if (
      !activeEpisode ||
      !nodeId ||
      !ORCHESTRATION_ELIGIBLE_NODES.has(nodeId)
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
    if (
      !activeEpisode ||
      !nodeId ||
      !ORCHESTRATION_ELIGIBLE_NODES.has(nodeId)
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

  function openNodeOrchestration(nodeId) {
    if (
      !activeEpisode ||
      !nodeId ||
      !nodes.some((node) => node.id === nodeId) ||
      !ORCHESTRATION_ELIGIBLE_NODES.has(nodeId)
    ) {
      return;
    }

    setSelectedNodeId(nodeId);
    setOrchestrationNodeId(nodeId);
    setOrchestrationMinimized(false);
    setOrchestrationDetailId(null);
    setOrchestrationExpanded(
      orchestrationPreviews[nodeId]?.state ===
        "preview-approved"
    );
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

    setOrchestrationPreviews((current) => ({
      ...current,
      [orchestrationNodeId]: {
        state: "preview-approved",
        plan:
          current[orchestrationNodeId]?.plan ??
          getLocalOrchestrationPlan(orchestrationNodeId),
      },
    }));
    setOrchestrationExpanded(true);
    setOrchestrationMinimized(false);
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

  /* ---------------------------------------------------------------------- */
  /* OPEN CHAT                                                              */
  /* ---------------------------------------------------------------------- */

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

  function createEpisode({
    title,
    context,
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

    const episode = {
      id,

      title,

      context,

      currentStage: 0,

      status: "active",

      disposition: null,

      layouts: {},

      additions: [],
    };

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

    setCreateOpen(
      false
    );
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
  }

  /* ---------------------------------------------------------------------- */
  /* NODE DRAG                                                              */
  /* ---------------------------------------------------------------------- */

  function handleNodeDragStop(
    _event,
    node
  ) {
    if (node.data?.orchestrationPreview) {
      return;
    }

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

  function handleDrawerSend(
    content
  ) {
    if (
      !selectedNodeId
    ) {
      return;
    }

    if (activeThread) {
      addThreadFollowUp(
        activeThread.id,
        content
      );

      return;
    }

    createThread(
      selectedNodeId,
      content
    );
  }

  /* ---------------------------------------------------------------------- */
  /* BUILD FLOW NODES                                                       */
  /* ---------------------------------------------------------------------- */

  function buildFlowNodes() {
    if (
      !activeEpisode ||
      !activeStageTemplate
    ) {
      return [];
    }

    const baseNodes =
      activeStageTemplate.nodes.map(
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
            activeEpisode.layouts?.[
              viewStage
            ]?.[
              node.id
            ] ??
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

              selected:
                selectedNodeId === node.id,

              isContext:
                node.id === "context",

              contextSummary,

              onViewContext: () =>
                openDrawerForNode(node.id),

              orchestrationEligible:
                ORCHESTRATION_ELIGIBLE_NODES.has(
                  node.id
                ),

              orchestrationSummary:
                getOrchestrationSummary(
                  node.id,
                  orchestration?.plan
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
            viewStage
        )
        .map((item) => {
          const position =
            activeEpisode.layouts?.[
              viewStage
            ]?.[
              item.id
            ] ??
            item.position;

          if (
            item.kind ===
            "thread"
          ) {
            const first =
              firstHumanMessage(
                item
              );

            const latestAgent =
              latestAgentMessage(
                item
              );

            return {
              id:
                item.id,

              type:
                "thread",

              position,

              data: {
                question:
                  first?.content ??
                  "Node conversation",

                preview:
                  latestAgent?.content ??
                  "",

                messageCount:
                  item.messages
                    ?.length ?? 0,

                pending:
                  item.status ===
                  "pending",

                secondary:
                  true,

                onOpen: () => {
                  setSelectedNodeId(
                    item.parentNodeId
                  );

                  setActiveThreadId(
                    item.id
                  );

                  setDrawerOpen(
                    true
                  );
                },
              },
            };
          }

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

              meta:
                item.meta,

              threadMessageCount:
                stats.messageCount,

              threadCount:
                stats.threads.length,

              threadPending:
                stats.pending,

              onOpenThread: () =>
                openDrawerForNode(
                  item.id
                ),
            },
          };
        });

    const orchestrationPlan =
      orchestrationPreviews[orchestrationNodeId]?.plan ??
      getLocalOrchestrationPlan(orchestrationNodeId);

    const orchestrationNodes =
      orchestrationExpanded &&
      orchestrationNodeId &&
      ORCHESTRATION_ELIGIBLE_NODES.has(
        orchestrationNodeId
      ) &&
      isValidOrchestrationPlan(orchestrationPlan)
        ? buildOrchestrationPreviewNodes(
            orchestrationNodeId,
            getNodePosition(
              activeEpisode,
              viewStage,
              orchestrationNodeId
            ),
            orchestrationPlan
          )
        : [];

    return [
      ...baseNodes,
      ...additions,
      ...orchestrationNodes,
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

    const baseEdges =
      activeStageTemplate.edges.map(
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

          className:
            "governed-edge",
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
            item.parentNodeId
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

          className:
            "branch-edge",
        }));

    const orchestrationPlan =
      orchestrationPreviews[orchestrationNodeId]?.plan ??
      getLocalOrchestrationPlan(orchestrationNodeId);

    const orchestrationEdges =
      orchestrationExpanded &&
      orchestrationNodeId &&
      ORCHESTRATION_ELIGIBLE_NODES.has(
        orchestrationNodeId
      ) &&
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

    if (
      !selectedNodeId ||
      !nextNodes.find(
        (node) =>
          node.id ===
          selectedNodeId
      )
    ) {
      const firstSelectable =
        nextNodes.find(
          (node) =>
            node.type !==
            "gate" &&
            node.type !==
            "thread"
        );

      setSelectedNodeId(
        firstSelectable?.id ??
          null
      );
    }

  }, [
    activeEpisodeId,
    viewStage,
    episodes,
    selectedNodeId,
    orchestrationExpanded,
    orchestrationNodeId,
    orchestrationPreviews,
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

  /* ---------------------------------------------------------------------- */
  /* WEBMCP — LIST EPISODES                                                 */
  /* ---------------------------------------------------------------------- */

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
                <span>
                  Episodes
                </span>

                <button
                  type="button"
                  className="small-button"
                  onClick={() =>
                    setCreateOpen(
                      true
                    )
                  }
                >
                  + New
                </button>
              </div>

              <div className="episodes">
                {episodes.map(
                  (episode) => (
                    <button
                      type="button"
                      key={
                        episode.id
                      }
                      className={`episode ${
                        episode.id ===
                        activeEpisodeId
                          ? "active"
                          : ""
                      }`}
                      onClick={() =>
                        setActiveEpisodeId(
                          episode.id
                        )
                      }
                    >
                      <span className="episode-symbol">
                        E
                      </span>

                      <span className="episode-copy">
                        <small>
                          {
                            episode.id
                          }
                          {" · "}
                          Episode
                        </small>

                        <strong>
                          {
                            episode.title
                          }
                        </strong>

                        <small>
                          Stage{" "}
                          {episode.currentStage +
                            1}{" "}
                          of 3
                        </small>
                      </span>
                    </button>
                  )
                )}
              </div>

              <div className="sidebar-divider" />

              <div className="sidebar-section-header">
                <span>
                  Episode tree
                </span>

                <small>
                  Stage{" "}
                  {activeEpisode.currentStage +
                    1}
                </small>
              </div>

              <div className="tree">
                {EPISODE_STAGES.map(
                  (
                    stage,
                    index
                  ) => {
                    const unlocked =
                      index <=
                      activeEpisode.currentStage;

                    const current =
                      index ===
                      viewStage;

                    return (
                      <div
                        key={
                          stage.name
                        }
                      >
                        <button
                          type="button"
                          disabled={
                            !unlocked
                          }
                          className={`tree-stage ${
                            current
                              ? "active"
                              : ""
                          } ${
                            !unlocked
                              ? "locked"
                              : ""
                          }`}
                          onClick={() => {
                            if (
                              !unlocked
                            ) {
                              return;
                            }

                            setViewStage(
                              index
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
                            setOrchestrationPreviews({});
                          }}
                        >
                          <span>
                            {index <
                            activeEpisode.currentStage
                              ? "✓"
                              : index ===
                                activeEpisode.currentStage
                              ? "▾"
                              : "›"}
                          </span>

                          <span>
                            {index +
                              1}
                            .{" "}
                            {
                              stage.name
                            }
                          </span>
                        </button>

                        {current &&
                          stage.nodes
                            .filter(
                              (node) =>
                                node.kind !==
                                "gate"
                            )
                            .map(
                              (node) => (
                                <button
                                  type="button"
                                  key={
                                    node.id
                                  }
                                  className="tree-node"
                                  onClick={() => {
    setSelectedNodeId(
      node.id
    );

    setAnchoredConversationMinimized(false);

                                    setActiveThreadId(
                                      null
                                    );
                                  }}
                                >
                                  <span className="tree-icon" />

                                  {
                                    node.type
                                  }
                                </button>
                              )
                            )}
                      </div>
                    );
                  }
                )}
              </div>
            </div>
          </aside>

          {/* MAIN */}

          <section className="main">
            <div className="canvas-header">
              <div>
                <div className="breadcrumb">
                  {
                    activeEpisode.id
                  }

                  <span>
                    ›
                  </span>

                  <strong>
                    {
                      activeStageTemplate.name
                    }
                  </strong>
                </div>

                <h1>
                  {
                    activeStageTemplate.title
                  }
                </h1>

                <p>
                  {
                    activeStageTemplate.description
                  }
                </p>
              </div>

              <div className="canvas-badges">
                <span className="badge">
                  Episode
                </span>

                <span className="badge">
                  Stage{" "}
                  {viewStage +
                    1}{" "}
                  of 3
                </span>
              </div>
            </div>

            {/* CANVAS */}

            <div
              ref={flowWrapperRef}
              className="flow-wrapper"
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

              <OrchestrationErrorBoundary
                key={orchestrationNodeId ?? "orchestration-idle"}
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
                    getLocalOrchestrationPlan(orchestrationNodeId)
                  )}
                  phase={
                    orchestrationPreviews[orchestrationNodeId]?.state ??
                    "request"
                  }
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
                    setOrchestrationExpanded(true);
                    setOrchestrationMinimized(false);
                  }}
                  onFullscreen={() =>
                    setOrchestrationDetailId("first-mate")
                  }
                  onPreviewPlan={previewFirstMate}
                  onBack={backToOrchestrationRequest}
                  onApprove={approveOrchestrationPreview}
                  onReset={resetOrchestrationPreview}
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
                    onClose={() => setOrchestrationDetailId(null)}
                  />
                )}
              </OrchestrationErrorBoundary>
            </div>

            {!drawerOpen &&
              !anchoredConversationMinimized &&
              selectedNodeId && (
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
                onExpand={() => setDrawerOpen(true)}
                onFullscreen={() => setFullscreenOpen(true)}
                onMinimize={() =>
                  setAnchoredConversationMinimized(true)
                }
                orchestrationEligible={Boolean(
                  ORCHESTRATION_ELIGIBLE_NODES.has(selectedNodeId)
                )}
                orchestrationApproved={
                  orchestrationPreviews[selectedNodeId]?.state ===
                  "preview-approved"
                }
                orchestrationSummary={getOrchestrationPlanSummary(
                  orchestrationPreviews[selectedNodeId]?.plan ??
                  getLocalOrchestrationPlan(selectedNodeId)
                )}
                onOrchestrate={() => openNodeOrchestration(selectedNodeId)}
                contextSummary={
                  selectedNodeId === "context"
                    ? getContextSummary(activeEpisode)
                    : null
                }
                onViewContext={() => openDrawerForNode("context")}
              />
            )}

            {/* RIGHT DRAWER */}

            <NodeChatDrawer
              open={
                drawerOpen
              }
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
              open={fullscreenOpen}
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
