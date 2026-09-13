# E0-020 — GPT-6 Astra evidence report

**Prepared:** 4 September 2026  
**Purpose:** A quick, decision-safe evidence package supporting David's *GPT-6 Astra Research Update — Castle Side WRX*. This is not an approval, rollout decision, model switch, or stage advancement.

## Bottom line

The research and all retained E0-020 agent outputs converge on the same conclusion: **Astra is a candidate capability for a bounded, source-backed trial—not an authority or an automatic replacement.**

There is enough evidence to design a controlled evaluation. There is **not** yet evidence to claim that Astra improves this Workroom's outcomes, cost, reliability, or safety. No Astra trial result, account-entitlement check, frozen baseline configuration, or independently verified scorecard is retained in E0-020.

## Sources collected

| Source | What it establishes | Important limit |
| --- | --- | --- |
| David's research brief, *GPT-6 Astra Research Update — Castle Side WRX* (3 Sep 2026) | Astra has high agency and a large-context/tool-use profile; reported performance is harness-sensitive; recommends a four-arm, source-backed evaluation. | It is research and planning evidence, not a Workroom-specific trial result. |
| E0-020 Autopilot: Evidence Collector | Four comparison arms, configuration capture, full traces, and outcome/cost/safety measures are needed. | It proposes the method; it does not supply a captured baseline. |
| E0-020 Autopilot: Evidence Verifier | David's brief supports the evaluation design but does not prove local configuration, availability, or results. | It identifies evidence gaps rather than resolving them. |
| E0-020 Autopilot: Reviewer | A versioned trial manifest and independent verification are needed before a decision package can be credible. | No manifest or verification result has been produced. |
| E0-020 retained specialist and final-review outputs | Read-only shadow/canary scope, explicit rollback, workload routing only as a proposal, and human approval are consistent safeguards. | They do not authorize promotion, stage advancement, or final disposition. |

## What is supported

1. **Keep authority human-owned.** Astra may prepare, analyze, or propose; it must not advance Workroom stages or record a final human disposition.
2. **Separate model effects from harness effects.** The comparison must retain the same workload, prompt/system setup, context handling, tool schema and permissions, retry behavior, verifier, and execution policy wherever the arm does not explicitly vary them.
3. **Use four arms, not a single before/after test.** This is the minimum design that can distinguish an Astra effect from a changed integration or routing policy.
4. **Start contained.** Read-only shadow work or branch-isolated canaries keep the first evaluation reversible and inspectable.
5. **Require independent verification.** A separate verifier or deterministic checks should validate claims and artifact quality before results are used in a human decision.

## Proposed four-arm evaluation

| Arm | Configuration | Question answered |
| --- | --- | --- |
| A. Baseline | Current approved model and current harness | What does the Workroom do today? |
| B. Astra, unchanged harness | Astra substituted while other conditions stay fixed | Is there a model-specific difference? |
| C. Astra-specific configuration | Astra with explicitly documented settings | Does Astra need a tailored configuration, and at what trade-off? |
| D. Routed + independently verified | Explicit workload routing plus independent verifier | Does selective use improve the overall system safely? |

For every arm, retain the exact model identifier, reasoning/API settings, prompt and context policy, compaction behavior, tool permissions and schemas, repository/input snapshot, retry policy, verifier configuration, full trace, and failure/recovery record.

## Measures to record

- Task success and partial-credit rubric score
- Evidence quality: traceability, unsupported claims, and verifier acceptance
- Human intervention and clarification requests
- Wall-clock time, tool time, tokens, cache use, and cost
- Tool actions, reversals, retries, loops/stops, and recovery behavior
- Safety/policy events and rollback triggers

The outputs recommend repeated bounded workloads (roughly 20–30 comparable runs where practical), plus a smaller set of deeply audited long-context/tool-use tasks. Exact pass thresholds remain a **human decision** and are not supplied by David's brief.

## Evidence gaps to close before a decision

- Confirm actual Astra access/entitlement and record the dated model/configuration snapshot.
- Capture and freeze the current baseline harness and representative workload set.
- Define the scoring rubric, numeric thresholds, budget, and rollback conditions.
- Create a versioned evaluation manifest for all four arms.
- Run the contained trials and preserve the complete traces, failures, and verifier outputs.
- Have an independent reviewer validate the comparison before requesting human approval.

## Recommended next action in E0-020

Create the **baseline and trial configuration manifest** as the next evidence artifact. It should make the four arms reproducible and specify the frozen workloads, allowed tools, measurement fields, verifier, budget, and rollback conditions. Once that is present, a human can decide whether to authorize a read-only/branch-isolated trial.

## Retained Workroom outputs included in this collection

- E0-020 Autopilot package: `specialist-n6` recommendation, `specialist-n2` evidence, `specialist-n3` evaluation, and `final-review`.
- Orchestration run `ea1ccc06-740e-46d0-a6d9-8e12e0f080dc`: Evidence Collector, Evidence Verifier, and Reviewer outputs.
- Evidence Verifier discussion thread: `thread-f1fa…`, which confirms that exact baseline values, thresholds, and verifier checks must be defined locally rather than inferred from the research brief.

## Decision boundary

This report supports **preparing and evaluating** a bounded Astra trial. It does not support promotion to trusted context, an operational rollout, a model replacement, or an E0-020 approval without the missing empirical evidence and a human decision.
