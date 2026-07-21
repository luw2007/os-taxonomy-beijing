export function formatMasteryProgress(masteredIds, visibleTopicIds) {
  let count = 0;
  for (const id of masteredIds) if (visibleTopicIds.has(id)) count++;
  return {
    count,
    percent: visibleTopicIds.size ? (count / visibleTopicIds.size * 100).toFixed(1) : '0.0',
  };
}
