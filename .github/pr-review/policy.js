export const STATUS_CONTEXT = 'claude-review';
export const STATUS_CREATOR = 'github-actions[bot]';

function scopeForPath(path, { sourceDirs, testsDir }) {
  const [first, ...rest] = path.split('/');
  const parts = first === testsDir ? rest : [first, ...rest];
  return parts.length > 2 && sourceDirs.includes(parts[0]) && parts.every(Boolean)
    ? `${parts[0]}/${parts[1]}`
    : undefined;
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

export default function evaluatePullRequest(pr, files, config, claudeStatus) {
  const {
    trustedContributors, maxLines, maxFiles, maxScopes, sourceDirs, testsDir,
  } = config;
  const reasons = [];
  const lines = pr.additions + pr.deletions;
  const paths = files.flatMap((file) => [file.filename, file.previous_filename].filter(Boolean));
  const scopes = new Set(paths.map((path) => scopeForPath(path, config)));

  if (pr.state !== 'open' || pr.draft) reasons.push('PR must be open and non-draft.');
  if (pr.user.type !== 'User'
    || !trustedContributors.some((login) => login.toLowerCase() === pr.user.login.toLowerCase())) {
    reasons.push('Author is not on the trusted-contributor list.');
  }
  if (!files.length || scopes.has(undefined) || scopes.size > maxScopes) {
    reasons.push(`Changes must stay within at most ${maxScopes} ${sourceDirs.map((dir) => `${dir}/`).join(' or ')} director${maxScopes === 1 ? 'y' : 'ies'} and mirrored ${testsDir}/.`);
  }
  if (files.length > maxFiles) {
    reasons.push(`At most ${maxFiles} changed files allowed.`);
  }
  if (!Number.isSafeInteger(pr.additions) || !Number.isSafeInteger(pr.deletions)
    || pr.additions < 0 || pr.deletions < 0 || lines > maxLines) {
    reasons.push(`Additions + deletions must be at most ${maxLines}.`);
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
    tool: scopes.has(undefined) ? undefined : [...scopes].join(', '),
  };
}
