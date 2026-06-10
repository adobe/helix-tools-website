/**
 * Classifies the sequence status for a resource based on edit, preview, and publish dates.
 * Returns a label and whether the status is considered positive (vs. negative/actionable).
 * @param {string|null|undefined} edit - Source/edit last-modified date.
 * @param {string|null|undefined} preview - Preview last-modified date.
 * @param {string|null|undefined} publish - Publish last-modified date.
 * @param {Object} [options] - Classification options.
 * @param {boolean} [options.allowMissingSourceDate=false] - Whether missing source dates
 * are expected.
 * @returns {{ label: string, positive: boolean }}
 */
export default function classifySequenceStatus(edit, preview, publish, options = {}) {
  const { allowMissingSourceDate = false } = options;
  const valid = (d) => !Number.isNaN(d.getTime());
  // Treat null and undefined as absent — new Date(null) yields epoch which is a valid date.
  const editDate = new Date(edit ?? NaN);
  const previewDate = new Date(preview ?? NaN);
  const publishDate = new Date(publish ?? NaN);

  if (!valid(editDate)) {
    if (!allowMissingSourceDate) {
      return { label: 'No source', positive: false };
    }

    // BYOM pages have no sourceLastModified from the admin API. Classify by
    // preview/publish state rather than always returning a negative status.
    if (!valid(previewDate) && !valid(publishDate)) {
      return { label: 'No source', positive: false };
    }
    if (valid(previewDate) && !valid(publishDate)) {
      return { label: 'Not published', positive: true };
    }
    if (!valid(previewDate) && valid(publishDate)) {
      return { label: 'Current', positive: true };
    }
    return { label: previewDate <= publishDate ? 'Current' : 'Pending changes', positive: true };
  }

  if (!valid(previewDate) && !valid(publishDate)) {
    return { label: 'Not previewed', positive: true };
  }
  if (valid(previewDate) && !valid(publishDate) && editDate <= previewDate) {
    return { label: 'Not published', positive: true };
  }
  const inSequence = editDate <= previewDate && previewDate <= publishDate;
  return { label: inSequence ? 'Current' : 'Pending changes', positive: true };
}
