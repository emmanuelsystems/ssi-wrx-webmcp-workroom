# Repository Guidelines

## Project Structure & Module Organization

This repository is a Vite + React single-page application.

- `src/App.jsx` contains the episode model, three-stage workflow, React Flow canvas, persistence, drawer interactions, and WebMCP tools.
- `src/App.css`, `src/index.css`, and `src/NewEpisodemodal.css` contain the existing visual system and component styles.
- `src/NewEpisodeModal.jsx` contains the new-episode form; `src/main.jsx` is the React entry point.
- `public/` holds static icons and the favicon. `assets/` holds README screenshots. `scripts/initialize.mjs` starts Vite and opens the local app.
- There is currently no test directory or automated test framework.

## Build, Test, and Development Commands

Run these commands from the repository root:

```bash
npm install          # Install dependencies
npm run dev          # Start the Vite development server
npm run initialize   # Start Vite and open the local Workroom
npm run build        # Create a production build in dist/
npm run preview      # Serve the production build locally
npm run lint         # Run Oxlint
```

Before submitting changes, run `npm run build` and `npm run lint`. Validate interactive behavior manually in a modern browser when changing canvas, drawer, WebMCP, or localStorage behavior.

## Coding Style & Naming Conventions

Use the existing JavaScript/JSX style: two-space indentation, semicolons, trailing commas in multiline structures, and small focused React components. Use `PascalCase` for components, `camelCase` for functions and variables, and descriptive kebab-case CSS classes. Keep stage definitions centralized in `EPISODE_STAGES` and preserve the existing visual design.

## Testing Guidelines

No automated test suite or coverage requirement is configured. For UI changes, check episode switching, stage navigation, node dragging, drawer conversations, and responsive layout as applicable. For WebMCP or persistence changes, verify tool schemas, human authority boundaries, and compatibility with existing localStorage keys.

## Commit & Pull Request Guidelines

Use short, imperative commit subjects consistent with project history, such as `Add ...`, `Keep ...`, or `Document ...`. Pull requests should explain the behavior changed, list validation commands, link related issues when applicable, and include screenshots or a short recording for visible UI changes. Keep changes local unless remote updates are explicitly requested.

## Architecture & Safety Notes

The app is local-first: episode data is stored in browser localStorage and has no backend or authentication. Agent tools may add inspectable evidence, proposals, evaluations, or thread responses, but must not advance stages or record final human disposition. Preserve the WebMCP tool names and schemas, the three-stage episode model, node-thread behavior, localStorage compatibility, and human-owned controls.
