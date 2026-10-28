import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePath,
  classifySequenceStatus,
  hasSourceListing,
  fetchContentSourceType,
} from '../../../tools/page-status/utils.js';

describe('validatePath', () => {
  it('returns /* for empty input', () => assert.equal(validatePath(''), '/*'));
  it('returns /* for null', () => assert.equal(validatePath(null), '/*'));
  it('returns /* for undefined', () => assert.equal(validatePath(undefined), '/*'));

  it('appends /* to a bare path', () => assert.equal(validatePath('/blog'), '/blog/*'));
  it('normalises a path that already ends with /', () => assert.equal(validatePath('/blog/'), '/blog/*'));
  it('handles a multi-segment path', () => assert.equal(validatePath('/a/b/c'), '/a/b/c/*'));

  it('extracts path from a URL without protocol', () => {
    assert.equal(validatePath('example.com/foo/bar'), '/foo/bar/*');
  });

  it('extracts path from a URL with protocol', () => {
    assert.equal(validatePath('https://example.com/foo/bar'), '/foo/bar/*');
  });
});

describe('classifySequenceStatus', () => {
  const OLD = '2024-01-01T00:00:00Z';
  const MID = '2024-06-01T00:00:00Z';
  const NEW = '2024-12-01T00:00:00Z';

  it('No source / negative when edit is invalid', () => {
    const r = classifySequenceStatus('not-a-date', MID, NEW);
    assert.equal(r.label, 'No source');
    assert.equal(r.modifier, 'negative');
  });

  it('Not previewed / positive when only edit date is valid', () => {
    const r = classifySequenceStatus(OLD, '', '');
    assert.equal(r.label, 'Not previewed');
    assert.equal(r.modifier, 'positive');
  });

  it('Not published / positive when edit ≤ preview, no publish', () => {
    const r = classifySequenceStatus(OLD, MID, '');
    assert.equal(r.label, 'Not published');
    assert.equal(r.modifier, 'positive');
  });

  it('Current / positive when edit ≤ preview ≤ publish', () => {
    const r = classifySequenceStatus(OLD, MID, NEW);
    assert.equal(r.label, 'Current');
    assert.equal(r.modifier, 'positive');
  });

  it('Pending changes / positive when preview > publish', () => {
    const r = classifySequenceStatus(OLD, NEW, MID);
    assert.equal(r.label, 'Pending changes');
    assert.equal(r.modifier, 'positive');
  });

  it('Pending changes / positive when edit > publish', () => {
    const r = classifySequenceStatus(NEW, MID, OLD);
    assert.equal(r.label, 'Pending changes');
    assert.equal(r.modifier, 'positive');
  });

  [undefined, null].forEach((edit) => {
    it(`No source / negative when edit is ${edit} and source is expected`, () => {
      const r = classifySequenceStatus(edit, MID, NEW);
      assert.equal(r.label, 'No source');
      assert.equal(r.modifier, 'negative');
    });
  });

  describe('without source listing', () => {
    const opts = { sourceExpected: false };
    [undefined, null].forEach((edit) => {
      it(`Not published when only preview exists [edit=${edit}]`, () => {
        const r = classifySequenceStatus(edit, MID, undefined, opts);
        assert.equal(r.label, 'Not published');
        assert.equal(r.modifier, 'positive');
      });

      it(`Current when only publish exists [edit=${edit}]`, () => {
        const r = classifySequenceStatus(edit, undefined, MID, opts);
        assert.equal(r.label, 'Current');
        assert.equal(r.modifier, 'positive');
      });

      it(`Current when preview ≤ publish [edit=${edit}]`, () => {
        const r = classifySequenceStatus(edit, MID, NEW, opts);
        assert.equal(r.label, 'Current');
        assert.equal(r.modifier, 'positive');
      });

      it(`Pending changes when preview > publish [edit=${edit}]`, () => {
        const r = classifySequenceStatus(edit, NEW, MID, opts);
        assert.equal(r.label, 'Pending changes');
        assert.equal(r.modifier, 'positive');
      });

      it(`No source when nothing exists [edit=${edit}]`, () => {
        const r = classifySequenceStatus(edit, undefined, undefined, opts);
        assert.equal(r.label, 'No source');
        assert.equal(r.modifier, 'negative');
      });
    });

    it('still uses edit date when present', () => {
      const r = classifySequenceStatus(NEW, MID, OLD, opts);
      assert.equal(r.label, 'Pending changes');
    });
  });

  describe('with unknown publish state', () => {
    const opts = { publishKnown: false };

    it('Publish unknown / notice when previewed after edit', () => {
      const r = classifySequenceStatus(OLD, MID, undefined, opts);
      assert.equal(r.label, 'Publish unknown');
      assert.equal(r.modifier, 'notice');
    });

    it('Publish unknown / notice when previewed without source listing', () => {
      const r = classifySequenceStatus(undefined, MID, undefined, {
        ...opts, sourceExpected: false,
      });
      assert.equal(r.label, 'Publish unknown');
      assert.equal(r.modifier, 'notice');
    });

    it('Pending changes when edit is newer than preview', () => {
      const r = classifySequenceStatus(NEW, MID, undefined, opts);
      assert.equal(r.label, 'Pending changes');
      assert.equal(r.modifier, 'positive');
    });

    it('Not previewed when only edit exists', () => {
      const r = classifySequenceStatus(OLD, undefined, undefined, opts);
      assert.equal(r.label, 'Not previewed');
    });

    it('No source when source is expected and missing', () => {
      const r = classifySequenceStatus(undefined, MID, undefined, opts);
      assert.equal(r.label, 'No source');
      assert.equal(r.modifier, 'negative');
    });
  });
});

describe('hasSourceListing', () => {
  it('H5 lists google and onedrive', () => {
    assert.equal(hasSourceListing('google', false), true);
    assert.equal(hasSourceListing('onedrive', false), true);
  });

  it('H5 does not list markup', () => {
    assert.equal(hasSourceListing('markup', false), false);
  });

  it('H6 lists sourcebus only', () => {
    assert.equal(hasSourceListing('sourcebus', true), true);
    assert.equal(hasSourceListing('google', true), false);
    assert.equal(hasSourceListing('onedrive', true), false);
    assert.equal(hasSourceListing('markup', true), false);
  });

  it('defaults to listed when type is unknown', () => {
    assert.equal(hasSourceListing(undefined, false), true);
    assert.equal(hasSourceListing(undefined, true), true);
  });
});

describe('fetchContentSourceType', () => {
  const mockAdmin = (res) => {
    const calls = [];
    return {
      calls,
      sidekick: (coords) => ({
        get: async (path) => {
          calls.push({ coords, path });
          if (res instanceof Error) throw res;
          return res;
        },
      }),
    };
  };
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });

  it('reads H5 sidekick config.json', async () => {
    const admin = mockAdmin(ok({ contentSourceType: 'markup' }));
    assert.equal(await fetchContentSourceType(admin, 'o', 's', false), 'markup');
    assert.deepEqual(admin.calls, [{ coords: { org: 'o', site: 's' }, path: 'config.json' }]);
  });

  it('reads H6 sidekick root', async () => {
    const admin = mockAdmin(ok({ contentSourceType: 'sourcebus' }));
    assert.equal(await fetchContentSourceType(admin, 'o', 's', true), 'sourcebus');
    assert.equal(admin.calls[0].path, '');
  });

  it('returns undefined on error response', async () => {
    const admin = mockAdmin({ ok: false, status: 401 });
    assert.equal(await fetchContentSourceType(admin, 'o', 's', false), undefined);
  });

  it('returns undefined when the request throws', async () => {
    const admin = mockAdmin(new Error('boom'));
    assert.equal(await fetchContentSourceType(admin, 'o', 's', false), undefined);
  });
});
