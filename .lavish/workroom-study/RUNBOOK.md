# Pstack-style SSI-WRX working-guide screen

## Decision

Does a small pstack-derived working guide improve an agent's ability to reconstruct SSI-WRX faithfully and recommend a useful next action, compared with neutral review guidance?

This evaluates the working guide, not the full pstack plugin and not SSI-WRX product performance.

## Conditions

- **North:** neutral review guidance in `cedar/AGENTS.md`.
- **West:** evidence-led guidance in `harbor/AGENTS.md`, adapted from pstack's context reconstruction, problem restatement, prototype, and verification practices.
- Both receive byte-identical `INPUT.md` files and the same organic request.
- Both use `gpt-5.6-sol` at medium reasoning in fresh ephemeral, read-only sessions with user configuration ignored.
- Neither is told that another response exists or shown the hidden rubric.
- One judge uses `gpt-5.5` at high reasoning, sees both outputs as North and West, and grades them together.

## Organic request

> Read INPUT.md. In no more than 700 words, explain what the current SSI-WRX mechanism actually demonstrates, what remains proposed or incomplete, and recommend the smallest next action that would most reduce uncertainty. Cite INPUT.md section names. Do not edit files.

## Hidden criteria

The judge scores evidence fidelity, authority fidelity, decision quality, test quality, and communication from 0–2. A tie is valid. The root agent then reads both outputs and checks the judge's reasoning.

## Interpretation

- A higher West result with no evidence or authority regression is a signal that the selected pstack practices deserve further trials.
- A tie means no benefit was demonstrated on this task.
- A North win, unsupported claim, or authority regression argues against promoting the guide without revision.
- One pair is a smoke screen. It cannot establish general improvement, cost savings, or suitability of the complete pstack plugin.

## Setup checks completed

- The three copies of the source packet have identical SHA-256 hashes.
- Candidate-visible directories and guidance contain none of pstack's prohibited blinding words.
- The rubric is stored only in the judge directory.
- The task is read-only and the project repository is not modified by either condition.

## Execution status

Completed on September 10, 2026. Both candidate runs and the blinded judge finished successfully. North and West each scored 10/10, producing a tie. See `RESULTS.md` and the retained outputs in `judge/`.
