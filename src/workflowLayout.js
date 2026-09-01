import dagre from "@dagrejs/dagre";

export const WORKFLOW_NODE_WIDTH = 318;
export const WORKFLOW_NODE_HEIGHT = 270;
export const WORKFLOW_NODE_SEPARATION = 96;
export const WORKFLOW_RANK_SEPARATION = 156;

function edgeKey(source, target) {
  return `${source}→${target}`;
}

function normalizeEdges(edges = []) {
  return edges
    .map((edge) => Array.isArray(edge) ? edge : [edge.source, edge.target])
    .filter(([source, target]) => source && target && source !== target);
}

function ensureWorkflowEdges(nodes, edges) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const workflowNodes = nodes.filter((node) => node.id !== "work" && node.kind !== "gate");
  const gates = nodes.filter((node) => node.kind === "gate");
  const result = normalizeEdges(edges).filter(([source, target]) => nodeIds.has(source) && nodeIds.has(target));
  const resultKeys = new Set(result.map(([source, target]) => edgeKey(source, target)));
  const addEdge = (source, target) => {
    if (nodeIds.has(source) && nodeIds.has(target) && source !== target && !resultKeys.has(edgeKey(source, target))) {
      result.push([source, target]);
      resultKeys.add(edgeKey(source, target));
    }
  };

  workflowNodes.forEach((node) => {
    if (!result.some(([, target]) => target === node.id)) {
      addEdge("work", node.id);
    }
  });

  const workflowIds = new Set(workflowNodes.map((node) => node.id));
  const terminalNodes = workflowNodes.filter(
    (node) => !result.some(([source, target]) => source === node.id && workflowIds.has(target))
  );

  gates.forEach((gate) => {
    const gateDependencies = result.filter(([, target]) => target === gate.id);
    if (gateDependencies.length === 0) {
      (terminalNodes.length > 0 ? terminalNodes : [{ id: "work" }]).forEach((node) => addEdge(node.id, gate.id));
    }
  });

  return result;
}

export function layoutWorkflowNodes(nodes, edges = []) {
  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "LR",
    nodesep: WORKFLOW_NODE_SEPARATION,
    ranksep: WORKFLOW_RANK_SEPARATION,
    marginx: 42,
    marginy: 42,
  });

  nodes.forEach((node) => {
    graph.setNode(node.id, {
      width: WORKFLOW_NODE_WIDTH,
      height: WORKFLOW_NODE_HEIGHT,
    });
  });

  ensureWorkflowEdges(nodes, edges).forEach(([source, target]) => graph.setEdge(source, target));
  dagre.layout(graph);

  return new Map(
    nodes.map((node) => {
      const position = graph.node(node.id);
      return [node.id, {
        x: position.x - WORKFLOW_NODE_WIDTH / 2,
        y: position.y - WORKFLOW_NODE_HEIGHT / 2,
      }];
    })
  );
}

export function getTraceGraph(nodeId, edges = []) {
  if (!nodeId) {
    return { nodeIds: new Set(), edgeKeys: new Set() };
  }

  const normalizedEdges = normalizeEdges(edges);
  const incoming = new Map();
  const outgoing = new Map();
  normalizedEdges.forEach(([source, target]) => {
    incoming.set(target, [...(incoming.get(target) ?? []), source]);
    outgoing.set(source, [...(outgoing.get(source) ?? []), target]);
  });

  const nodeIds = new Set([nodeId]);
  const visit = (start, adjacency) => {
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.shift();
      (adjacency.get(current) ?? []).forEach((next) => {
        if (!nodeIds.has(next)) {
          nodeIds.add(next);
          queue.push(next);
        }
      });
    }
  };

  visit(nodeId, incoming);
  visit(nodeId, outgoing);

  return {
    nodeIds,
    edgeKeys: new Set(
      normalizedEdges
        .filter(([source, target]) => nodeIds.has(source) && nodeIds.has(target))
        .map(([source, target]) => edgeKey(source, target))
    ),
  };
}

export function getWorkflowEdgeKey(source, target) {
  return edgeKey(source, target);
}
