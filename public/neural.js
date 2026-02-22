const neuralGraphEl = document.getElementById('neural-graph');
const neuralGraphMetaEl = document.getElementById('neural-graph-meta');
const refreshNeuralGraphBtn = document.getElementById('refresh-neural-graph');

function clearNeuralGraph() {
  neuralGraphEl.textContent = '';
}

function polarPosition(index, total, centerX, centerY, radius) {
  const angle = (index / Math.max(1, total)) * Math.PI * 2 - Math.PI / 2;
  return {
    x: centerX + Math.cos(angle) * radius,
    y: centerY + Math.sin(angle) * radius
  };
}

function svgNode(tag, attrs = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([key, value]) => {
    node.setAttribute(key, String(value));
  });
  return node;
}

function renderNeuralGraph(graph) {
  clearNeuralGraph();

  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];

  if (!nodes.length) {
    neuralGraphMetaEl.textContent = 'Neural graph is empty. Chat more to train it.';
    return;
  }

  const width = 960;
  const height = 560;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.max(120, Math.min(210, 80 + nodes.length * 5));

  const byId = new Map();
  nodes.forEach((node, index) => {
    const pos = polarPosition(index, nodes.length, centerX, centerY, radius);
    byId.set(String(node.id), {
      ...node,
      ...pos,
      r: Math.max(6, Math.min(18, 6 + Number(node.weight || 1) * 1.5))
    });
  });

  edges.forEach((edge) => {
    const from = byId.get(String(edge.from));
    const to = byId.get(String(edge.to));
    if (!from || !to) {
      return;
    }

    const opacity = Math.max(0.15, Math.min(0.92, Number(edge.weight || 0)));
    const line = svgNode('line', {
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      class: 'neural-edge',
      'stroke-opacity': opacity
    });
    neuralGraphEl.appendChild(line);
  });

  byId.forEach((node) => {
    const circle = svgNode('circle', {
      cx: node.x,
      cy: node.y,
      r: node.r,
      class: 'neural-node'
    });

    const label = svgNode('text', {
      x: node.x,
      y: node.y + node.r + 14,
      class: 'neural-label',
      'text-anchor': 'middle'
    });

    const shortLabel = String(node.label || 'node');
    label.textContent = shortLabel.length > 24 ? `${shortLabel.slice(0, 24)}...` : shortLabel;

    neuralGraphEl.appendChild(circle);
    neuralGraphEl.appendChild(label);
  });

  neuralGraphMetaEl.textContent = `${nodes.length} prototype nodes • ${edges.length} similarity edges • trained samples: ${
    Number(graph?.trainedSamples || 0)
  } • dimension: ${Number(graph?.dimension || 0)}`;
}

async function loadNeuralGraph() {
  try {
    neuralGraphMetaEl.textContent = 'Loading neural graph...';
    const response = await fetch('/api/neural/graph?limit=40&minEdge=0.55');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const graph = await response.json();
    renderNeuralGraph(graph);
  } catch (error) {
    clearNeuralGraph();
    neuralGraphMetaEl.textContent = `Could not load neural graph (${error.message}).`;
  }
}

refreshNeuralGraphBtn.addEventListener('click', loadNeuralGraph);
loadNeuralGraph();
