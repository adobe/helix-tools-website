import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import getToolIcon from '../utils.js';

describe('eds-agent:utils.js', () => {
  describe('getToolIcon', () => {
    it('returns the default icon for empty input', () => {
      assert.equal(getToolIcon(''), 'S2_Icon_InfoCircleBlue_20_N');
      assert.equal(getToolIcon(null), 'S2_Icon_InfoCircleBlue_20_N');
      assert.equal(getToolIcon(undefined), 'S2_Icon_InfoCircleBlue_20_N');
    });

    it('maps sidekick / config tool names to Edit', () => {
      assert.equal(getToolIcon('update_sidekick_config'), 'S2_Icon_Edit_20_N');
      assert.equal(getToolIcon('updateSidekickConfig'), 'S2_Icon_Edit_20_N');
      assert.equal(getToolIcon('update_config'), 'S2_Icon_Edit_20_N');
    });

    it('maps audit / log / history tool names to DocumentFragment', () => {
      assert.equal(getToolIcon('query_audit_log'), 'Smock_DocumentFragment_18_N');
      assert.equal(getToolIcon('get_history'), 'Smock_DocumentFragment_18_N');
      assert.equal(getToolIcon('list_logs'), 'Smock_DocumentFragment_18_N');
    });

    it('maps publish / preview tool names to Publish', () => {
      assert.equal(getToolIcon('publish_page'), 'S2_Icon_Publish_20_N');
      assert.equal(getToolIcon('preview_url'), 'S2_Icon_Publish_20_N');
    });

    it('is case-insensitive', () => {
      assert.equal(getToolIcon('UPDATE_SIDEKICK_CONFIG'), 'S2_Icon_Edit_20_N');
      assert.equal(getToolIcon('Publish_Page'), 'S2_Icon_Publish_20_N');
    });

    it('returns the default for unknown tool names', () => {
      assert.equal(getToolIcon('weather_api'), 'S2_Icon_InfoCircleBlue_20_N');
      assert.equal(getToolIcon('random_xyz'), 'S2_Icon_InfoCircleBlue_20_N');
    });
  });
});
