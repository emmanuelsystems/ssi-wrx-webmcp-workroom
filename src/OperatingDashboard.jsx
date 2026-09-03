import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconAdjustmentsHorizontal,
  IconArrowRight,
  IconBolt,
  IconBook2,
  IconBriefcase2,
  IconCheckupList,
  IconChevronDown,
  IconCircleCheck,
  IconClipboardCheck,
  IconClock,
  IconFileDescription,
  IconGripVertical,
  IconHome,
  IconLayoutDashboard,
  IconLoader2,
  IconMicrophone,
  IconPaperclip,
  IconPlayerPlay,
  IconPlus,
  IconRobot,
  IconSend2,
  IconSparkles,
  IconStack2,
  IconTemplate,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { extractSourceFile, getEpisodeSource, SOURCE_TEXT_LIMIT } from "./episodeSources.js";

import "./OperatingDashboard.css";

const STORAGE_KEY = "ssi-wrx-operating-dashboard-v1";
const SOURCE_TRUNCATION_NOTE = "\n\n[Source text truncated for this Codex turn; the full file remains attached locally.]";

function createId(prefix = "item") {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const INITIAL_COLUMNS = {
  now: [
    {
      id: "review-sources",
      title: "Review meeting & materials",
      description: "Synthesize the discussion and source documents.",
      output: "Meeting brief",
      outputType: "Brief",
      state: "Ready",
    },
    {
      id: "extract-decisions",
      title: "Extract decisions & commitments",
      description: "Identify decisions, owners, requirements, and due dates.",
      output: "Decision log",
      outputType: "Register",
      state: "Ready",
    },
  ],
  next: [
    {
      id: "research-gaps",
      title: "Research open questions",
      description: "Close the evidence gaps surfaced in the meeting.",
      output: "Research note",
      outputType: "Research",
      state: "Queued",
    },
    {
      id: "draft-brief",
      title: "Draft client follow-up brief",
      description: "Frame goals, options, recommendations, and next steps.",
      output: "Client brief",
      outputType: "Document",
      state: "Queued",
    },
    {
      id: "prepare-deck",
      title: "Prepare executive presentation",
      description: "Turn the recommendation into a concise decision deck.",
      output: "Slide deck",
      outputType: "Presentation",
      state: "Queued",
    },
  ],
  review: [
    {
      id: "confirm-direction",
      title: "Confirm approach with David",
      description: "Validate the priorities before client-facing work begins.",
      output: "Direction approval",
      outputType: "Approval",
      state: "Human review",
    },
    {
      id: "client-review",
      title: "Final client review & alignment",
      description: "Approve the brief and deck before delivery.",
      output: "Delivery approval",
      outputType: "Approval",
      state: "Human review",
    },
  ],
};

function previewFromEpisodeProposal(proposal) {
  const nodes = proposal.workNodes ?? [];
  const split = Math.max(1, Math.ceil(nodes.length / 2));
  const taskForNode = (node, columnId) => ({
    title: node.title,
    description: node.description,
    output: `${node.kind} review`,
    outputType: "Analysis",
    state: columnId === "review" ? "Human review" : columnId === "now" ? "Ready" : "Queued",
  });
  return {
    title: proposal.objective,
    summary: proposal.context.summary,
    now: nodes.slice(0, split).map((node) => taskForNode(node, "now")),
    next: nodes.slice(split).map((node) => taskForNode(node, "next")),
    review: (proposal.humanGates ?? []).map((gate) => ({
      title: gate.title,
      description: `Human checkpoint after ${(gate.afterNodeIds ?? []).join(", ") || "the proposed work"}.`,
      output: "Human decision record",
      outputType: "Approval",
      state: "Human review",
    })),
  };
}

function columnsFromEpisodeProposal(proposal) {
  const preview = previewFromEpisodeProposal(proposal);
  const stateForColumn = { now: "Ready", next: "Queued", review: "Human review" };
  return Object.fromEntries(
    ["now", "next", "review"].map((columnId) => [
      columnId,
      (preview[columnId] ?? []).map((task) => ({
        ...task,
        id: createId(`proposal-${columnId}`),
        state: stateForColumn[columnId],
      })),
    ]),
  );
}

function sourceForConversation(source) {
  const text = String(source.text ?? "").trim();
  const boundedText = text.length > SOURCE_TEXT_LIMIT
    ? `${text.slice(0, SOURCE_TEXT_LIMIT - SOURCE_TRUNCATION_NOTE.length)}${SOURCE_TRUNCATION_NOTE}`
    : text;
  return {
    sourceId: source.sourceId,
    fileName: source.fileName,
    fileType: source.fileType,
    extension: source.extension,
    size: source.size,
    extractionStatus: source.extractionStatus,
    charCount: source.charCount,
    createdAt: source.createdAt,
    text: boundedText,
  };
}

function conversationMessagesFromEpisode(episode) {
  return (Array.isArray(episode?.additions) ? episode.additions : [])
    .filter((item) => item.kind === "thread" && Array.isArray(item.messages))
    .flatMap((thread) => thread.messages.map((message) => ({
      id: message.id ?? createId("message"),
      role: message.role === "agent" ? "agent" : "human",
      text: message.content ?? message.text ?? "",
      sourceIds: thread.sourceIds ?? [],
    })))
    .filter((message) => message.text.trim())
    .slice(-60);
}

const NAV_GROUPS = [
  {
    label: "Workspace",
    items: [
      { id: "home", label: "Home", icon: IconHome },
      { id: "work", label: "Work", icon: IconBriefcase2 },
      { id: "runs", label: "Runs", icon: IconPlayerPlay },
      { id: "outputs", label: "Outputs", icon: IconFileDescription },
      { id: "reviews", label: "Reviews", icon: IconCircleCheck, count: 2 },
    ],
  },
  {
    label: "Capabilities",
    items: [
      { id: "agents", label: "Agents", icon: IconRobot },
      { id: "skills", label: "Skills", icon: IconBolt },
      { id: "templates", label: "Templates", icon: IconTemplate },
    ],
  },
];

const EPISODE_STAGE_LABELS = ["Understand the work", "Evaluate the candidate", "Human disposition"];

function getStoredColumns() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return stored?.columns ?? INITIAL_COLUMNS;
  } catch {
    return INITIAL_COLUMNS;
  }
}

function Sidebar({ activeEpisodeId, activeNav, episodes, isNewConversation, onNavigate, onNewConversation, onSelectEpisode }) {
  return (
    <aside className="operating-sidebar">
      <div className="brand-lockup">
        <div className="brand-mark">SSI</div>
        <div>
          <strong>Workroom</strong>
          <span>Systems Shaper</span>
        </div>
      </div>

      <nav aria-label="Primary navigation">
        {NAV_GROUPS.map((group) => (
          <div className="nav-group" key={group.label}>
            <span className="nav-label">{group.label}</span>
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  className={`nav-item ${activeNav === item.id ? "is-active" : ""}`}
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  type="button"
                >
                  <Icon aria-hidden="true" size={19} stroke={1.65} />
                  <span>{item.label}</span>
                  {item.count ? <span className="nav-count">{item.count}</span> : null}
                </button>
              );
            })}
          </div>
        ))}
        <div className="nav-group episode-nav-group">
          <div className="episode-nav-heading">
            <span className="nav-label">Episodes</span>
            <button className="episode-new-button" onClick={onNewConversation} type="button">+ New</button>
          </div>
          <div className="episode-list" aria-label="Episodes">
            <button className={`episode-nav-item episode-new-conversation ${isNewConversation ? "is-active" : ""}`} onClick={onNewConversation} type="button">
              <span className="episode-nav-status" />
              <span><strong>New conversation</strong><small>Draft a new Episode with SSI</small></span>
            </button>
            {episodes.map((episode) => (
              <button
                className={`episode-nav-item ${activeEpisodeId === episode.id ? "is-active" : ""}`}
                key={episode.id}
                onClick={() => onSelectEpisode(episode.id)}
                type="button"
              >
                <span className="episode-nav-status" />
                <span>
                  <strong>{episode.name}</strong>
                  <small>{episode.id} · {episode.status}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      </nav>

      <div className="sidebar-footer">
        <button className="workspace-switcher" type="button">
          <span className="avatar">EA</span>
          <span>
            <strong>Emmanuel</strong>
            <small>SSI workspace</small>
          </span>
          <IconChevronDown aria-hidden="true" size={16} />
        </button>
      </div>
    </aside>
  );
}

function Conversation({ messages, isResponding }) {
  return (
    <section className="conversation-summary" aria-labelledby="conversation-title">
      <div className="conversation-eyebrow">
        <span className="status-dot" />
        Agent conversation
      </div>
      {messages.length === 0 ? (
        <div className="conversation-empty">
          <div className="agent-symbol">
            <IconSparkles aria-hidden="true" size={18} stroke={1.8} />
          </div>
          <div>
            <h2 id="conversation-title">Start with the outcome</h2>
            <p>Tell SSI what you need to accomplish. It will help shape a reviewable plan without starting work on your behalf.</p>
          </div>
        </div>
      ) : (
        <div aria-live="polite" className="conversation-thread">
          <h2 className="sr-only" id="conversation-title">Conversation with SSI Agent</h2>
          {messages.map((message) => (
            <article className={`conversation-message is-${message.role}`} key={message.id}>
              {message.role === "agent" ? (
                <div className="agent-symbol" aria-hidden="true">
                  <IconSparkles size={16} stroke={1.8} />
                </div>
              ) : null}
              <div className="conversation-bubble">
                <div className="conversation-message-meta">
                  <span>{message.role === "agent" ? "SSI Agent" : "You"}</span>
                  {message.role === "agent" && message.model ? <small>{message.model}</small> : null}
                </div>
                <p>{message.text}</p>
                {message.analysis ? <div className="agent-analysis">
                  <span className="agent-analysis-label">Working assessment</span>
                  <p>{message.analysis.summary}</p>
                  {["findings", "decisions", "risks", "openQuestions"].map((section) => message.analysis[section]?.length ? (
                    <div className="agent-analysis-section" key={section}>
                      <strong>{section === "openQuestions" ? "Open questions" : section[0].toUpperCase() + section.slice(1)}</strong>
                      <ul>{message.analysis[section].map((item) => <li key={item}>{item}</li>)}</ul>
                    </div>
                  ) : null)}
                </div> : null}
                {message.actions?.length ? <div className="conversation-actions-wrap">
                  <span>Suggested next actions</span>
                  <ul className="conversation-actions">
                    {message.actions.map((action) => <li key={action}><IconArrowRight size={13} /> {action}</li>)}
                  </ul>
                </div> : null}
              </div>
            </article>
          ))}
          {isResponding ? (
            <article className="conversation-message is-agent is-pending" aria-label="SSI Agent is responding">
              <div className="agent-symbol" aria-hidden="true"><IconSparkles size={16} stroke={1.8} /></div>
              <div className="conversation-bubble"><div className="conversation-message-meta"><span>SSI Agent</span></div><p>Thinking<span className="typing-dots" aria-hidden="true">…</span></p></div>
            </article>
          ) : null}
        </div>
      )}
    </section>
  );
}

function WorkCard({ task, columnId, onDragStart, onSelect, selected, working }) {
  return (
    <button
      className={`work-card ${selected ? "is-selected" : ""}`}
      draggable
      onClick={() => onSelect(task)}
      onDragStart={(event) => onDragStart(event, task.id, columnId)}
      type="button"
    >
      <IconGripVertical className="drag-handle" aria-hidden="true" size={18} />
      <span className="work-card-copy">
        <strong>{task.title}</strong>
        <span>{task.description}</span>
        <small>
          Expected output: <b>{task.output}</b>
        </small>
      </span>
      <span className={`task-state ${working ? "is-working" : ""}`}>
        {working ? <IconLoader2 className="spin" size={14} /> : null}
        {working ? "Working" : task.state}
      </span>
      <IconArrowRight className="card-arrow" aria-hidden="true" size={16} />
    </button>
  );
}

function WorkColumn({ id, title, subtitle, tasks, accent, ...props }) {
  return (
    <section
      className={`work-column work-column-${accent}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => props.onDrop(event, id)}
    >
      <header>
        <div>
          <h3>{title} <span>{tasks.length}</span></h3>
          <p>{subtitle}</p>
        </div>
      </header>
      <div className="work-card-list">
        {tasks.map((task) => (
          <WorkCard
            columnId={id}
            key={task.id}
            onDragStart={props.onDragStart}
            onSelect={props.onSelect}
            selected={props.selectedTask?.id === task.id}
            task={task}
            working={props.workingIds.includes(task.id)}
          />
        ))}
      </div>
      <button className="add-action" type="button" onClick={() => props.onAdd(id)}>
        <IconPlus aria-hidden="true" size={16} /> Add action
      </button>
    </section>
  );
}

function ContextPanel({ context, open, selectedTask, onClose }) {
  const sources = context.sources ?? [];
  const people = context.people ?? [];
  const decisions = context.decisions ?? [];
  return (
    <aside className={`context-panel ${open ? "is-open" : ""}`} aria-hidden={!open}>
      <header className="context-header">
        <div>
          <span>Engagement context</span>
          <strong>{selectedTask ? selectedTask.title : context.title}</strong>
        </div>
        <button aria-label="Close context" onClick={onClose} type="button">
          <IconX size={18} />
        </button>
      </header>

      {selectedTask ? (
        <div className="selected-action-detail">
          <span className="detail-label">Selected action</span>
          <h3>{selectedTask.title}</h3>
          <p>{selectedTask.description}</p>
          <dl>
            <div><dt>Expected output</dt><dd>{selectedTask.output}</dd></div>
            <div><dt>Output type</dt><dd>{selectedTask.outputType}</dd></div>
            <div><dt>Authority</dt><dd>Human approval retained</dd></div>
          </dl>
        </div>
      ) : null}

      {context.summary ? <section className="context-section episode-context-section">
        <div className="context-section-title">
          <span><IconBook2 size={17} /> Episode brief</span>
        </div>
        <p className="episode-context-copy">{context.summary}</p>
        <dl className="episode-context-meta">
          <div><dt>Episode</dt><dd>{context.episodeId}</dd></div>
          <div><dt>Stage</dt><dd>{context.stageLabel}</dd></div>
        </dl>
      </section> : null}

      {sources.length > 0 ? <section className="context-section">
        <div className="context-section-title">
          <span><IconStack2 size={17} /> Sources</span>
        </div>
        <div className="context-list">
          {sources.map((source) => (
            <button className="context-row" key={source.name} type="button">
              <span className="context-icon"><IconFileDescription size={16} /></span>
              <span><strong>{source.name}</strong>{source.meta ? <small>{source.meta}</small> : null}</span>
            </button>
          ))}
        </div>
      </section> : null}

      {people.length > 0 ? <section className="context-section">
        <div className="context-section-title">
          <span><IconUsers size={17} /> People</span>
        </div>
        <div className="people-list">
          {people.map((person) => (
            <div className="person-row" key={person.name}>
              <span className="person-avatar">{person.initials ?? person.name.slice(0, 2).toUpperCase()}</span>
              <span><strong>{person.name}</strong>{person.role ? <small>{person.role}</small> : null}</span>
            </div>
          ))}
        </div>
      </section> : null}

      {decisions.length > 0 ? <section className="context-section decisions-section">
        <div className="context-section-title">
          <span><IconClipboardCheck size={17} /> Known decisions</span>
        </div>
        <ul>
          {decisions.map((decision) => <li key={decision}>{decision}</li>)}
        </ul>
      </section> : null}
    </aside>
  );
}

function Composer({ attachedSources, disabled, includeSources, model, onAttachSources, onRemoveSource, onSend, onToggleSources, onModelChange, sourcesBusy }) {
  const [value, setValue] = useState("");
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

  function submit(event) {
    event.preventDefault();
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue("");
    inputRef.current?.focus();
  }

  return (
    <form className="command-composer" onSubmit={submit}>
      <div className="composer-main-row">
        <button aria-label="Attach source" className="composer-tool" disabled={disabled || sourcesBusy} onClick={() => fileInputRef.current?.click()} type="button">
          <IconPaperclip size={19} />
        </button>
        <input
          accept=".txt,.md,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          aria-label="Attach source files"
          className="composer-file-input"
          multiple
          onChange={(event) => {
            const files = [...event.target.files];
            event.target.value = "";
            if (files.length) onAttachSources(files);
          }}
          ref={fileInputRef}
          type="file"
        />
        <input
          aria-label="Message SSI Agent"
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Ask SSI Agent anything, or adjust the plan..."
          ref={inputRef}
          value={value}
        />
        <button aria-label="Use microphone" className="composer-tool" type="button">
          <IconMicrophone size={19} />
        </button>
        <button aria-label="Send message" className="composer-send" disabled={disabled || !value.trim()} type="submit">
          <IconSend2 size={18} />
        </button>
      </div>
      <div className="composer-options">
        <label>
          <span>Model</span>
          <select aria-label="Codex model" disabled={disabled} onChange={(event) => onModelChange(event.target.value || null)} value={model ?? ""}>
            <option value="">Codex default</option>
            <option value="gpt-5.6-luna">GPT-5.6 Luna</option>
            <option value="gpt-5.6-terra">GPT-5.6 Terra</option>
            <option value="gpt-5.6-sol">GPT-5.6 Sol</option>
          </select>
        </label>
        {attachedSources.length ? <label className="source-consent">
          <input checked={includeSources} disabled={disabled} onChange={(event) => onToggleSources(event.target.checked)} type="checkbox" />
          <span>Include {attachedSources.length} attached source{attachedSources.length === 1 ? "" : "s"} in this conversation</span>
        </label> : <span className="composer-hint">Attach .txt, .md, .pdf, or .docx files for grounded discussion.</span>}
      </div>
      {attachedSources.length ? <div className="composer-source-list" aria-label="Attached conversation sources">
        {attachedSources.map((source) => <span key={source.sourceId}>{source.fileName}<button aria-label={`Remove ${source.fileName}`} onClick={() => onRemoveSource(source.sourceId)} type="button">×</button></span>)}
      </div> : null}
    </form>
  );
}

function PlaceholderView({ activeNav, onReturn }) {
  const labels = {
    home: ["Home", "A concise view of active work, reviews, and reminders."],
    runs: ["Runs", "Live and historical orchestration activity."],
    outputs: ["Outputs", "Documents, presentations, research, and decision records."],
    reviews: ["Reviews", "Human decisions required before work can move forward."],
    agents: ["Agents", "Available agents, responsibilities, and current activity."],
    skills: ["Skills", "Capabilities the Workroom can apply to an engagement."],
    templates: ["Templates", "Reusable processes promoted from proven work."],
  };
  const [title, description] = labels[activeNav] ?? labels.home;
  return (
    <main className="placeholder-view">
      <span className="placeholder-icon"><IconLayoutDashboard size={26} /></span>
      <h1>{title}</h1>
      <p>{description}</p>
      <button onClick={onReturn} type="button">Return to David engagement</button>
    </main>
  );
}

export default function OperatingDashboard({
  activeEpisodeId: activeEpisodeIdProp,
  embedded = false,
  episodes: episodesProp,
  onProposal,
  onCreateEpisodeFromProposal,
  onNewConversation,
  onOpenCanvas,
  onPersistConversation,
  onSelectEpisode,
}) {
  const [activeNav, setActiveNav] = useState("work");
  const [localEpisodes] = useState(() => []);
  const episodes = episodesProp ?? localEpisodes;
  const [localActiveEpisodeId, setLocalActiveEpisodeId] = useState(() => episodes[0]?.id ?? null);
  const isEpisodeControlled = activeEpisodeIdProp !== undefined;
  const activeEpisodeId = isEpisodeControlled ? activeEpisodeIdProp : localActiveEpisodeId;
  const [columns, setColumns] = useState(getStoredColumns);
  const [attachedSources, setAttachedSources] = useState([]);
  const [includeSources, setIncludeSources] = useState(false);
  const [sourcesBusy, setSourcesBusy] = useState(false);
  const [model, setModel] = useState(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [workingIds, setWorkingIds] = useState([]);
  const [messages, setMessages] = useState(() => conversationMessagesFromEpisode(episodes.find((episode) => episode.id === activeEpisodeId) ?? null));
  const [isResponding, setIsResponding] = useState(false);
  const [proposedPlan, setProposedPlan] = useState(null);
  const [episodeProposal, setEpisodeProposal] = useState(null);
  const [codexThreadId, setCodexThreadId] = useState(null);
  const [toast, setToast] = useState("");
  const [priorityMode, setPriorityMode] = useState(false);
  const dashboardEventSourceRef = useRef(null);
  const activeEpisode = useMemo(() => activeEpisodeId ? episodes.find((episode) => episode.id === activeEpisodeId) ?? null : null, [activeEpisodeId, episodes]);
  const engagementContext = useMemo(() => activeEpisode ? {
    title: activeEpisode.name || activeEpisode.title,
    episodeId: activeEpisode.id,
    summary: activeEpisode.context,
    stageLabel: EPISODE_STAGE_LABELS[activeEpisode.currentStage] ?? EPISODE_STAGE_LABELS[0],
    sources: attachedSources.map((source) => ({ name: source.fileName, meta: `${source.charCount.toLocaleString()} extracted characters` })),
    decisions: (Array.isArray(activeEpisode.additions) ? activeEpisode.additions : [])
      .filter((item) => item.kind === "decision")
      .map((item) => item.title || item.body)
      .filter(Boolean)
      .slice(0, 5),
  } : null, [activeEpisode, attachedSources]);

  useEffect(() => {
    setMessages(conversationMessagesFromEpisode(activeEpisode));
    const proposal = activeEpisode?.intake?.proposal ?? null;
    setEpisodeProposal(proposal);
    setProposedPlan(proposal ? previewFromEpisodeProposal(proposal) : null);
    setColumns(proposal ? columnsFromEpisodeProposal(proposal) : INITIAL_COLUMNS);
  }, [activeEpisode?.id]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ columns }));
  }, [columns]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => () => dashboardEventSourceRef.current?.close(), []);

  useEffect(() => {
    let cancelled = false;
    if (!activeEpisode?.sources?.length) return undefined;
    Promise.all(activeEpisode.sources.map(async (source) => {
      const stored = await getEpisodeSource(source.sourceId).catch(() => null);
      return stored ? { ...source, ...stored } : source;
    })).then((sources) => {
      if (cancelled) return;
      setAttachedSources(sources.filter((source) => source.text?.trim()));
      // Episode sources are available as context, but the human must explicitly
      // include their text in a turn before Codex receives it.
      setIncludeSources(false);
    });
    return () => { cancelled = true; };
  }, [activeEpisode]);

  const allTasks = useMemo(() => Object.values(columns).flat(), [columns]);
  const hasProposedPlan = Boolean(proposedPlan);
  const hasEngagementContext = Boolean(
    engagementContext && (engagementContext.summary?.trim() || engagementContext.sources.length > 0),
  );

  function navigate(id) {
    setActiveNav(id);
  }

  function selectEpisode(episodeId) {
    if (episodeId === activeEpisodeId) return;
    if (isEpisodeControlled) onSelectEpisode?.(episodeId);
    else setLocalActiveEpisodeId(episodeId);
    setActiveNav("work");
    setMessages([]);
    setProposedPlan(null);
    setEpisodeProposal(null);
    setColumns(INITIAL_COLUMNS);
    setSelectedTask(null);
    setCodexThreadId(null);
    setWorkingIds([]);
    setPriorityMode(false);
    setAttachedSources([]);
    setIncludeSources(false);
    setContextOpen(false);
  }

  function startNewConversation() {
    onNewConversation?.();
    if (!isEpisodeControlled) setLocalActiveEpisodeId(null);
    setActiveNav("work");
    setMessages([]);
    setProposedPlan(null);
    setEpisodeProposal(null);
    setColumns(INITIAL_COLUMNS);
    setSelectedTask(null);
    setCodexThreadId(null);
    setWorkingIds([]);
    setPriorityMode(false);
    setAttachedSources([]);
    setIncludeSources(false);
    setContextOpen(false);
  }

  function dragStart(event, taskId, columnId) {
    setDragging({ taskId, columnId });
    event.dataTransfer.effectAllowed = "move";
  }

  function dropTask(event, targetColumn) {
    event.preventDefault();
    if (!dragging || dragging.columnId === targetColumn) return;
    const task = columns[dragging.columnId].find((item) => item.id === dragging.taskId);
    if (!task) return;
    setColumns((current) => ({
      ...current,
      [dragging.columnId]: current[dragging.columnId].filter((item) => item.id !== dragging.taskId),
      [targetColumn]: [...current[targetColumn], task],
    }));
    setDragging(null);
    setToast(`Moved “${task.title}” to ${targetColumn === "now" ? "Now" : targetColumn === "next" ? "Next" : "Needs review"}.`);
  }

  function selectTask(task) {
    setSelectedTask(task);
    if (hasEngagementContext) setContextOpen(true);
  }

  function addAction(columnId) {
    const count = allTasks.length + 1;
    const task = {
      id: `action-${Date.now()}`,
      title: `New action ${count}`,
      description: "Define the purpose and expected result with SSI Agent.",
      output: "To be defined",
      outputType: "Action",
      state: columnId === "review" ? "Human review" : "Draft",
    };
    setColumns((current) => ({ ...current, [columnId]: [...current[columnId], task] }));
    selectTask(task);
    setToast("Action added. Use the conversation to refine it.");
  }

  async function attachSources(files) {
    setSourcesBusy(true);
    try {
      const extracted = await Promise.all(files.slice(0, 10 - attachedSources.length).map(extractSourceFile));
      setAttachedSources((current) => [...current, ...extracted]);
      setIncludeSources(true);
      setContextOpen(true);
      setToast(`${extracted.length} source${extracted.length === 1 ? "" : "s"} attached and included in this conversation. You can turn this off in the composer.`);
    } catch (error) {
      setToast(error.message || "A source could not be attached.");
    } finally {
      setSourcesBusy(false);
    }
  }

  function beginWork() {
    if (!hasProposedPlan || !episodeProposal) return;
    onProposal?.(episodeProposal, { accept: true });
    onOpenCanvas?.();
    setToast("Workflow proposal accepted. Review the Episode canvas before starting First Mate.");
  }

  async function sendMessage(text) {
    const userMessage = { id: createId("message"), role: "human", text };
    const conversation = [...messages, userMessage];
    setMessages(conversation);
    if (activeEpisode?.id) onPersistConversation?.({ episodeId: activeEpisode.id, messages: conversation, codexThreadId, sourceIds: attachedSources.map((source) => source.sourceId), status: "pending" });
    setIsResponding(true);
    try {
      const response = await fetch("/api/codex/dashboard-conversation/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: text,
          messages: conversation.map((message) => ({ role: message.role, content: message.text })),
          codexThreadId,
          model,
          episode: activeEpisode ? {
            id: activeEpisode.id,
            name: activeEpisode.name,
            title: activeEpisode.title,
            context: activeEpisode.context,
            currentStage: activeEpisode.currentStage,
            status: activeEpisode.status,
            sourceIds: activeEpisode.sources.map((source) => source.sourceId),
            knownDecisions: engagementContext?.decisions ?? [],
          } : null,
          sources: includeSources ? attachedSources.map(sourceForConversation) : [],
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.runId) throw new Error(result.message || "Local Codex runtime unavailable.");
      const eventSource = new EventSource(`/api/codex/runs/${result.runId}/events`);
      dashboardEventSourceRef.current = eventSource;
      eventSource.onmessage = (event) => {
        const update = JSON.parse(event.data);
        if (update.type === "completed") {
          const agentMessage = { id: createId("response"), role: "agent", text: update.response, analysis: update.analysis, actions: update.nextActions ?? [], model: update.model };
          setMessages((current) => [...current, agentMessage]);
          setCodexThreadId(update.threadId ?? null);
          if (activeEpisode?.id) onPersistConversation?.({ episodeId: activeEpisode.id, messages: [...conversation, agentMessage], codexThreadId: update.threadId ?? codexThreadId, sourceIds: attachedSources.map((source) => source.sourceId), status: "complete" });
          if (update.episodeProposal) {
            setEpisodeProposal(update.episodeProposal);
            setProposedPlan(previewFromEpisodeProposal(update.episodeProposal));
            setColumns(columnsFromEpisodeProposal(update.episodeProposal));
            if (activeEpisode?.id) onProposal?.(update.episodeProposal);
            else onCreateEpisodeFromProposal?.(update.episodeProposal, { messages: [...conversation, agentMessage], codexThreadId: update.threadId ?? null, sources: attachedSources });
          }
          setIsResponding(false);
          eventSource.close();
          dashboardEventSourceRef.current = null;
        }
        if (["error", "cancelled"].includes(update.type)) {
          setMessages((current) => [...current, { id: createId("response-error"), role: "agent", text: update.message ?? "I could not complete that response." }]);
          setIsResponding(false);
          eventSource.close();
          dashboardEventSourceRef.current = null;
        }
      };
      eventSource.onerror = () => {
        if (eventSource.readyState === EventSource.CLOSED) return;
        setMessages((current) => [...current, { id: createId("response-error"), role: "agent", text: "The local Codex connection ended before a response was returned." }]);
        setIsResponding(false);
        eventSource.close();
        dashboardEventSourceRef.current = null;
      };
    } catch (error) {
      setMessages((current) => [...current, { id: createId("response-error"), role: "agent", text: error.message || "I could not start a Codex response." }]);
      setIsResponding(false);
    }
  }

  if (activeNav !== "work") {
    return (
      <div className={`operating-dashboard ${embedded ? "is-embedded" : ""}`}>
        {!embedded ? <Sidebar activeEpisodeId={activeEpisodeId} activeNav={activeNav} episodes={episodes} isNewConversation={!activeEpisodeId} onNavigate={navigate} onNewConversation={startNewConversation} onSelectEpisode={selectEpisode} /> : null}
        <PlaceholderView activeNav={activeNav} onReturn={() => navigate("work")} />
      </div>
    );
  }

  return (
    <div className={`operating-dashboard ${embedded ? "is-embedded" : ""} ${hasEngagementContext && contextOpen ? "has-context" : ""}`}>
      {!embedded ? <Sidebar activeEpisodeId={activeEpisodeId} activeNav={activeNav} episodes={episodes} isNewConversation={!activeEpisodeId} onNavigate={navigate} onNewConversation={startNewConversation} onSelectEpisode={selectEpisode} /> : null}

      <main className="outcome-desk">
        <header className="desk-header">
          <div>
            <h1>Outcome Desk</h1>
            <p className="desk-subtitle">Systems Shaper SSI Workroom</p>
          </div>
          <div className="desk-actions">
            {hasProposedPlan ? (
              <>
                <button
                  className={`secondary-action ${priorityMode ? "is-active" : ""}`}
                  onClick={() => setPriorityMode((current) => !current)}
                  type="button"
                >
                  <IconAdjustmentsHorizontal size={17} />
                  {priorityMode ? "Finish prioritizing" : "Adjust priorities"}
                </button>
                <button className="primary-action" onClick={beginWork} type="button">
                  <IconLayoutDashboard size={17} />
                  Create workflow canvas
                </button>
              </>
            ) : null}
            {hasEngagementContext && !contextOpen ? (
              <button className="icon-action" aria-label="Open engagement context" onClick={() => setContextOpen(true)} type="button">
                <IconBook2 size={19} />
              </button>
            ) : null}
          </div>
        </header>

        <div className="desk-scroll-region">
          <Conversation isResponding={isResponding} messages={messages} />

          {hasProposedPlan ? <section className={`recommended-work ${priorityMode ? "is-prioritizing" : ""}`}>
            <div className="section-heading">
              <div>
                <span className="section-kicker"><IconCheckupList size={17} /> Recommended work</span>
                <h2>{proposedPlan.title}</h2>
                <p>{proposedPlan.summary}</p>
              </div>
              <span className="plan-status"><IconClock size={15} /> Proposed plan</span>
            </div>

            <div className="outcome-board">
              <WorkColumn
                accent="now"
                id="now"
                onAdd={addAction}
                onDragStart={dragStart}
                onDrop={dropTask}
                onSelect={selectTask}
                selectedTask={selectedTask}
                subtitle="Start with grounded understanding"
                tasks={columns.now}
                title="Now"
                workingIds={workingIds}
              />
              <WorkColumn
                accent="next"
                id="next"
                onAdd={addAction}
                onDragStart={dragStart}
                onDrop={dropTask}
                onSelect={selectTask}
                selectedTask={selectedTask}
                subtitle="Prepare the likely next outputs"
                tasks={columns.next}
                title="Next"
                workingIds={workingIds}
              />
              <WorkColumn
                accent="review"
                id="review"
                onAdd={addAction}
                onDragStart={dragStart}
                onDrop={dropTask}
                onSelect={selectTask}
                selectedTask={selectedTask}
                subtitle="Human decisions before work ships"
                tasks={columns.review}
                title="Needs review"
                workingIds={workingIds}
              />
            </div>
          </section> : null}
        </div>

        <Composer
          attachedSources={attachedSources}
          disabled={isResponding}
          includeSources={includeSources}
          model={model}
          onAttachSources={attachSources}
          onModelChange={setModel}
          onRemoveSource={(sourceId) => setAttachedSources((current) => current.filter((source) => source.sourceId !== sourceId))}
          onSend={sendMessage}
          onToggleSources={setIncludeSources}
          sourcesBusy={sourcesBusy}
        />
      </main>

      {hasEngagementContext ? <ContextPanel
        context={engagementContext}
        onClose={() => setContextOpen(false)}
        open={contextOpen}
        selectedTask={selectedTask}
      /> : null}

      {toast ? <div className="operating-toast"><IconCircleCheck size={18} /> {toast}</div> : null}
    </div>
  );
}
