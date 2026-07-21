export function toggleMastery(mastered, id) {
  const next = new Set(mastered);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
