const ATTESTATION = /^- \[x\] Independent AI review: different model, fresh context, all findings resolved\.\s*$/im;

function field(body, name) {
  return body.match(new RegExp(`^${name}:[ \\t]*([^\\r\\n]*)$`, 'im'))?.[1].trim() || '';
}

function toolForPath(path) {
  return path.match(/^(?:tests\/)?((?:tools|blocks)\/[^/]+)\/[^/].*$/)?.[1];
}

export default function evaluatePullRequest(pr, files, trustedContributors) {
  const reasons = [];
  const body = (pr.body || '').replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
  const authoringModel = field(body, 'Authoring model').toLowerCase();
  const reviewModel = field(body, 'Review model').toLowerCase();
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
  if (!ATTESTATION.test(body)
    || !/^[a-f0-9]{40}$/i.test(field(body, 'AI review head'))
    || field(body, 'AI review head') !== pr.head.sha
    || !authoringModel || !reviewModel || authoringModel === reviewModel) {
    reasons.push('Independent AI review must attest to the current head SHA and name different models.');
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    lines,
    tool: tools.size === 1 ? [...tools][0] : undefined,
  };
}
