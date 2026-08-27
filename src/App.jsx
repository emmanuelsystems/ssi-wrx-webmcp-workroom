import {
  useEffect,
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

import "./App.css";

/* -------------------------------------------------------------------------- */
/* STORAGE                                                                    */
/* -------------------------------------------------------------------------- */

const STORAGE_KEY = "ssi-wrx-workroom-v4";

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
        selected
          ? "selected"
          : ""
      }`}
    >
      <MessageBadge
        count={
          data.threadMessageCount
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
        {data.label}
      </div>

      <div className="node-title">
        {data.title}
      </div>

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
          data.threadMessageCount
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
          data.threadMessageCount
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
      className={`flow-node thread-node ${
        selected
          ? "selected"
          : ""
      }`}
    >
      <div className="thread-node-count">
        ◌ {data.messageCount}
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
};

/* -------------------------------------------------------------------------- */
/* RIGHT DRAWER                                                               */
/* -------------------------------------------------------------------------- */

function NodeChatDrawer({
  open,
  onClose,

  episode,

  anchorNodeId,
  anchorTitle,
  anchorType,

  thread,

  onSend,
  onFindMissingJudgment,

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

  const selectedAddition =
    useMemo(() => {
      if (
        !activeEpisode ||
        !selectedNodeId
      ) {
        return null;
      }

      return (
        activeEpisode.additions?.find(
          (item) =>
            item.id ===
            selectedNodeId
        ) ?? null
      );
    }, [
      activeEpisode,
      selectedNodeId,
    ]);

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
        return (
          episode.context ||
          "Known context"
        );
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

      setDrawerOpen(
        true
      );

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

    setActiveThreadId(
      stats.latestThread?.id ??
        null
    );

    setDrawerOpen(
      true
    );
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
            title =
              activeEpisode.context ||
              "No additional context was provided yet.";

            body =
              activeEpisode.context
                ? "Human-provided starting context."
                : "Context can be recovered through evidence and node conversations.";
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

              title,

              body,

              meta:
                node.meta,

              threadMessageCount:
                stats.messageCount,

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

              title:
                item.title,

              body:
                item.body,

              meta:
                item.meta,

              threadMessageCount:
                stats.messageCount,

              threadPending:
                stats.pending,

              onOpenThread: () =>
                openDrawerForNode(
                  item.id
                ),
            },
          };
        });

    return [
      ...baseNodes,
      ...additions,
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
        }));

    return [
      ...baseEdges,
      ...additionEdges,
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

    window.setTimeout(
      () => {
        reactFlowInstance?.fitView(
          {
            padding:
              0.18,

            duration:
              250,
          }
        );
      },
      40
    );
  }, [
    activeEpisodeId,
    viewStage,
    episodes,
    reactFlowInstance,
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

            <div className="flow-wrapper">
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

                    setDrawerOpen(
                      true
                    );

                    return;
                  }

                  setSelectedNodeId(
                    node.id
                  );

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
            </div>

            {/* FLOATING CHAT BUBBLE */}

            {!drawerOpen && (
              <button
                type="button"
                className={`node-chat-launcher ${
                  selectedNodeId
                    ? ""
                    : "disabled"
                }`}
                disabled={
                  !selectedNodeId
                }
                onClick={() =>
                  openDrawerForNode(
                    selectedNodeId
                  )
                }
              >
                <span className="node-chat-launcher-icon">
                  ◌
                </span>

                <span className="node-chat-launcher-copy">
                  <small>
                    {selectedNodeId
                      ? "Node conversation"
                      : "Select a node"}
                  </small>

                  <strong>
                    {selectedNodeId
                      ? findNodeTitle(
                          activeEpisode,
                          viewStage,
                          selectedNodeId
                        )
                      : "Choose something on the canvas"}
                  </strong>
                </span>

                {selectedNodeId &&
                  getThreadStats(
                    activeEpisode,
                    viewStage,
                    selectedNodeId
                  )
                    .messageCount >
                    0 && (
                    <span className="node-chat-launcher-count">
                      {
                        getThreadStats(
                          activeEpisode,
                          viewStage,
                          selectedNodeId
                        )
                          .messageCount
                      }
                    </span>
                  )}
              </button>
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
          </section>
        </div>
      </div>
    </main>
  );
}