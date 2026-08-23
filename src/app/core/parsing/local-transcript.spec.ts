import { describe, expect, it } from 'vitest';
import { buildParticipantStats, cleanLine, parseTranscriptLines, renderLeanTranscript } from './local-transcript';

const KNOWN = [
  { id: 'alice', displayName: 'Alice' },
  { id: 'bob', displayName: 'Bob' },
];

describe('parseTranscriptLines', () => {
  it('parses standard [timestamp] Sender: text lines', () => {
    const transcript = ['[2024-05-01 09:00] Alice: hi', '[2024-05-01 09:01] Bob: hey'].join('\n');
    expect(parseTranscriptLines(transcript)).toEqual([
      { sender: 'Alice', text: 'hi' },
      { sender: 'Bob', text: 'hey' },
    ]);
  });

  it('appends wrapped continuation lines to the previous message', () => {
    const transcript = ['[2024-05-01 09:00] Alice: first line', 'second line'].join('\n');
    expect(parseTranscriptLines(transcript)).toEqual([{ sender: 'Alice', text: 'first line\nsecond line' }]);
  });

  it('returns an empty array for an empty transcript', () => {
    expect(parseTranscriptLines('')).toEqual([]);
  });
});

describe('cleanLine', () => {
  it('replaces raw URLs with [link]', () => {
    expect(cleanLine('check this out https://example.com/path?q=1 nice')).toBe('check this out [link] nice');
  });

  it('leaves text without URLs unchanged', () => {
    expect(cleanLine('no links here')).toBe('no links here');
  });
});

describe('buildParticipantStats', () => {
  it('counts messages per known participant', () => {
    const lines = parseTranscriptLines(
      ['[2024-05-01 09:00] Alice: a', '[2024-05-01 09:01] Alice: b', '[2024-05-01 09:02] Bob: c'].join('\n'),
    );
    expect(buildParticipantStats(lines, KNOWN)).toBe('Alice: 2 messages\nBob: 1 messages');
  });

  it('reports zero for a known participant with no lines', () => {
    expect(buildParticipantStats([], KNOWN)).toBe('Alice: 0 messages\nBob: 0 messages');
  });
});

describe('renderLeanTranscript', () => {
  it('drops timestamps and cleans URLs', () => {
    const lines = parseTranscriptLines('[2024-05-01 09:00] Alice: see https://example.com now');
    expect(renderLeanTranscript(lines)).toBe('Alice: see [link] now');
  });
});
