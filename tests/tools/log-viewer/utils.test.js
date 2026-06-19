import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  pad,
  toDateTimeLocal,
  toUTCDate,
  calculatePastDate,
} from '../../../tools/log-viewer/utils.js';

describe('log-viewer:utils.js', () => {
  describe('pad', () => {
    it('pads single-digit numbers with a leading zero', () => {
      assert.equal(pad(5), '05');
    });

    it('does not pad two-digit numbers', () => {
      assert.equal(pad(12), '12');
    });

    it('handles 0', () => {
      assert.equal(pad(0), '00');
    });
  });

  describe('toDateTimeLocal', () => {
    it('formats a date to YYYY-MM-DDTHH:MM', () => {
      const date = new Date(2024, 0, 5, 9, 3); // Jan 5, 2024 09:03 local
      assert.equal(toDateTimeLocal(date), '2024-01-05T09:03');
    });

    it('pads month, day, hours, and minutes when single digit', () => {
      const date = new Date(2023, 2, 7, 8, 4); // Mar 7, 2023 08:04 local
      assert.equal(toDateTimeLocal(date), '2023-03-07T08:04');
    });

    it('handles double-digit values without extra padding', () => {
      const date = new Date(2020, 11, 31, 23, 59); // Dec 31, 2020 23:59 local
      assert.equal(toDateTimeLocal(date), '2020-12-31T23:59');
    });
  });

  describe('toUTCDate', () => {
    it('formats a UTC timestamp to MM/DD/YYYY HH:MM UTC', () => {
      const date = new Date('2024-01-05T09:03:00Z');
      assert.equal(toUTCDate(date), '01/05/2024 09:03 UTC');
    });

    it('pads single-digit UTC month, day, hours, and minutes', () => {
      const date = new Date('2023-03-07T08:04:00Z');
      assert.equal(toUTCDate(date), '03/07/2023 08:04 UTC');
    });

    it('correctly uses UTC values regardless of local timezone', () => {
      const date = new Date('2024-06-01T00:00:00Z');
      assert.equal(toUTCDate(date), '06/01/2024 00:00 UTC');
    });
  });

  describe('calculatePastDate', () => {
    it('subtracts days from the reference date', () => {
      const ref = new Date(2024, 2, 10, 12, 0, 0); // Mar 10 2024 12:00 local
      const result = calculatePastDate(2, 0, 0, new Date(ref));
      assert.equal(result.getDate(), 8);
      assert.equal(result.getMonth(), 2);
    });

    it('subtracts hours from the reference date', () => {
      const ref = new Date(2024, 2, 10, 12, 0, 0); // Mar 10 2024 12:00 local
      const result = calculatePastDate(0, 3, 0, new Date(ref));
      assert.equal(result.getHours(), 9);
    });

    it('subtracts minutes from the reference date', () => {
      const ref = new Date(2024, 2, 10, 12, 30, 0); // Mar 10 2024 12:30 local
      const result = calculatePastDate(0, 0, 30, new Date(ref));
      assert.equal(result.getMinutes(), 0);
      assert.equal(result.getHours(), 12);
    });

    it('handles all three offsets together', () => {
      const ref = new Date(2024, 2, 10, 12, 30, 0); // Mar 10 2024 12:30 local
      const result = calculatePastDate(1, 2, 15, new Date(ref));
      assert.equal(result.getDate(), 9);
      assert.equal(result.getHours(), 10);
      assert.equal(result.getMinutes(), 15);
    });

    it('does not modify any component when all params are 0', () => {
      const ref = new Date(2024, 2, 10, 12, 30, 0); // Mar 10 2024 12:30 local
      const result = calculatePastDate(0, 0, 0, new Date(ref));
      assert.equal(result.getFullYear(), 2024);
      assert.equal(result.getMonth(), 2);
      assert.equal(result.getDate(), 10);
      assert.equal(result.getHours(), 12);
      assert.equal(result.getMinutes(), 30);
    });
  });
});
