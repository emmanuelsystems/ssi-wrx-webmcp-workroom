# Repository Guidelines

## Project Structure

This repository is a Vite + React single-page application with no automated test framework.

## Validation

Before submitting changes, run `npm run build`, `npm run lint`, and `git diff --check`. Manually validate changes to canvas, drawer, WebMCP, or localStorage behavior in a modern browser.

## Coding Style & Naming Conventions

Use the existing JavaScript/JSX style: two-space indentation, semicolons, trailing commas in multiline structures, and small focused React components. Use `PascalCase` for components, `camelCase` for functions and variables, and descriptive kebab-case CSS classes. Keep stage definitions centralized in `EPISODE_STAGES` and preserve the existing visual design.

## Testing Guidelines

No automated test suite or coverage requirement is configured. For UI changes, check episode switching, stage navigation, node dragging, drawer conversations, and responsive layout as applicable. For WebMCP or persistence changes, verify tool schemas, human authority boundaries, and compatibility with existing localStorage keys.

## Repository Changes

Do not commit, push, open a pull request, or otherwise update a remote unless explicitly requested.

## Architecture & Safety Notes

The app is local-first and stores episodes in browser localStorage. Agents may add inspectable evidence, proposals, evaluations, or thread responses, but must never advance stages or record final human disposition. Preserve WebMCP tool schemas, the three-stage model, node threads, storage compatibility, and human-owned controls.
