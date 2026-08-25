const POLLABLE_STATUSES = new Set(['ONBOARDING', 'ISSUING_CERTIFICATE', 'DELETING']);

const FAILED_STATUSES = new Set(['FAILED_TO_ONBOARD', 'FAILED_TO_ISSUE_CERTIFICATES', 'FAILED_TO_OFFBOARD']);

export function isPollableStatus(status) {
  return POLLABLE_STATUSES.has(status);
}

export function isFailedStatus(status) {
  return FAILED_STATUSES.has(status);
}

const STATUS_VIEWS = {
  ONBOARDING: { view: 'onboarding', step: 1, stepState: 'active' },
  REGISTERED: { view: 'records', step: 1, stepState: 'active' },
  ISSUING_CERTIFICATE: { view: 'issuing', step: 2, stepState: 'active' },
  ACTIVE: { view: 'live', step: 3, stepState: 'done' },
  FAILED_TO_ONBOARD: { view: 'error-onboard', step: 1, stepState: 'error' },
  FAILED_TO_ISSUE_CERTIFICATES: { view: 'error-cert', step: 2, stepState: 'error' },
  PENDING_DELETION: { view: 'removal', step: null, stepState: null },
  DELETING: { view: 'deleting', step: null, stepState: null },
  FAILED_TO_OFFBOARD: { view: 'error-offboard', step: null, stepState: null },
};

export function describeStatus(status) {
  return STATUS_VIEWS[status] || null;
}

export const STEP_LABELS = ['Add DNS records', 'Issue certificate', 'Go live'];

export function getStepIndicator(status) {
  const desc = describeStatus(status);
  if (!desc || desc.step === null) return null;

  return STEP_LABELS.map((label, i) => {
    const stepNumber = i + 1;
    let state = 'todo';
    if (stepNumber < desc.step) state = 'done';
    else if (stepNumber === desc.step) state = desc.stepState;
    return { label, state };
  });
}

// Splits a { name, target } CNAME record into the three labeled fields a DNS
// provider asks for, so the UI can render (and copy) them individually.
export function recordFields(record) {
  if (!record) return null;
  return { host: record.name, type: 'CNAME', value: record.target };
}

// Formats a { host, type, value } record as a single compact line — used by the
// removal view, where the customer only needs to identify records to delete.
export function formatRecordLine(fields) {
  return fields ? `${fields.host}  ${fields.type}  ${fields.value}` : '';
}

// True when the worker's DNS consensus says the CNAMEs are in the desired state (present &
// correct for onboarding, released for offboarding) — i.e. a POST verify would advance.
export function dnsReady(dns) {
  return !!dns && dns.ready === true;
}

// Reads the "how long to wait" value, in seconds
export function dnsWaitSeconds(source) {
  if (!source) return null;
  const seconds = source.retryAfter ?? source.readyIn ?? source.dns?.readyIn;
  return Number.isFinite(seconds) ? seconds : null;
}

// Interprets the `dns` readout from a checkDns/verify response into a { kind, message } note.
// `phase` is 'onboard' (records must be present) or 'offboard' (records must be gone).
export function describeDnsCheck(dns, phase, domain) {
  if (!dns) {
    return { kind: 'warning', message: 'We couldn\'t check your DNS just now. Wait a moment and try again.' };
  }
  if (phase === 'offboard') {
    if (dnsReady(dns)) {
      return { kind: 'success', message: 'Both DNS records have been removed. You\'re clear to confirm removal.' };
    }
    return {
      kind: 'info',
      message: `${domain} still points at AEM. Remove both CNAME records at your DNS provider, then confirm removal.`,
    };
  }
  if (dnsReady(dns)) {
    return { kind: 'success', message: 'Your DNS records look good.' };
  }
  return {
    kind: 'warning',
    message: 'We can\'t see your DNS records yet. Double-check both CNAMEs match exactly, then verify again.',
  };
}

// Describes the PENDING_DELETION removal panel by whether the domain was ever served (cert issued).
export function describeRemoval(served) {
  if (served) {
    return {
      requiresRecordCheck: true,
      description: 'Permanently removes this domain from AEM and stops it serving traffic. Removal only proceeds once you\'ve deleted both CNAME records below.',
      note: { kind: 'info', message: 'Remove your CNAME records, then Check records before removing.' },
    };
  }
  return {
    requiresRecordCheck: false,
    description: 'Confirming permanently removes this domain from AEM and can\'t be undone. Remember to delete the CNAME records below at your DNS provider afterward.',
    note: { kind: 'info', message: 'You can remove this domain now. Delete its CNAME records at your DNS provider afterward.' },
  };
}

const ERROR_MESSAGES = {
  0: 'Could not reach the domain service. Check your connection and try again.',
  403: 'This domain is already registered to a different organization or site.',
  409: 'This action conflicts with the domain\'s current state. Refresh and try again.',
  500: 'The domain service hit an unexpected error. Please try again.',
  502: 'The domain service couldn\'t start the operation. Please try again.',
  503: 'The domain service is temporarily unavailable. Please try again shortly.',
};

export function getErrorMessage(status, error) {
  if (ERROR_MESSAGES[status]) return ERROR_MESSAGES[status];
  if (error) return error;
  return 'Something went wrong. Please try again.';
}

// Builds the shared owner query string from org/site.
export function buildOwnerQuery(org, site) {
  const params = new URLSearchParams();
  if (org) params.set('org', org);
  if (site) params.set('site', site);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function isTransientStatus(status) {
  return status === 0 || status >= 500;
}

export const TRANSIENT_RETRY_DELAYS = [500, 1500];

const POLL_BASE_MS = 3000;
const POLL_CAP_MS = 30000;

// Exponential backoff for the status poll loop, capped. attempt is 0-based.
export function pollDelay(attempt, base = POLL_BASE_MS, cap = POLL_CAP_MS) {
  return Math.min(base * (2 ** attempt), cap);
}
