# SSI-WRX WebMCP Governed Three-Tool Design Contract

**Status:** DESIGN ONLY / NOT IMPLEMENTATION AUTHORIZATION  
**Evidence cutoff:** 2026-09-06  
**Source baseline:** `feature/intent-led-operating-dashboard` @ `929a706a074b0554b9af1706afdb838bd3b3cad1`  
**Source-derived registry:** `docs/webmcp-capability-registry.yaml`

## Purpose

Define the smallest reviewable contract for the next governed WebMCP slice:

```text
list_episodes
→ get_episode_context
→ propose_evidence
→ PENDING_HUMAN_REVIEW
→ human accept / revise / reject
→ immutable receipt
→ idempotent replay
```

This document does not authorize implementation, does not replace the current Workroom state model, and does not reinterpret the existing `add_evidence` tool as proposal-only behavior.

## Existing-state constraints

The current source baseline already exposes `list_episodes` and `get_episode` as read-only tools. It exposes `add_evidence` as a mutating evidence write. The exact target tools `get_episode_context` and `propose_evidence` do not currently exist.

The repository's standing authority boundary remains unchanged:

- agents may contribute inspectable evidence, proposals, evaluations, and thread responses;
- agents may not accept workflow structure;
- agents may not advance Episode stages;
- agents may not record final human disposition.

Any implementation of this contract must preserve those boundaries and existing local persistence compatibility unless an Owner Decision explicitly changes them.

## Consequence classes

| Class | Meaning | Human approval before invocation? | May alter accepted/trusted Episode state? |
| --- | --- | --- | --- |
| `READ_ONLY` | Reads a projection of current state | No | No |
| `PROPOSAL_WRITE` | Creates an inspectable candidate for review | No | No |
| `HUMAN_DECISION` | Human accepts, revises, or rejects a proposal | Yes; the human action is the authority event | Only on explicit accept/revise according to the final implementation contract |

The three WebMCP tools in this slice are limited to `READ_ONLY` or `PROPOSAL_WRITE`.

---

# 1. `list_episodes`

## Intent

Return enough Episode identity and progress information for an agent to select an Episode for inspection without exposing a mutation path.

## Authority

- Consequence class: `READ_ONLY`
- No human approval required to invoke.
- Must not mutate Episode state, browser persistence, activity history, stage, disposition, or proposal state.

## Input schema

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

## Output contract

```json
{
  "schema_version": "1.0",
  "episodes": [
    {
      "episode_id": "E0-001",
      "name": "Example Episode",
      "title": "Example Episode title",
      "status": "active",
      "current_stage": 0,
      "disposition": null,
      "review_state": "NONE"
    }
  ]
}
```

`review_state` is a projection only. It must not create or modify proposal state during the read.

## Failure states

- `READ_FAILED`
- `STATE_UNAVAILABLE`
- `SCHEMA_SERIALIZATION_FAILED`

A read failure must return an error result; it must not attempt repair by mutating state.

---

# 2. `get_episode_context`

## Intent

Return a bounded, canonical projection of one Episode for reasoning. This is a read contract, not a new state store.

## Authority

- Consequence class: `READ_ONLY`
- No human approval required to invoke.
- Must not mutate Episode state, proposal state, stage, disposition, threads, or persistence.

## Input schema

```json
{
  "type": "object",
  "properties": {
    "episode_id": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": ["episode_id"],
  "additionalProperties": false
}
```

The target contract intentionally requires an explicit `episode_id`; it does not inherit the current `get_episode` behavior of optionally falling back to the active Episode.

## Output contract

```json
{
  "schema_version": "1.0",
  "episode": {
    "episode_id": "E0-001",
    "name": "Example Episode",
    "title": "Example Episode title",
    "status": "active",
    "current_stage": 0,
    "disposition": null,
    "context": "...",
    "core_nodes": [],
    "accepted_additions": [],
    "conversation_summary": [],
    "source_manifest": [],
    "pending_review_count": 0
  },
  "state_ref": {
    "episode_id": "E0-001",
    "identity": "IMPLEMENTATION_DEFINED_OPAQUE_STATE_ID"
  }
}
```

### Projection rules

- Return existing Workroom state; do not create a second canonical representation.
- `accepted_additions` must exclude proposal-only records that have not been accepted by a human.
- `source_manifest` should describe attached sources without requiring raw source bodies unless the implementation explicitly supports bounded source retrieval.
- `state_ref.identity` must be stable enough to detect stale review/accept operations. Its exact representation is intentionally unresolved here.

## Failure states

- `EPISODE_NOT_FOUND`
- `READ_FAILED`
- `STATE_UNAVAILABLE`
- `SCHEMA_SERIALIZATION_FAILED`

---

# 3. `propose_evidence`

## Intent

Allow an agent to submit evidence for human review without silently inserting it into accepted/trusted Episode evidence.

This is not a rename of the current `add_evidence` behavior.

## Authority

- Consequence class: `PROPOSAL_WRITE`
- Agent may invoke without pre-approval only because the result is non-authoritative and remains pending review.
- Invocation must not advance stage, set disposition, accept evidence, or otherwise alter trusted workflow state.

## Input schema

```json
{
  "type": "object",
  "properties": {
    "episode_id": {
      "type": "string",
      "minLength": 1
    },
    "title": {
      "type": "string",
      "minLength": 1
    },
    "finding": {
      "type": "string",
      "minLength": 1
    },
    "source": {
      "type": "string",
      "minLength": 1
    },
    "parent_node_id": {
      "type": ["string", "null"]
    },
    "state_ref": {
      "type": "string",
      "minLength": 1
    },
    "idempotency_key": {
      "type": "string",
      "minLength": 8
    }
  },
  "required": [
    "episode_id",
    "title",
    "finding",
    "source",
    "state_ref",
    "idempotency_key"
  ],
  "additionalProperties": false
}
```

## Output contract

```json
{
  "schema_version": "1.0",
  "proposal": {
    "proposal_id": "proposal-...",
    "episode_id": "E0-001",
    "kind": "evidence",
    "status": "PENDING_HUMAN_REVIEW",
    "title": "...",
    "finding": "...",
    "source": "...",
    "parent_node_id": null,
    "created_at": "ISO-8601",
    "created_by": {
      "kind": "agent",
      "client": "IMPLEMENTATION_DEFINED"
    }
  },
  "receipt": {
    "receipt_id": "receipt-...",
    "tool": "propose_evidence",
    "consequence_class": "PROPOSAL_WRITE",
    "idempotency_key": "...",
    "state_before_ref": "...",
    "state_after_ref": "...",
    "accepted_state_changed": false
  }
}
```

## Required invariants

1. A successful call creates a proposal with status exactly `PENDING_HUMAN_REVIEW`.
2. Accepted/trusted evidence is unchanged by the proposal call.
3. Stage and disposition are unchanged.
4. The proposal remains inspectable until a human decision occurs.
5. The tool returns an immutable invocation receipt.
6. Replaying the same `idempotency_key` with the same normalized payload returns the existing proposal/result rather than creating a duplicate.
7. Reusing the same `idempotency_key` with a different normalized payload returns `IDEMPOTENCY_CONFLICT` and creates nothing.
8. If `state_ref` is stale, the implementation must not silently accept the stale proposal as if it were based on the current Episode state. The minimum safe behavior is `STALE_STATE` or an explicitly marked stale proposal requiring review.

## Failure states

- `EPISODE_NOT_FOUND`
- `INVALID_SCHEMA`
- `INVALID_PARENT_NODE`
- `STALE_STATE`
- `IDEMPOTENCY_CONFLICT`
- `PROPOSAL_WRITE_FAILED`
- `AUTHORITY_VIOLATION`

An `AUTHORITY_VIOLATION` must be returned if an implementation path would directly mutate accepted evidence, stage, or disposition while handling `propose_evidence`.

---

# Proposal lifecycle

```text
PROPOSED
  ↓ successful propose_evidence
PENDING_HUMAN_REVIEW
  ├─ human reject  → REJECTED
  ├─ human revise  → REVISION_REQUIRED / revised proposal
  └─ human accept  → ACCEPTED + explicit trusted-state transition
```

The proposal and the human decision are separate authority events.

## Human accept

A human accept action may create accepted evidence only through an explicit human-owned transition. It must produce a separate immutable decision/state-transition receipt containing before/after state identity.

## Human reject

Reject must not alter accepted evidence. The rejected proposal remains inspectable as historical review evidence unless a future retention policy explicitly decides otherwise.

## Human revise

Revision must not rewrite history invisibly. The implementation should preserve the original proposal and link any revised proposal or human-edited candidate to it.

The exact UI and physical persistence representation for these human actions are intentionally not defined here.

---

# Receipt contract

Every mutating or authority-bearing action in this slice should be representable by a receipt with at least:

```json
{
  "receipt_id": "...",
  "schema_version": "1.0",
  "timestamp": "ISO-8601",
  "episode_id": "E0-001",
  "tool_or_action": "propose_evidence",
  "consequence_class": "PROPOSAL_WRITE",
  "actor": {
    "kind": "agent",
    "client": "..."
  },
  "idempotency_key": "...",
  "input_digest": "IMPLEMENTATION_DEFINED",
  "state_before_ref": "...",
  "state_after_ref": "...",
  "proposal_id": "proposal-...",
  "outcome": "PENDING_HUMAN_REVIEW",
  "accepted_state_changed": false
}
```

Required semantic properties:

- append-only / immutable after issuance;
- sufficient to identify the action, actor, Episode, consequence class, input identity, and before/after state identity;
- does not claim canonical-state mutation when only proposal state changed;
- can be used to demonstrate replay behavior.

The hashing/versioning mechanism for `input_digest` and state identity is an implementation decision, not established by this document.

---

# Idempotent replay acceptance

For `propose_evidence`:

| First call | Replay | Required result |
| --- | --- | --- |
| key A + payload X | key A + payload X | return the original proposal/result; no duplicate |
| key A + payload X | key A + payload Y | `IDEMPOTENCY_CONFLICT`; no mutation |
| key A + payload X failed before persistence | key A + payload X | implementation may retry safely; at most one durable proposal |

Read tools may be repeated freely and must remain mutation-free.

---

# Evaluation procedure for a frozen fixture

Implementation should not be considered ready for authorization until a frozen, sanitized Episode fixture can demonstrate:

```text
1. list_episodes returns the fixture Episode and does not mutate state.
2. get_episode_context returns the expected bounded context and does not mutate state.
3. propose_evidence creates exactly one PENDING_HUMAN_REVIEW proposal.
4. accepted/trusted evidence remains unchanged after proposal creation.
5. stage and disposition remain unchanged.
6. a human can explicitly accept, revise, or reject.
7. accept creates an explicit state transition and immutable before/after receipt.
8. reject leaves accepted state unchanged.
9. same-key replay does not duplicate the proposal or accepted change.
10. same-key/different-payload replay fails closed.
```

This document defines the acceptance semantics only. It does not provide the frozen fixture or claim that the current runtime passes them.

---

# Explicit unresolved Owner Decisions

The following remain outside this design-only change:

1. Whether existing `add_evidence` remains available as a direct evidence mutation, is restricted, is deprecated, or is replaced by a proposal path.
2. The physical persistence location and object/event representation for pending proposals and receipts.
3. The exact state identity/version/hash mechanism.
4. Cross-Episode promotion and revalidation rules.
5. Whether accepted evidence is copied, promoted, or referenced from the proposal record.
6. Model-routing policy, including any Astra adoption.
7. Authorization to implement these contracts in the Workroom runtime.

## Non-goals

- no new model dependency;
- no UI redesign;
- no stage/disposition changes;
- no automatic trust promotion;
- no migration of existing localStorage state;
- no reinterpretation of WebMCP workbench success as proof of canonical correctness;
- no broader agent-brief implementation.

## Review question

The next review should answer only:

> Is this three-tool contract sufficiently narrow and authority-safe to authorize implementation against a frozen sanitized Episode fixture?
