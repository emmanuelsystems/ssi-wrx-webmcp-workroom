# SSI-WRX WebMCP Workroom

SSI-WRX Workroom is a local-first decision workflow for making evidence, agent reasoning, human questions, and final human disposition visible in one place. It is built as a Vite + React single-page application and uses React Flow to render the episode workflow as an interactive node canvas.

## What the workroom does

The workroom organizes work into **episodes**. An episode is a bounded piece of work that moves through three stages:

1. **Understand the work** — capture the episode, relevant context, workflow, evidence, hidden judgment, authority boundaries, constraints, and unknowns.
2. **Evaluate / validate** — inspect evidence, gaps, conflicts, risks, and agent recommendations before human review.
3. **Human disposition** — a human reviews the retained work and chooses what happens next.

The agent can add evidence, recommendations, evaluations, and questions for a human. It cannot advance an episode, pause or stop the workflow, or record the final disposition through WebMCP. Those controls remain in the UI and are human-owned.

## Main UI concepts

- **Episode sidebar** — switch between episodes or create a new one.
- **Episode tree** — navigate between unlocked workflow stages and their core nodes.
- **React Flow canvas** — inspect the current stage, move nodes, and see branches added by agents.
- **Node conversations** — ask or answer questions attached to a node. Pending questions are shown as thread nodes.
- **Stage gates** — advance the active episode manually when the current stage is ready.
- **Human disposition** — record the final human-owned outcome from the last stage.

## WebMCP tools

The app registers tools through [`use-webmcp-tool`](https://github.com/GoogleChromeLabs/use-webmcp-tool). In a browser that supports WebMCP, an agent can discover and call these tools through `document.modelContext`:

| Tool | Purpose | Mutates workroom state? |
| --- | --- | --- |
| `list_episodes` | List episode IDs, titles, stages, status, and disposition | No |
| `get_episode` | Inspect an episode, its current core nodes, branches, and disposition | No |
| `get_node_thread` | Read the complete history for a node thread | No |
| `get_pending_node_prompts` | Find pending human questions and their conversation history | No |
| `respond_to_node_prompt` | Append an agent response to a pending thread | Yes |
| `add_evidence` | Add an evidence branch to the active or selected episode | Yes |
| `propose_action` | Add an agent recommendation and reasoning branch | Yes |
| `evaluate_proposal` | Add an evaluation branch with verdict, confidence, conflicts, risks, and missing evidence | Yes |

The read-only tools are marked with `readOnlyHint: true`. Write tools only add or answer inspectable branches; they do not advance stages or make the final human decision.

## Data model and persistence

Episode data is stored in the browser under the `localStorage` key `ssi-wrx-workroom-v4`. The stored collection contains:

- episode metadata: `id`, `title`, `context`, `currentStage`, `status`, and `disposition`;
- saved node positions in `layouts`; and
- agent or human additions in `additions`, including evidence, proposals, evaluations, and threaded conversations.

There is no backend, database, authentication, or server API in this repository. Data is therefore specific to the current browser profile and origin. The app loads the bundled example episodes when no saved data exists and includes compatibility loading for older `v3` and `ssi-wrx-multi-episode-v1` storage keys.

## Getting started

### Requirements

- Node.js with npm
- A modern browser; WebMCP features require a browser or agent integration that supports the WebMCP API

### Install dependencies

```bash
npm install
```

### Start the development server

```bash
npm run dev
```

Vite will print the local URL, normally `http://localhost:5173`.

### Other commands

```bash
npm run build    # Create a production build in dist/
npm run preview  # Serve the production build locally
npm run lint     # Run Oxlint
```

## Project structure

```text
.
├── src/
│   ├── App.jsx              # Workflow model, UI, persistence, and WebMCP tools
│   ├── App.css              # Workroom and React Flow styling
│   ├── NewEpisodeModal.jsx  # New episode form
│   ├── NewEpisodemodal.css  # New episode modal styles
│   ├── index.css             # Global styles and theme variables
│   └── main.jsx              # React entry point
├── public/                  # Static icons and favicon
├── index.html               # HTML shell and document title
├── vite.config.js            # Vite React configuration
└── package.json              # Scripts and dependencies
```

## Development notes

- `EPISODE_STAGES` in `src/App.jsx` is the source of truth for stage names, descriptions, core nodes, and base edges.
- Episode updates are kept in React state and serialized to `localStorage` after changes.
- React Flow node positions are saved per episode and stage when a node is dragged.
- IDs for new episodes and additions are generated in the browser. New episodes use the next `E0-###` number; branch and thread IDs use UUIDs.
- The app intentionally keeps agent contributions separate from human disposition so the workflow remains inspectable and human-controlled.

## Current scope

This repository is a frontend workroom/prototype. It does not currently provide multi-user synchronization, server-side persistence, account management, automated stage advancement, or a deployment configuration.
