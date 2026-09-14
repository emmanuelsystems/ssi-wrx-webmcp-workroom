# SSI-WRX Workroom visual QA

source visual truth: `/var/folders/n4/z165yd9s72b_mf0_nrlnxfkc0000gp/T/codex-clipboard-426e680f-8506-40a4-a9f0-e04e6f01b5af.png`
implementation evidence: Codex In-app Browser tab 1 at `http://localhost:5173/` (inline CUA captures taken for `E0-016` Overview and Work)
viewport: 1536 × 900 CSS px; source image is 1536 × 1024 px and was used as a hierarchy/layout reference rather than a pixel-density match
state: real local episodes `E0-009`, `E0-016`, and `E0-001`; Overview and Work modes; no fake content added

## Comparison

The approved reference prioritizes the next human action, episode progress, compact status summaries, and lightweight activity. The corrected implementation now follows that order. The large permanent four-plane architecture block and stacked Episode Cockpit are no longer rendered in Overview; their responsibilities are represented by the mode tabs and compact summary cards. Work controls are visible only in Work mode. The latest shell pass adds a real project/episode breadcrumb, last-updated metadata, Codex Ready status when available, and a pinned user footer.

This sidebar-only pass reduces the remaining tree-view density: project groups are compact accordion rows, episodes use a two-line label plus a status dot, workflow children are no longer rendered in the sidebar, and creation is behind one truthful `+` menu. The active project is revealed when needed to keep the selected episode discoverable; all other projects remain collapsed.

Follow-up visual fix: project rows now reserve a dedicated count column between the label and real row actions, and the desktop rail is 240px wide so counts remain visible instead of being clipped behind the action buttons.

Header refinement pass: the global shell control is now a compact icon-only button with a truthful tooltip, the repeated top-bar episode badge was removed, and the episode header groups its real Review package action and last-updated metadata above a single compact status row. Title/objective hierarchy remains episode-first, with objective truncation and stacked responsive behavior.

Conversation refinement pass: the main thread now reads as a continuous governed record. Human prompts use a dark speaker bubble, ordinary agent replies use a quiet evidence bubble, structured agent output is grouped into fact/uncertainty/evidence/judgment sections, and governance rules are rendered as a neutral System boundary callout rather than a chat bubble. Pending responses use an amber waiting state, empty conversations stay compact, and the context rail exposes truthful Objective, Scope, Authority, Related work, and Related evidence details with real navigation where available.

Episode-level conversation pass: Conversation now owns one primary episode thread and one episode composer. Existing node threads are retained as Work Subthreads for provenance and inspection. Historical episode chronology is not inferred; episodes without retained primary messages show a truthful transition note. Real workflow nodes and completed review packages appear as compact work/result events with links back to Work or evidence.
Transition fix: the floating node conversation preview is now scoped to Work mode, so closing a Work Subthread cannot overlay or replace the primary episode Conversation.
Fallback polish: low-level runtime responses such as `Not found` now render as a truthful WRX no-answer state with only available Work/evidence actions. Human and WRX bubbles use compact role-aware widths, and event cards cover retained evidence, conflicts, authorization, and human decisions only when those states exist.
Conversation spacing/composer pass: same-speaker messages use a tighter rhythm, speaker changes and events have deliberate separation, and the episode composer is multiline but compact with a clear `Ask WRX` action.

Focused evidence was needed for the header, Overview hero, summary row, sidebar density, and Work toolbar. The inline CUA captures showed the expected dark compact sidebar, light workspace, restrained blue active state, two-column hero, four compact summaries, and contextual canvas controls.

## Findings

- No actionable P0/P1/P2 findings remain.
- P3 follow-up: the decorative reference illustration is intentionally omitted; the handoff asked for hierarchy/layout fidelity and the app has no supplied matching asset.
- P3 follow-up: the active project remains expanded so the selected episode stays discoverable; other project groups are collapsed by default.

## Comparison history

1. Initial implementation: Overview still showed the four-plane architecture block and large Episode Cockpit. This was a P1 hierarchy mismatch.
2. Fix: replaced Overview with an action-first hero, compact progress panel, four summary cards, and Recent activity / Quick actions rows; moved canvas controls into Work mode.
3. Post-fix evidence: Overview and Work were recaptured in the local browser at the same desktop viewport. No P0/P1/P2 findings remained.

## Fidelity surfaces

- Fonts/typography: system/Inter-style stack retained; episode title and next action lead the hierarchy, with compact muted metadata.
- Spacing/layout: 12–16px card rhythm, 22px section padding, two-column hero, and responsive single-column fallback below 820px.
- Colors/tokens: neutral light workspace, dark sidebar, blue primary/action accent, green completion, amber judgment attention; pale green is no longer the structural default.
- Image/assets: no new source imagery was required; supplied reference art remains a non-functional visual reference.
- Copy/content: all counts, statuses, findings, outputs, and actions derive from current episode/run/evidence state.

## Interaction checks

- Overview / Conversation / Work / Review switching: verified.
- Episode selection and sidebar navigation: preserved and verified.
- Work toolbar actions and React Flow canvas: verified.
- Activity, sources, Autopilot review, and human disposition handlers: preserved.
- Latest browser pass verified Conversation on retained, pending, empty, and source-bearing episodes, including real thread, Work, activity, and evidence actions; Overview, Work, and Review remained unchanged outside this refinement scope.
- Latest shell pass verified real E0-009 and E0-016 state in focused episode Overview; project/episode selection updates the header and episode state.
- Workroom-home pass verified the whole-workspace Overview, shared collection counts, attention routing, recent activity, active-by-project summary, and recent episode selection.
- Sidebar pass verified E0-001 default state, E0-016 search selection, accordion behavior across Test Workflows and Governance validation rerun, compact create menu actions, disabled Settings affordance, and collapse/reopen behavior.

## Sidebar interaction matrix

| Control | Expected behavior | Existing handler | Verified |
| --- | --- | --- | --- |
| Overview / Needs review / Active / Drafts / Archive | Route to the Workroom Overview or real collection views | `setCollectionView`, shared collection selectors | PASS |
| Project row | Expand one project and close the prior project | `setExpandedProjects` accordion update | PASS |
| Episode row | Switch the real active episode and reveal its project | `setActiveEpisodeId`, `setExpandedProjects` | PASS |
| Search result | Filter real data and switch episode on selection | `setEpisodeSearch`, episode button handler | PASS |
| Create `+` | Open real New project/New episode actions | `setProjectModalOpen`, `setCreateOpen` | PASS |
| Project / episode menus | Open real rename, move, export, archive, remove actions | Existing menu handlers | PASS |
| Settings | Remain visibly unavailable rather than dead-active | Disabled button with tooltip | PASS |
| Collapse sidebar | Collapse and reopen the navigation rail | `setSidebarOpen` | PASS |

## Header interaction matrix

| Control | Expected behavior | Existing handler | Verified |
| --- | --- | --- | --- |
| Sidebar collapse icon | Collapse / expand the sidebar | `setSidebarOpen` | PASS |
| Project breadcrumb | Informational location context | No click handler; intentionally static | PASS |
| Review package | Enter the real Review mode when a final package exists | `setWorkspaceMode("review")` | PASS |
| Stage / status badges | Display-only current episode state | Derived from episode state | PASS |
| Last updated | Show latest real activity timestamp or `Not recorded` | Derived from `episode.activity` | PASS |

## Conversation interaction matrix

| Control | Expected behavior | Existing handler | Verified |
| --- | --- | --- | --- |
| View activity | Open the real activity drawer | `setActivityOpen(true)` | PASS |
| Open conversation | Open the existing node thread drawer | `setSelectedNodeId`, `setActiveThreadId`, `setDrawerOpen` | PASS |
| Open pending thread | Open the existing pending thread drawer | Same thread handler | PASS |
| Open Work | Switch to Work for the same episode | `setWorkspaceMode("work")` | PASS |
| View evidence | Open the real source library when sources exist | `setSourceLibraryOpen(true)` | PASS / hidden when empty |
| Agent response composer | Existing drawer composer remains available in the opened thread | Existing `ConversationComposer` handler | PRESERVED |

## Episode-level conversation interaction matrix

| Control / state | Expected behavior | Verified |
| --- | --- | --- |
| Episode composer | Sends one primary human message for the active episode and shows a pending WRX response state | PASS |
| Episode switching | Replaces the primary conversation and context with the selected episode without mixing messages | PASS |
| Open Work event | Routes to the existing Work canvas | PASS |
| Review evidence event | Opens the existing episode source library when sources are retained | PASS |
| Work Subthread row | Opens the existing node conversation drawer with node sources, messages, and continuation input | PASS |
| Transitional state | Does not fabricate chronology when only historical node threads exist | PASS |
| Governance | Episode responses are read-only analysis; stage movement, authorization, and disposition remain human-owned | PASS |

## Sidebar screenshot evidence

- Default / collapsed-project state: inline CUA capture after clearing search; only the selected Governance validation rerun project is open.
- Expanded project: inline CUA capture after opening Governance validation rerun; E0-016 and E0-022 are visible as compact rows.
- Selected episode: E0-016 has a restrained left accent and status dot; its real breadcrumb and Overview state update in the main workspace.
- Short viewport: responsive CSS changes the rail into an overlay drawer below 620px while preserving the same collapse/open control.

## Conversation screenshot evidence

- Retained human + agent thread: E0-009 inline CUA capture shows the human question, structured agent sections, and the real Open conversation action.
- System/governance boundary: the same capture shows a neutral bordered System boundary callout with an explicit Agent may not label.
- Pending response: E0-009 inline CUA capture after scrolling shows the amber Awaiting response card and Waiting for agent response state.
- Empty state: E0-011 inline CUA capture shows the compact No conversation retained yet state with the real Open work action.
- Context rail: E0-009 and E0-011 captures show Objective, scrollable Scope, Authority, Related work, and truthful Related evidence states.
- Simple retained thread: E0-001 capture shows ordinary human and agent messages contained in distinct speaker bubbles without changing the existing open-thread action.
- Episode conversation: E0-002 capture shows the single episode composer, pending state, and bounded WRX response with structured headings/bullets.
- Work Subthread drawer: E0-001 historical row opens the existing node drawer, reframed as `Work Subthread`, with node-specific context and continuation controls.
- Work/result events: source-bearing and completed-run episodes expose only compact real-state event cards; raw agent logs remain out of the primary Conversation.

final result: passed

## Work mode refinement pass

- Initial canvas framing now fits primary workflow nodes; `Fit workflow`, `Fit all`, and `Focus selected` controls use the existing React Flow instance and preserve pan/zoom.
- Nodes now expose compact, real status, evidence, result, and human-checkpoint metadata; long findings remain in the inspector/run surfaces.
- Selected nodes use a restrained accent treatment and automatically open/update the existing inspector. The Work Subthread drawer remains the provenance surface, with inspector links for Work Subthread, evidence, activity, and human Review where supported.
- The run inspector can be reopened from the Work toolbar when hidden; the detached floating reopen control was removed.
- Episodes without created work show a truthful empty state with a real `Open Conversation` route.

### Work interaction audit

| Check | Result |
| --- | --- |
| Fit workflow / Fit all / Focus selected | PASS |
| Node selection and inspector update | PASS |
| Status, evidence, result, and human checkpoint metadata | PASS |
| Work Subthread access and continuation | PASS |
| Evidence / activity / Review routing when supported | PASS |
| Empty Work state | PASS |
| Episode switching and Conversation → Work continuity | PASS |

## Workspace queue / collection view pass

Primary sidebar collections now open a truthful workspace queue in the main panel instead of selecting an arbitrary episode. Overview remains the focused home surface; search, project groups, and episode rows still select a focused episode directly.

### Collection semantics

| Collection | Source of truth | Empty behavior | Verified |
| --- | --- | --- | --- |
| My work | Unique episodes needing review, input, or active work | Explains that human-owned requests will appear as work progresses | PASS |
| Needs review | Episodes with an Autopilot final package not yet promoted or rejected | States that no human review is currently waiting | PASS |
| Active | Episodes whose recorded status is `active` | Truthful no-active-episodes state | PASS |
| Drafts | Episodes with `intent-review`, `pending`, or `proposed` intake status | Truthful no-drafts state | PASS |
| Archive | Episodes whose recorded status is `archived` | Truthful no-archived-episodes state | PASS |

### Queue interaction audit

| Check | Result |
| --- | --- |
| Needs review badge matches visible queue count | PASS (3 badge / 3 rows in the current fixture) |
| Collection rows show one clear Review/Open action | PASS |
| Needs review row opens the existing Review shell for the same episode | PASS |
| Active, Drafts, Archive, and My work remain collection surfaces | PASS |
| Search and project episode rows still open focused episodes directly | PASS |
| Selecting an episode clears the collection and preserves the selected episode | PASS |
| No fabricated node-level queue groups or fake events | PASS |

## Review mode refinement pass

Review is now a human decision workspace. The page leads with a derived Decision package, then exposes inspectable retained outputs, explicit evidence, findings, conflicts/risks, interpretation, and a contextual Human decision panel. The governing distinction remains: WRX recommends; human authority decides.

### Recommendation and review-target semantics

- `Revise before validation` is derived when retained package conflicts exist.
- `Request more evidence` is derived when a final package has no retained sources.
- `Promote reviewed package` is shown when a complete package has no unresolved conflict and remains pending human review.
- Promoted/rejected states are shown as recorded human outcomes rather than new recommendations.
- Episodes with no package, outputs, evidence, findings, risks, disposition, or stage-three decision target show a truthful no-review-target state without disposition buttons.

### Review interaction audit

| Check | Result |
| --- | --- |
| Needs review → Review opens the correct episode and review context | PASS |
| Decision package explains recommendation, rationale, readiness, and next action | PASS |
| Retained output count matches inspectable output rows | PASS |
| Output Inspect routes to source/evidence or Work surfaces | PASS |
| Evidence count matches inspectable retained source rows | PASS |
| Zero-evidence fallback avoids implying support and offers Open Work | PASS |
| Findings, conflicts/risks, and interpretation remain grounded in package state | PASS |
| Human actions remain explicit and authoritative | PASS |
| Review → Work preserves episode selection | PASS |

## Workroom overview / navigation-scope pass

Sidebar `Overview` is now a Workroom-wide operational home. It no longer renders the selected episode's Overview component. Focused episode rows and search results still enter the episode shell, where the existing `Overview / Conversation / Work / Review` tabs remain episode-specific.

### Selector and count semantics

The Workroom Overview reuses the same selectors as the sidebar collections: `status === "active"`, intake statuses `intent-review` / `pending` / `proposed`, archived status, and an unpromoted/unrejected Autopilot final package for Needs review. The summary cards therefore stay aligned with the sidebar counts.

### Workroom Overview interaction audit

| Check | Result |
| --- | --- |
| `My work` removed from primary navigation without deleting state | PASS |
| Overview opens Workroom-wide overview with no episode-specific header | PASS |
| Summary counts match sidebar collection selectors | PASS |
| Needs Attention uses real review/input states and routes to episode or review | PASS |
| Recent Activity uses retained high-level episode activity only | PASS |
| Active by Project uses real active episode counts and expands project navigation | PASS |
| Recent Episodes uses real activity timestamps and opens focused episodes | PASS |
| Overview count/attention/recent episode actions remain live controls | PASS |
| Focused episode Overview remains episode-specific after selection | PASS |
| Needs review, Active, Drafts, and Archive collection routes remain intact | PASS |

## Review → bounded follow-up work loop

Review items now expose compact, type-specific actions without changing the accepted Review layout or human authority model:

- Retained-output `Inspect` opens an output detail surface with the actual retained result, review state, reason, source count, prior-output count, originating Work item, and available provenance/evidence links. It no longer falls through to source material by default.
- Evidence keeps the existing source-material modal for `Inspect`, adds contextual `Ask WRX`, and labels bounded follow-up as `Verify evidence`.
- Findings, risks, and conflicts expose `Inspect` and `Ask WRX`; meaningful unresolved items also expose `Work on this` or `Investigate conflict`.
- `Ask WRX` routes to the episode-level Conversation composer with a contextual prompt and does not create work, change stage, or alter disposition.
- Follow-up actions open a proposal surface first. The proposal records objective, why, episode/sources scope, inputs, expected output, authority boundaries, and originating Review item.
- Approval is explicit. It creates a persisted `action` branch under the current episode Work canvas with `createdFrom: "review"`, human-approval metadata, and a Review-origin activity event; no execution or disposition occurs automatically.
- Cancel closes the proposal without mutation. Existing Work Subthreads remain available for provenance.

### Bounded follow-up interaction audit

| Check | Result |
| --- | --- |
| Retained-output Inspect opens output detail rather than only source material | PASS |
| Source Inspect still opens the existing Episode Source Material surface | PASS |
| Ask WRX opens contextual episode Conversation | PASS |
| Evidence uses specialized Verify evidence action | PASS |
| Conflict/risk actions remain compact and type-specific | PASS |
| Proposal shows bounded scope, inputs, expected output, and authority | PASS |
| Cancel leaves episode state unchanged | PASS |
| Approve creates a real Work branch linked to the same episode | PASS |
| Review-origin provenance and human approval metadata retained | PASS |
| Human disposition remains unchanged after follow-up creation | PASS |

## End-to-end cross-flow QA / coherence pass

Fresh browser QA covered the Workroom-wide queue, focused episode navigation, the episode Conversation, Work canvas, Work Subthreads, Review, and the bounded follow-up loop. The review stayed read-only except for the already-approved E0-020 follow-up branch used as the real Work-loop fixture.

### Flow matrix

| Flow / state | Result | Evidence |
| --- | --- | --- |
| Workroom Overview → Needs review collection | PASS | Collection opens without a stale episode header; count and rows are real. |
| Workroom Overview → Active / Drafts collections | PASS | Counts and episode rows match recorded status/intake selectors. |
| Archive empty state | PASS (fixed) | Empty archive now renders `No archived episodes` plus truthful context instead of a blank body. |
| Needs review → Review | PASS | E0-020 opens with the correct stage, evidence, outputs, conflicts, and human authority. |
| Review → retained-output detail | PASS | Actual retained result, review state, reason, source count, prior outputs, and provenance are inspectable. |
| Review → bounded proposal → Cancel | PASS | Proposal is bounded and cancel leaves the review state unchanged. |
| Review → Approve → Work | PASS | The existing E0-020 follow-up branch is persisted under the same episode with human-approval metadata. |
| Work → selected follow-up Work Subthread | PASS | Selecting the real follow-up node opens Details / Conversation without changing stage or disposition. |
| Work Subthread continuation surface | PASS | Node-specific sources, retained messages, continuation input, and provenance copy remain available. |
| Conversation → Work | PASS | Open Work keeps E0-020 selected and preserves the episode context. |
| Work → Review after returned work | PASS | The approved follow-up completed through the existing bounded runtime; three validated outputs were retained and Review remained on the same package. |
| Episode switching across projects | PASS | E0-020 → E0-001 / E0-003 updates title, stage, context, and available controls; no stale overlay remains. |
| Empty Review target | PASS | E0-003 shows the truthful “Nothing currently requires human review” state and Open Work route. |
| Promoted human-review state | PASS | E0-019 shows `Already promoted` and “Promote package was recorded by a human.” |
| Episode composer readiness | PASS | Empty composer is compact and disabled; entering text enables Ask WRX; clearing restores the empty state. |
| Raw runtime error leakage | PASS by code + visible QA | Conversation renderer converts low-level `Not found` / transport errors to the grounded fallback; no raw runtime text appeared in tested threads. |

### Approved follow-up execution audit

| Check | Result |
| --- | --- |
| Ready follow-up exposes an explicit run action | PASS |
| Confirmation shows objective, approved scope, inputs, bounded runtime, and authority limits | PASS |
| Running state disables duplicate execution | PASS |
| Existing orchestration runtime returns specialist outputs | PASS |
| Outputs are revalidated against known local source IDs | PASS |
| Validated outputs are retained as durable Work artifacts | PASS |
| Work Subthread remains the provenance/inspection surface | PASS |
| Concise result event returns to episode Conversation | PASS |
| Review remains human-owned and recommendation is unchanged when the issue is still unresolved | PASS |
| Human disposition remains unchanged | PASS — E0-020 still shows `No disposition recorded`. |

The execution fixture is the persisted E0-020 follow-up Work node (`review-follow-up-9e049594-7686-44cf-bb24-6d3183464b61`). Three specialist outputs and a concise `Bounded follow-up completed` activity event were retained; no stage advance, promotion, rejection, or final disposition was performed during this QA pass.
