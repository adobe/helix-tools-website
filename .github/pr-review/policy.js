export const STATUS_CONTEXT = 'claude-review';
export const STATUS_CREATOR = 'github-actions[bot]';

function toolForPath(path) {
  return path.match(/^(?:tests\/)?((?:tools|blocks)\/[^/]+)\/[^/].*$/)?.[1];
}

export function claudeVerdict(conclusion, output) {
  if (conclusion !== 'success') {
    return { state: 'error', description: 'Claude review did not complete.' };
  }
  let blocking;
  try {
    ({ blocking } = JSON.parse(output));
  } catch {
    blocking = undefined;
  }
  if (!Number.isSafeInteger(blocking) || blocking < 0) {
    return { state: 'error', description: 'Claude review returned no verdict.' };
  }
  return blocking
    ? { state: 'failure', description: `Claude found ${blocking} BLOCKING issue(s).` }
    : { state: 'success', description: 'Claude found no BLOCKING issues.' };
}

export default function evaluatePullRequest(pr, files, trustedContributors, claudeStatus) {
  const reasons = [];
  const lines = pr.additions + pr.deletions;
  const paths = files.flatMap((file) => [file.filename, file.previous_filename].filter(Boolean));
  const tools = new Set(paths.map(toolForPath));

  if (pr.state !== 'open' || pr.draft) reasons.push('PR must be open and non-draft.');
  if (pr.user.type !== 'User'
    || !trustedContributors.some((login) => login.toLowerCase() === pr.user.login.toLowerCase())) {
    reasons.push('Author is not on the trusted-contributor list.');
  }
  if (!files.length || tools.size !== 1 || tools.has(undefined)) {
    reasons.push('Changes must stay within one tools/ or blocks/ directory and its mirrored tests.');
  }
  if (!Number.isSafeInteger(pr.additions) || !Number.isSafeInteger(pr.deletions)
    || pr.additions < 0 || pr.deletions < 0 || lines >= 300) {
    reasons.push('Additions + deletions must be less than 300.');
  }
  if (files.length !== pr.changed_files
    || files.some((file) => !file.patch
      || !Number.isSafeInteger(file.additions) || file.additions < 0
      || !Number.isSafeInteger(file.deletions) || file.deletions < 0)
    || files.reduce((sum, file) => sum + file.additions + file.deletions, 0) !== lines) {
    reasons.push('Complete, countable text changes are required.');
  }
  if (claudeStatus?.state !== 'success' || claudeStatus.creator?.login !== STATUS_CREATOR) {
    reasons.push('Claude review of the current head must pass with no BLOCKING issues. Comment /claude-review to run it.');
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    lines,
    tool: tools.size === 1 ? [...tools][0] : undefined,
  };
}
