export const PSI_CATEGORIES = ['performance', 'accessibility', 'best-practices'];

export function scoreColor(score) {
  if (score >= 90) return '#2d9d78';
  if (score >= 50) return '#b36619';
  return '#e34850';
}

export function parsePsiScores(categories) {
  const scores = {};
  PSI_CATEGORIES.forEach((id) => {
    if (categories[id]?.score != null) {
      scores[id] = Math.round(categories[id].score * 100);
    }
  });
  return scores;
}
