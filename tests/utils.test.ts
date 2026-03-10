import { describe, expect, it, vi } from 'vitest';
import { formatTimestamp, splitHtml, splitText, truncateHtml } from '../src/utils';

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

describe('truncateHtml', () => {
  it('closes open inline tags after truncation', () => {
    expect(truncateHtml('<b>1234567890</b>', 12)).toEqual({
      text: '<b>12...</b>',
      truncated: true,
    });
  });

  it('does not split HTML entities at the truncation boundary', () => {
    expect(truncateHtml('AAAA &lt; BBBB', 10)).toEqual({
      text: 'AAAA ...',
      truncated: true,
    });
  });

  it('keeps multiline pre blocks valid after truncation', () => {
    expect(truncateHtml('<pre>line 1\nline 2\nline 3</pre>', 24)).toEqual({
      text: '<pre>line 1\nlin...</pre>',
      truncated: true,
    });
  });
});

describe('splitText', () => {
  it('splits a plain-text string into ordered chunks', () => {
    expect(splitText('abcdefgh', 3)).toEqual(['abc', 'def', 'gh']);
  });
});

describe('splitHtml', () => {
  it('splits long HTML into several valid parts without losing content', () => {
    expect(splitHtml('<b>ABCDEFGHIJKL</b>', 12)).toEqual([
      '<b>ABCDE</b>',
      '<b>FGHIJ</b>',
      '<b>KL</b>',
    ]);
  });
});
