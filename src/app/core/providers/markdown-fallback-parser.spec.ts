import { describe, expect, it } from 'vitest';
import { parseMarkdownFallback } from './markdown-fallback-parser';

const KNOWN_PARTICIPANTS = [
  { id: 'alice', displayName: 'Alice' },
  { id: 'bob', displayName: 'Bob' },
];

const MARKDOWN = `
## The Group Dynamic

> This group runs on chaos and group-chat guilt.

The chat is dominated by two very different energies, constantly negotiating who apologizes first.

## Alice — The Overthinker

**Archetype:** The Overthinker

"Alice reads every message like it's a legal document."

**Behavioral Summary:** Alice double-texts within four minutes of silence.

**Strengths:**
- Always shows up
- Remembers everyone's birthday

**Red Flags:**
- Spirals over a single blue checkmark
- Screenshots things "just in case"

## Bob — The Ghost

**Archetype:** The Ghost

"Bob replies to a 2019 message like it just came in."

**Strengths:**
- Chill under pressure

**Red Flags:**
- Reads at 8am, replies at 11pm

## Superlatives

- **Most Likely to Leave You on Read** — Bob: A certified read-and-run artist.
- **Most Likely to Send a Novel** — Alice: Three paragraphs for a yes/no question.
`;

describe('parseMarkdownFallback', () => {
  it('extracts the group audit with its quote pulled out', () => {
    const result = parseMarkdownFallback(MARKDOWN, KNOWN_PARTICIPANTS);
    expect(result?.groupAudit.title).toBe('The Group Dynamic');
    expect(result?.groupAudit.verdictQuote).toContain('chaos');
  });

  it('extracts one dossier per matched participant heading', () => {
    const result = parseMarkdownFallback(MARKDOWN, KNOWN_PARTICIPANTS);
    expect(result?.dossiers).toHaveLength(2);
    const alice = result?.dossiers.find((d) => d.participantId === 'alice');
    expect(alice?.archetype).toBe('The Overthinker');
    expect(alice?.behavioralSummary).toBe('Alice double-texts within four minutes of silence.');
    expect(alice?.strengths).toEqual(['Always shows up', "Remembers everyone's birthday"]);
    expect(alice?.redFlags).toEqual(['Spirals over a single blue checkmark', 'Screenshots things "just in case"']);
  });

  it('extracts superlatives and maps them to participant ids', () => {
    const result = parseMarkdownFallback(MARKDOWN, KNOWN_PARTICIPANTS);
    expect(result?.superlatives).toHaveLength(2);
    const readAndRun = result?.superlatives.find((s) => s.title === 'Most Likely to Leave You on Read');
    expect(readAndRun?.participantId).toBe('bob');
  });

  it('returns null when no dossier sections can be matched', () => {
    const result = parseMarkdownFallback('## Just some prose\nwith no structure.', KNOWN_PARTICIPANTS);
    expect(result).toBeNull();
  });
});
