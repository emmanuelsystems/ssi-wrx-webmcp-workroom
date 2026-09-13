# SSI-WRX source packet

## Product contract

SSI-WRX is a local-first decision workroom organized into Episodes with three stages: understand the work, review the evidence, and human disposition. Agents may add inspectable evidence, recommendations, analytical reviews, and conversation responses. Humans alone accept workflow structure, advance stages, and record final disposition. Episode state is stored in browser localStorage; source bodies are stored in IndexedDB. There is no server-side canonical persistence, authentication, multi-user sync, remote deployment, web access, external communication, or operational file editing.

## Current implementation observations

The current source registers eleven WebMCP tools. Three intake tools are absent from the README's eight-tool table.

`submit_episode_structure` validates an agent-supplied structure and stores it with intake status `proposed`. A separate UI function, `acceptEpisodeStructure`, changes intake status to `accepted`, creates workflow nodes and gates, and records a human-authored `proposal.accepted` activity.

`add_evidence` accepts free-text title, finding, source, and optional parent node. It adds a visible Evidence branch. Its description says it cannot advance the stage or make human disposition. It does not implement the separately proposed pending-review, version, idempotency, or immutable before/after receipt contract.

## E0-020 retained evidence report

E0-020 concluded that Astra is an option for a bounded, source-backed trial. It is not an authority or automatic replacement. The record contains no Astra trial result, entitlement check, frozen baseline configuration, or independently verified results record.

The report proposes four future comparison arms: current baseline; Astra with the unchanged harness; Astra-specific configuration; and routed work with an independent verifier. It recommends recording model and settings, context and compaction policy, tool schemas and permissions, input snapshot, retry policy, verifier configuration, traces, failures, human intervention, time, tokens, cost, and safety events.

The proposed next E0-020 action is to create a baseline and trial configuration manifest. Exact thresholds remain a human decision. This report does not authorize promotion, rollout, model replacement, stage advancement, or final disposition.

## Prior analysis

A prior analysis recovered historical August 27 receipts for successful calls that read an Episode, added evidence, proposed an action, and reviewed a proposal. These demonstrate an earlier structured integration, not the later Chrome setup or the proposed governance contract.

The analysis identified a more fundamental uncertainty: whether an independent reviewer can distinguish faithful workflow reconstruction from a plausible account that changes what was known, authorized, or recommended.

## Decision context

No newer scoped implementation authorization is included in this packet. The immediate choice is what small next action would produce the most decision-relevant evidence without treating the current architecture as settled.
