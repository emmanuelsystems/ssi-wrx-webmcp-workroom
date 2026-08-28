/*
 * The Workroom currently treats First Mate as an orchestration role.
 * This local planner is replaceable by an external First Mate/runtime adapter later.
 */

const PLAN_TEMPLATES = {
  inquiry: [
    {
      role: "Context Analyst",
      title: "Recover relevant context",
      output: "context-summary",
    },
    {
      role: "Research Agent",
      title: "Verify evidence",
      output: "evidence-pack",
      dependsOn: ["context-analyst"],
    },
    {
      role: "Synthesis Agent",
      title: "Produce candidate recommendation",
      output: "candidate-recommendation",
      dependsOn: ["context-analyst", "research-agent"],
    },
    {
      role: "Reviewer",
      title: "Independent review",
      output: "review-verdict",
      dependsOn: ["synthesis-agent"],
    },
  ],
  evidence: [
    {
      role: "Evidence Collector",
      title: "Collect supporting evidence",
      output: "evidence-pack",
    },
    {
      role: "Evidence Verifier",
      title: "Check provenance and gaps",
      output: "verification-notes",
      dependsOn: ["evidence-collector"],
    },
    {
      role: "Reviewer",
      title: "Independent review",
      output: "review-verdict",
      dependsOn: ["evidence-verifier"],
    },
  ],
  gaps: [
    {
      role: "Gap Analyst",
      title: "Classify conflicts and unknowns",
      output: "gap-map",
    },
    {
      role: "Research Agent",
      title: "Find evidence for open gaps",
      output: "gap-evidence",
      dependsOn: ["gap-analyst"],
    },
    {
      role: "Reviewer",
      title: "Independent review",
      output: "review-verdict",
      dependsOn: ["gap-analyst", "research-agent"],
    },
  ],
  recommendation: [
    {
      role: "Analyst",
      title: "Compare candidate actions",
      output: "action-comparison",
    },
    {
      role: "Builder",
      title: "Draft recommended follow-up",
      output: "follow-up-draft",
      dependsOn: ["analyst"],
    },
    {
      role: "Reviewer",
      title: "Independent review",
      output: "review-verdict",
      dependsOn: ["builder"],
    },
  ],
  evaluation: [
    {
      role: "Evaluator",
      title: "Test whether evidence supports the proposal",
      output: "evaluation-report",
    },
    {
      role: "Independent Reviewer",
      title: "Independent review",
      output: "review-verdict",
      dependsOn: ["evaluator"],
    },
  ],
};

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function getTemplateKey(node) {
  if (node?.id === "inquiry") return "inquiry";
  if (node?.id === "evidence") return "evidence";
  if (node?.id === "gaps") return "gaps";
  if (node?.id === "recommendation") return "recommendation";
  if (node?.id === "evaluation") return "evaluation";
  return "inquiry";
}

export function createOrchestrationRequest({
  episode,
  node,
  threads = [],
  context = {},
}) {
  const nodeContext = {
    title: node?.data?.title ?? node?.title ?? "Selected work node",
    body: node?.data?.body ?? node?.body ?? "",
    type: node?.data?.label ?? node?.type ?? "Work node",
  };

  return {
    episodeId: episode?.id,
    nodeId: node?.id,
    objective: nodeContext.title,
    nodeContext,
    conversationContext: threads.flatMap((thread) => thread.messages ?? []),
    allowedAuthority: "Planning only. No execution.",
    expectedOutcome: context.expectedOutcome ?? "A reviewed orchestration proposal.",
  };
}

export function createOrchestrationPlan({
  episode,
  node,
  threads = [],
  context = {},
}) {
  const request = createOrchestrationRequest({
    episode,
    node,
    threads,
    context,
  });
  const template = PLAN_TEMPLATES[getTemplateKey(node)];
  const tasks = template.map((task, index) => {
    const id = slugify(task.role);
    return {
      id,
      number: index + 1,
      title: task.title,
      output: task.output,
      dependsOn: task.dependsOn ?? [],
    };
  });
  const assignments = template.map((assignment, index) => ({
    id: tasks[index].id,
    taskId: tasks[index].id,
    role: assignment.role,
    status: index === 0 ? "Complete" : index === 1 ? "Working" : "Waiting",
  }));

  return {
    id: `orchestration-${episode?.id}-${node?.id}`,
    episodeId: request.episodeId,
    nodeId: request.nodeId,
    status: "proposed",
    objective: request.objective,
    assumptions: ["The selected node context is approved for planning."],
    request,
    tasks,
    assignments,
    dependencies: tasks.flatMap((task) =>
      task.dependsOn.map((dependsOn) => ({
        from: dependsOn,
        to: task.id,
      }))
    ),
    reviewPlan: {
      role: tasks[tasks.length - 1]?.id,
      description: "Independent review before any human disposition.",
    },
    humanGates: [
      "Approve execution before any task may run.",
    ],
    authority: {
      may: [
        "inspect the approved episode/node context",
        "decompose the work",
        "propose specialist roles",
        "define dependencies",
        "define expected outputs",
        "request review",
      ],
      mayNot: [
        "change episode scope",
        "advance workflow stages",
        "make final disposition",
        "silently add external authority",
        "approve its own output",
        "execute anything in this prototype",
      ],
    },
  };
}

export function getOrchestrationPlanSummary(plan) {
  const assignments = plan?.assignments ?? [];
  return {
    total: assignments.length,
    complete: assignments.filter((item) => item.status === "Complete").length,
    working: assignments.filter((item) => item.status === "Working").length,
    humanRequired: assignments.filter((item) => item.status === "Human required").length,
    waiting: assignments.filter((item) => item.status === "Waiting").length,
  };
}
