function compareNodes(nodes, a, b) {
  const [nameA, , ageA] = nodes[a];
  const [nameB, , ageB] = nodes[b];
  if (ageA !== ageB) return ageA - ageB;
  const nameCmp = nameA.localeCompare(nameB, 'zh-Hans-CN');
  if (nameCmp !== 0) return nameCmp;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function buildPathSequence(nodes, edges, filters = {}) {
  const ids = Object.keys(nodes).filter((id) => {
    const [, subject, age] = nodes[id];
    if (filters.subject !== undefined && subject !== filters.subject) return false;
    if (filters.age !== undefined && age !== filters.age) return false;
    return true;
  });
  const idSet = new Set(ids);
  const filteredEdges = edges.filter((e) => idSet.has(e.f) && idSet.has(e.t));


  const indegree = new Map();
  const adj = new Map();
  for (const id of ids) {
    indegree.set(id, 0);
    adj.set(id, []);
  }
  for (const e of filteredEdges) {
    indegree.set(e.t, indegree.get(e.t) + 1);
    adj.get(e.f).push(e.t);
  }

  const cmp = (a, b) => compareNodes(nodes, a, b);

  const ready = ids.filter((id) => indegree.get(id) === 0);
  const output = [];
  const resolved = new Set();
  while (ready.length) {
    ready.sort(cmp);
    const id = ready.shift();
    output.push(id);
    resolved.add(id);
    for (const t of adj.get(id)) {
      indegree.set(t, indegree.get(t) - 1);
      if (indegree.get(t) === 0) ready.push(t);
    }
  }

  const unresolved = ids.filter((id) => !resolved.has(id));
  unresolved.sort(cmp);

  return [...output, ...unresolved];
}

export const HORIZONTAL_GESTURE_THRESHOLD = 88;

export function classifyPathGesture(gesture, options = {}) {
  const { dx, dy } = gesture;
  const {
    horizontalMinDistance = HORIZONTAL_GESTURE_THRESHOLD,
    verticalMinDistance = 48,
    dominance = 1.5,
    atTop = false,
    atBottom = false,
  } = options;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  if (absDx >= horizontalMinDistance && absDx >= absDy * dominance) {
    return dx < 0 ? 'mastered' : 'needs-review';
  }

  if (absDy >= verticalMinDistance && absDy >= absDx * dominance) {
    if (dy < 0) return atBottom ? 'next' : null;
    return atTop ? 'previous' : null;
  }

  return null;
}

export function applyKnowledgeDecision(state, id, decision) {
  const mastered = new Set(state.mastered);
  const needsReview = new Set(state.needsReview);

  switch (decision) {
    case 'mastered':
      mastered.add(id);
      needsReview.delete(id);
      break;
    case 'needs-review':
      needsReview.add(id);
      mastered.delete(id);
      break;
    case 'clear':
      mastered.delete(id);
      needsReview.delete(id);
      break;
    default:
      throw new Error(`Unknown knowledge decision: ${decision}`);
  }

  return { mastered, needsReview };
}
