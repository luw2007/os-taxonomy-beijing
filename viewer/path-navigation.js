export function findNextUnmastered(currentId, mastered, nodes, edges) {
  const inbound = new Map();
  const outbound = new Map();
  for (const edge of edges) {
    if (!inbound.has(edge.t)) inbound.set(edge.t, []);
    inbound.get(edge.t).push(edge.f);
    if (!outbound.has(edge.f)) outbound.set(edge.f, []);
    outbound.get(edge.f).push(edge.t);
  }

  const compare = (left, right) => {
    const a = nodes[left] || {};
    const b = nodes[right] || {};
    return (a.age ?? Infinity) - (b.age ?? Infinity)
      || String(a.name ?? left).localeCompare(String(b.name ?? right), 'zh-Hans-CN')
      || left.localeCompare(right);
  };

  const search = (links) => {
    const seen = new Set([currentId]);
    let level = [currentId];
    while (level.length) {
      const next = [];
      for (const id of level) {
        for (const adjacent of links.get(id) || []) {
          if (seen.has(adjacent)) continue;
          seen.add(adjacent);
          next.push(adjacent);
        }
      }
      next.sort(compare);
      const candidate = next.find(id => !mastered.has(id));
      if (candidate) return candidate;
      level = next;
    }
    return null;
  };

  return search(inbound) || search(outbound);
}
