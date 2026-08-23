import { describe, expect, it } from 'vitest';
import { MAX_QUOTE_CHARS, truncateQuote } from './truncate-quote';

describe('truncateQuote', () => {
  it('leaves a short quote exactly as it is', () => {
    expect(truncateQuote('short enough to keep')).toBe('short enough to keep');
  });

  it('leaves a quote sitting exactly on the cap alone', () => {
    const exact = 'a'.repeat(MAX_QUOTE_CHARS);
    expect(truncateQuote(exact)).toBe(exact);
  });

  it('caps a long quote and marks it as cut', () => {
    const result = truncateQuote('word '.repeat(500));
    expect(result.length).toBeLessThanOrEqual(MAX_QUOTE_CHARS + 1); // +1 for the ellipsis
    expect(result.endsWith('…')).toBe(true);
  });

  it('cuts at a word boundary rather than mid-word', () => {
    const result = truncateQuote(`${'alpha bravo '.repeat(40)}charlie`, 30);
    expect(result).toBe('alpha bravo alpha bravo alpha…');
  });

  it('falls back to a hard cut when honoring the word boundary would gut the quote', () => {
    // One enormous unbroken token — there is no usable space to cut at.
    const result = truncateQuote('x'.repeat(100), 20);
    expect(result).toBe(`${'x'.repeat(20)}…`);
  });
});
