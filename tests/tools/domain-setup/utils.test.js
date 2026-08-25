import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeStatus,
  getStepIndicator,
  STEP_LABELS,
  recordFields,
  formatRecordLine,
  dnsReady,
  dnsWaitSeconds,
  describeDnsCheck,
  describeRemoval,
  getErrorMessage,
  isPollableStatus,
  isFailedStatus,
  buildOwnerQuery,
  isTransientStatus,
  pollDelay,
} from '../../../tools/domain-setup/utils.js';

describe('domain-setup:utils.js', () => {
  describe('recordFields', () => {
    it('splits a CNAME record into host/type/value', () => {
      assert.deepEqual(
        recordFields({ name: '_acme-challenge.www.example.com', target: 'abc.validations.aem.network' }),
        { host: '_acme-challenge.www.example.com', type: 'CNAME', value: 'abc.validations.aem.network' },
      );
    });

    it('returns null for a missing record', () => {
      assert.equal(recordFields(undefined), null);
      assert.equal(recordFields(null), null);
    });
  });

  describe('formatRecordLine', () => {
    it('formats fields as a single compact line', () => {
      assert.equal(
        formatRecordLine({ host: 'www.example.com', type: 'CNAME', value: 'main--s--o.domains.aem.network' }),
        'www.example.com  CNAME  main--s--o.domains.aem.network',
      );
    });

    it('returns an empty string for missing fields', () => {
      assert.equal(formatRecordLine(null), '');
    });
  });

  describe('dnsReady', () => {
    it('is true only when the readout reports ready', () => {
      assert.equal(dnsReady({ ready: true }), true);
      assert.equal(dnsReady({ ready: false }), false);
    });

    it('is false for a missing or ready-less readout', () => {
      assert.equal(dnsReady(undefined), false);
      assert.equal(dnsReady(null), false);
      assert.equal(dnsReady({}), false);
    });
  });

  describe('dnsWaitSeconds', () => {
    it('reads retryAfter from a POST verify body', () => {
      assert.equal(dnsWaitSeconds({ retryAfter: 120 }), 120);
    });

    it('reads readyIn from a GET checkDns readout', () => {
      assert.equal(dnsWaitSeconds({ readyIn: 45 }), 45);
      assert.equal(dnsWaitSeconds({ dns: { readyIn: 60 } }), 60);
    });

    it('prefers retryAfter when both are present', () => {
      assert.equal(dnsWaitSeconds({ retryAfter: 30, readyIn: 999 }), 30);
    });

    it('returns null when nothing is waiting or the value is absent', () => {
      assert.equal(dnsWaitSeconds({ ready: true, readyIn: null }), null);
      assert.equal(dnsWaitSeconds({}), null);
      assert.equal(dnsWaitSeconds(undefined), null);
    });
  });

  describe('describeDnsCheck', () => {
    const domain = 'www.example.com';

    it('warns when the readout is missing', () => {
      assert.equal(describeDnsCheck(undefined, 'onboard', domain).kind, 'warning');
      assert.equal(describeDnsCheck(null, 'offboard', domain).kind, 'warning');
    });

    describe('onboard', () => {
      it('confirms success when records are ready', () => {
        assert.equal(describeDnsCheck({ ready: true }, 'onboard', domain).kind, 'success');
      });

      it('warns when records are not ready', () => {
        const { kind, message } = describeDnsCheck({ ready: false, readyIn: 120 }, 'onboard', domain);
        assert.equal(kind, 'warning');
        assert.match(message, /verify again/);
      });
    });

    describe('offboard', () => {
      it('confirms success when records are released', () => {
        const { kind } = describeDnsCheck({ ready: true }, 'offboard', domain);
        assert.equal(kind, 'success');
      });

      it('notes that records still point at AEM', () => {
        const { kind, message } = describeDnsCheck({ ready: false, readyIn: 45 }, 'offboard', domain);
        assert.equal(kind, 'info');
        assert.match(message, /www\.example\.com/);
      });
    });
  });

  describe('describeRemoval', () => {
    it('keeps the record-check gate for a served domain', () => {
      const { requiresRecordCheck, description, note } = describeRemoval(true);
      assert.equal(requiresRecordCheck, true);
      assert.ok(description.length > 0);
      assert.equal(note.kind, 'info');
      assert.ok(note.message.length > 0);
      assert.match(note.message, /Check records/);
    });

    it('drops the gate for a never-served domain', () => {
      const { requiresRecordCheck, description, note } = describeRemoval(false);
      assert.equal(requiresRecordCheck, false);
      assert.ok(description.length > 0);
      assert.equal(note.kind, 'info');
      assert.ok(note.message.length > 0);
    });

    it('treats a missing served flag as never-served', () => {
      assert.equal(describeRemoval(undefined).requiresRecordCheck, false);
    });

    it('gives the two states distinct copy', () => {
      const served = describeRemoval(true);
      const unserved = describeRemoval(false);
      assert.notEqual(served.description, unserved.description);
      assert.notEqual(served.note.message, unserved.note.message);
    });
  });

  describe('buildOwnerQuery', () => {
    it('includes org and site', () => {
      assert.equal(buildOwnerQuery('myorg', 'mysite'), '?org=myorg&site=mysite');
    });

    it('returns an empty string when nothing is provided', () => {
      assert.equal(buildOwnerQuery('', ''), '');
    });

    it('url-encodes values', () => {
      assert.equal(buildOwnerQuery('a b', 'c&d'), '?org=a+b&site=c%26d');
    });
  });

  describe('getErrorMessage', () => {
    it('maps known statuses to friendly text', () => {
      assert.match(getErrorMessage(0), /connection/i);
      assert.match(getErrorMessage(403), /different organization/i);
      assert.match(getErrorMessage(409), /conflicts/i);
      assert.match(getErrorMessage(502), /couldn't start/i);
    });

    it('falls back to the worker error string, then a generic message', () => {
      assert.equal(getErrorMessage(418, 'teapot'), 'teapot');
      assert.match(getErrorMessage(418, ''), /went wrong/i);
    });
  });

  describe('isTransientStatus', () => {
    it('treats network failures (0) and 5xx as transient', () => {
      assert.equal(isTransientStatus(0), true);
      assert.equal(isTransientStatus(500), true);
      assert.equal(isTransientStatus(503), true);
    });

    it('treats 2xx/4xx as non-transient', () => {
      assert.equal(isTransientStatus(200), false);
      assert.equal(isTransientStatus(404), false);
      assert.equal(isTransientStatus(409), false);
    });
  });

  describe('pollDelay', () => {
    it('grows exponentially from the base', () => {
      assert.equal(pollDelay(0, 3000, 30000), 3000);
      assert.equal(pollDelay(1, 3000, 30000), 6000);
      assert.equal(pollDelay(2, 3000, 30000), 12000);
    });

    it('caps at the maximum', () => {
      assert.equal(pollDelay(10, 3000, 30000), 30000);
    });
  });

  describe('status classification', () => {
    it('marks worker-driven transient states as pollable', () => {
      ['ONBOARDING', 'ISSUING_CERTIFICATE', 'DELETING'].forEach((s) => {
        assert.equal(isPollableStatus(s), true);
      });
    });

    it('does not poll user-gated or terminal states', () => {
      ['PENDING_DELETION', 'REGISTERED', 'ACTIVE'].forEach((s) => {
        assert.equal(isPollableStatus(s), false);
      });
    });

    it('identifies the FAILED_TO_* states', () => {
      ['FAILED_TO_ONBOARD', 'FAILED_TO_ISSUE_CERTIFICATES', 'FAILED_TO_OFFBOARD'].forEach((s) => {
        assert.equal(isFailedStatus(s), true);
      });
      assert.equal(isFailedStatus('ACTIVE'), false);
    });
  });

  describe('describeStatus', () => {
    it('maps setup statuses to their panel view and step', () => {
      assert.deepEqual(describeStatus('REGISTERED'), { view: 'records', step: 1, stepState: 'active' });
      assert.deepEqual(describeStatus('ISSUING_CERTIFICATE'), { view: 'issuing', step: 2, stepState: 'active' });
      assert.deepEqual(describeStatus('ACTIVE'), { view: 'live', step: 3, stepState: 'done' });
    });

    it('maps failure statuses to error views with the right step', () => {
      assert.equal(describeStatus('FAILED_TO_ONBOARD').view, 'error-onboard');
      assert.equal(describeStatus('FAILED_TO_ONBOARD').stepState, 'error');
      assert.equal(describeStatus('FAILED_TO_ISSUE_CERTIFICATES').step, 2);
    });

    it('maps removal statuses to step-less views', () => {
      assert.deepEqual(describeStatus('PENDING_DELETION'), { view: 'removal', step: null, stepState: null });
      assert.equal(describeStatus('DELETING').view, 'deleting');
      assert.equal(describeStatus('FAILED_TO_OFFBOARD').view, 'error-offboard');
    });

    it('returns null for an unknown status', () => {
      assert.equal(describeStatus('SOMETHING_ELSE'), null);
    });
  });

  describe('getStepIndicator', () => {
    it('has one entry per phase, labelled', () => {
      const steps = getStepIndicator('REGISTERED');
      assert.equal(steps.length, 3);
      assert.deepEqual(steps.map((s) => s.label), STEP_LABELS);
    });

    it('marks earlier steps done, the current one active, later ones todo', () => {
      assert.deepEqual(
        getStepIndicator('ISSUING_CERTIFICATE').map((s) => s.state),
        ['done', 'active', 'todo'],
      );
    });

    it('marks everything done at ACTIVE', () => {
      assert.deepEqual(
        getStepIndicator('ACTIVE').map((s) => s.state),
        ['done', 'done', 'done'],
      );
    });

    it('flags the failed step as error', () => {
      assert.deepEqual(
        getStepIndicator('FAILED_TO_ONBOARD').map((s) => s.state),
        ['error', 'todo', 'todo'],
      );
      assert.deepEqual(
        getStepIndicator('FAILED_TO_ISSUE_CERTIFICATES').map((s) => s.state),
        ['done', 'error', 'todo'],
      );
    });

    it('returns null for removal-flow statuses', () => {
      assert.equal(getStepIndicator('PENDING_DELETION'), null);
      assert.equal(getStepIndicator('DELETING'), null);
    });
  });
});
