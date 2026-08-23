export interface TranscriptLine {
  sender: string;
  text: string;
}

const LINE_PATTERN = /^\[[^\]]*\]\s(.+?):\s(.*)$/s;
const URL_PATTERN = /https?:\/\/\S+/gi;

/** Parses the `[timestamp] Sender: text` lines produced by buildTranscript() into structured tuples. */
export function parseTranscriptLines(transcript: string): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  for (const rawLine of transcript.split('\n')) {
    const match = LINE_PATTERN.exec(rawLine);
    if (match) {
      lines.push({ sender: match[1], text: match[2] });
    } else if (lines.length > 0 && rawLine.length > 0) {
      // A wrapped/multi-line message continuation — append to the previous line's text.
      lines[lines.length - 1].text += `\n${rawLine}`;
    }
  }
  return lines;
}

/** Strips raw URLs so they don't eat attention budget the model can't otherwise make use of. */
export function cleanLine(text: string): string {
  return text.replace(URL_PATTERN, '[link]');
}

/**
 * A compact "Name: N messages" block computed deterministically from already-parsed lines,
 * so the model is never asked to count anything itself.
 */
export function buildParticipantStats(
  lines: TranscriptLine[],
  knownParticipants: { id: string; displayName: string }[],
): string {
  const counts = new Map<string, number>();
  for (const p of knownParticipants) counts.set(p.displayName, 0);
  for (const line of lines) {
    if (counts.has(line.sender)) counts.set(line.sender, (counts.get(line.sender) ?? 0) + 1);
  }
  return knownParticipants.map((p) => `${p.displayName}: ${counts.get(p.displayName) ?? 0} messages`).join('\n');
}

/** Re-serializes parsed lines as "Sender: text" — no timestamps, cleaned of raw URLs. */
export function renderLeanTranscript(lines: TranscriptLine[]): string {
  return lines.map((l) => `${l.sender}: ${cleanLine(l.text)}`).join('\n');
}
