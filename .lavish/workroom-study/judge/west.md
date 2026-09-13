The decision is: **what is the cheapest next test that shows whether SSI-WRX preserves human authority and accurately reconstructs evidence, before investing in model trials or treating the architecture as proven?**

### What the current mechanism demonstrates

The source inspection shows a local-first, three-stage workroom whose intended authority boundary is explicit: agents contribute evidence and analysis, while humans accept workflow structure, advance stages, and record final disposition (“Product contract”).

The implementation provides some concrete enforcement of that boundary:

- `submit_episode_structure` stores an agent’s structure only as `proposed`.
- A separate UI function, `acceptEpisodeStructure`, performs acceptance, creates workflow nodes and gates, and records the action as human-authored.
- `add_evidence` creates a visible Evidence branch and does not advance the stage or enter a human disposition.
- Eleven WebMCP tools are registered, although the README documents only eight (“Current implementation observations”).

Historical receipts also demonstrate that an earlier structured integration could read an Episode, add evidence, propose an action, and review a proposal (“Prior investigation”).

These findings demonstrate implemented separation between agent contribution and at least some human-owned transitions. They do **not** establish that every path preserves that separation in a running browser, nor that reviewers interpret the resulting record faithfully.

### What remains proposed, incomplete, or unknown

The “Product contract” is partly a design claim rather than verified behavior. The supplied evidence does not include an end-to-end browser validation of stage controls, persistence, or all eleven tool paths.

`add_evidence` lacks the proposed pending-review state, versioning, idempotency, and immutable before/after receipts (“Current implementation observations”). README/tool registration disagreement also leaves the public interface incompletely documented.

E0-020 supports Astra only as a candidate for a bounded trial. There is no Astra result, entitlement check, frozen baseline, or independently verified comparison. Its four comparison arms, configuration manifest, recording requirements, and thresholds are future work; no promotion or replacement is authorized (“E0-020 retained evidence report”).

The historical receipts do not validate the later Chrome setup or the proposed governance contract (“Prior investigation”). Most importantly, nothing yet shows that an independent reviewer can reliably distinguish a faithful reconstruction from one that silently turns proposals into decisions or unsupported dependencies into facts.

### Smallest next action

Run the already-defined **four-card blinded reconstruction screen**: two faithful paraphrases, one proposal falsely represented as accepted, and one unsupported dependency represented as fact (“Prior investigation”).

This is smaller and more decision-relevant than first building the Astra trial manifest. It directly tests the central governance risk: whether SSI-WRX’s inspectable record enables a reviewer to preserve distinctions among evidence, proposals, authorization, and decisions. Predefine the narrow pass condition already proposed—accept both faithful cards and reject both distortions—and retain the reviewer’s reasons.

A pass would justify proceeding to a bounded baseline/Astra manifest. A failure would show that record presentation or review controls need attention before model comparison. Even a pass would be only a small screen, not evidence of general reliability.