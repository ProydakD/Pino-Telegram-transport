import { describe, expect, it, vi } from 'vitest';
import { formatTimestamp } from '../src/utils';

describe('formatTimestamp', () => {
  it('returns the original string for an invalid date string', () => {
    expect(formatTimestamp('not-a-date')).toBe('not-a-date');
  });

  it('returns the original numeric value as a string for an invalid date number', () => {
    expect(formatTimestamp(Number.NaN)).toBe('NaN');
  });

  it('uses the current ISO timestamp only when time is missing', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2024-01-01T12:34:56.789Z'));

      expect(formatTimestamp()).toBe('2024-01-01T12:34:56.789Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('formats a valid timestamp as ISO 8601', () => {
    expect(formatTimestamp(1700000000000)).toBe('2023-11-14T22:13:20.000Z');
  });
});
