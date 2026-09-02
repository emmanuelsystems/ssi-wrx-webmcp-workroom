import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconAdjustmentsHorizontal,
  IconArrowRight,
  IconBolt,
  IconBook2,
  IconBriefcase2,
  IconCheck,
  IconCheckupList,
  IconChevronDown,
  IconCircleCheck,
  IconClipboardCheck,
  IconClock,
  IconFile,
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

import "./OperatingDashboard.css";

const STORAGE_KEY = "ssi-wrx-operating-dashboard-v1";

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

const SOURCES = [
  { name: "Client meeting — Sep 1", meta: "58 min · David Kim", icon: IconMicrophone },
  { name: "Meeting transcript", meta: "Generated from recording", icon: IconFileDescription },
  { name: "Client brief.pdf", meta: "2.4 MB", icon: IconFile },
  { name: "Program overview.pdf", meta: "1.1 MB", icon: IconFile },
  { name: "Q4 financials.xlsx", meta: "320 KB", icon: IconFile },
];

const PEOPLE = [
  { initials: "DK", name: "David Kim", role: "Account lead" },
  { initials: "SL", name: "Sarah Lee", role: "Client sponsor" },
  { initials: "MC", name: "Michael Chen", role: "Solutions engineer" },
];

function getStoredColumns() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return stored?.columns ?? INITIAL_COLUMNS;
  } catch {
    return INITIAL_COLUMNS;
  }
}

function Sidebar({ activeNav, onNavigate }) {
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

function ConversationSummary({ messages }) {
  return (
    <section className="conversation-summary" aria-labelledby="conversation-title">
      <div className="conversation-eyebrow">
        <span className="status-dot" />
        Agent conversation
      </div>
      <div className="intent-message">
        <span>You said</span>
        <p>
          David just finished a meeting with a client. Review the meeting and
          materials, identify what matters, and figure out what we should prepare next.
        </p>
      </div>
      <div className="agent-understanding">
        <div className="agent-symbol">
          <IconSparkles aria-hidden="true" size={18} stroke={1.8} />
        </div>
        <div>
          <span className="agent-name">SSI Agent</span>
          <h2 id="conversation-title">What I understand</h2>
          <p>
            David met with Acme Corp to review their Q4 program outcomes and discuss
            expanding the partnership. I’ll ground the work in the meeting and materials,
            surface what matters, and recommend what to prepare next.
          </p>
          <ul>
            <li><IconCheck size={15} /> Focus on outcomes, decisions, and open questions</li>
            <li><IconCheck size={15} /> Surface risks, assumptions, and dependencies</li>
            <li><IconCheck size={15} /> Prepare reviewable outputs before anything ships</li>
          </ul>
          {messages.map((message) => (
            <div className="follow-up-message" key={message.id}>
              <strong>{message.author}</strong>
              <span>{message.text}</span>
            </div>
          ))}
        </div>
      </div>
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

function ContextPanel({ open, selectedTask, onClose }) {
  return (
    <aside className={`context-panel ${open ? "is-open" : ""}`} aria-hidden={!open}>
      <header className="context-header">
        <div>
          <span>Engagement context</span>
          <strong>{selectedTask ? selectedTask.title : "David — Client follow-up"}</strong>
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

      <section className="context-section">
        <div className="context-section-title">
          <span><IconStack2 size={17} /> Sources</span>
          <button type="button">View all</button>
        </div>
        <div className="context-list">
          {SOURCES.map((source) => {
            const Icon = source.icon;
            return (
              <button className="context-row" key={source.name} type="button">
                <span className="context-icon"><Icon size={16} /></span>
                <span><strong>{source.name}</strong><small>{source.meta}</small></span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="context-section">
        <div className="context-section-title">
          <span><IconUsers size={17} /> People</span>
          <button type="button">Manage</button>
        </div>
        <div className="people-list">
          {PEOPLE.map((person) => (
            <div className="person-row" key={person.name}>
              <span className="person-avatar">{person.initials}</span>
              <span><strong>{person.name}</strong><small>{person.role}</small></span>
            </div>
          ))}
        </div>
      </section>

      <section className="context-section decisions-section">
        <div className="context-section-title">
          <span><IconClipboardCheck size={17} /> Known decisions</span>
        </div>
        <ul>
          <li>Phase 1 scope approved</li>
          <li>Data integration approach selected</li>
          <li>Q4 pilot timeline agreed</li>
        </ul>
      </section>
    </aside>
  );
}

function Composer({ onSend, disabled }) {
  const [value, setValue] = useState("");
  const inputRef = useRef(null);

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
      <button aria-label="Attach source" className="composer-tool" type="button">
        <IconPaperclip size={19} />
      </button>
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
      <button aria-label="Send message" className="composer-send" disabled={!value.trim()} type="submit">
        <IconSend2 size={18} />
      </button>
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

export default function OperatingDashboard() {
  const [activeNav, setActiveNav] = useState("work");
  const [columns, setColumns] = useState(getStoredColumns);
  const [contextOpen, setContextOpen] = useState(true);
  const [selectedTask, setSelectedTask] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [workingIds, setWorkingIds] = useState([]);
  const [messages, setMessages] = useState([]);
  const [toast, setToast] = useState("");
  const [priorityMode, setPriorityMode] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ columns }));
  }, [columns]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const allTasks = useMemo(() => Object.values(columns).flat(), [columns]);

  function navigate(id) {
    setActiveNav(id);
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
    setContextOpen(true);
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

  function beginWork() {
    if (workingIds.length) {
      setToast("The recommended work is already in progress.");
      return;
    }
    const ids = columns.now.map((task) => task.id);
    setWorkingIds(ids);
    setToast("Recommended work started. Human approvals remain required.");
  }

  function sendMessage(text) {
    const userMessage = { id: createId("message"), author: "You", text };
    setMessages((current) => [...current, userMessage]);
    window.setTimeout(() => {
      setMessages((current) => [
        ...current,
        {
          id: createId("response"),
          author: "SSI Agent",
          text: "I’ve captured that direction. The plan remains a proposal until you begin the selected work.",
        },
      ]);
    }, 550);
  }

  if (activeNav !== "work") {
    return (
      <div className="operating-dashboard">
        <Sidebar activeNav={activeNav} onNavigate={navigate} />
        <PlaceholderView activeNav={activeNav} onReturn={() => navigate("work")} />
      </div>
    );
  }

  return (
    <div className={`operating-dashboard ${contextOpen ? "has-context" : ""}`}>
      <Sidebar activeNav={activeNav} onNavigate={navigate} />

      <main className="outcome-desk">
        <header className="desk-header">
          <div>
            <h1>Outcome Desk</h1>
            <p className="desk-subtitle">Systems Shaper SSI Workroom</p>
          </div>
          <div className="desk-actions">
            <button
              className={`secondary-action ${priorityMode ? "is-active" : ""}`}
              onClick={() => setPriorityMode((current) => !current)}
              type="button"
            >
              <IconAdjustmentsHorizontal size={17} />
              {priorityMode ? "Finish prioritizing" : "Adjust priorities"}
            </button>
            <button className="primary-action" onClick={beginWork} type="button">
              {workingIds.length ? <IconLoader2 className="spin" size={17} /> : <IconPlayerPlay size={17} />}
              {workingIds.length ? "Work in progress" : "Begin recommended work"}
            </button>
            {!contextOpen ? (
              <button className="icon-action" aria-label="Open engagement context" onClick={() => setContextOpen(true)} type="button">
                <IconBook2 size={19} />
              </button>
            ) : null}
          </div>
        </header>

        <div className="desk-scroll-region">
          <ConversationSummary messages={messages} />

          <section className={`recommended-work ${priorityMode ? "is-prioritizing" : ""}`}>
            <div className="section-heading">
              <div>
                <span className="section-kicker"><IconCheckupList size={17} /> Recommended work</span>
                <h2>A plan to move the engagement forward</h2>
                <p>Review the sequence, inspect an action, or drag work to reprioritize it.</p>
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
          </section>
        </div>

        <Composer disabled={false} onSend={sendMessage} />
      </main>

      <ContextPanel
        onClose={() => setContextOpen(false)}
        open={contextOpen}
        selectedTask={selectedTask}
      />

      {toast ? <div className="operating-toast"><IconCircleCheck size={18} /> {toast}</div> : null}
    </div>
  );
}
