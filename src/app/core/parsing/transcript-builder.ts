import { ParsedChat } from '../models/chat-message.model';
import { Participant } from '../models/participant.model';

export interface TranscriptOptions {
  anonymize: boolean;
  startMs?: number;
  endMs?: number;
  /** Keep only the most recent N messages after date filtering. */
  maxMessages?: number;
}

function anonymizedLabel(index: number): string {
  let n = index;
  let label = '';
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `Participant ${label}`;
}

export function buildDisplayNameMap(participants: Participant[], anonymize: boolean): Map<string, string> {
  const map = new Map<string, string>();
  participants.forEach((p, i) => {
    map.set(p.id, anonymize ? anonymizedLabel(i) : p.displayName);
  });
  return map;
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16);
}

/** Renders a plain-text transcript for the LLM payload: system/media-placeholder messages excluded, real content only. */
export function buildTranscript(chat: ParsedChat, options: TranscriptOptions): string {
  const displayNames = buildDisplayNameMap(chat.participants, options.anonymize);

  let messages = chat.messages.filter((m) => !m.isSystemMessage && !m.isMediaOmitted);
  if (options.startMs !== undefined) {
    messages = messages.filter((m) => m.timestampMs >= options.startMs!);
  }
  if (options.endMs !== undefined) {
    messages = messages.filter((m) => m.timestampMs <= options.endMs!);
  }
  if (options.maxMessages !== undefined && messages.length > options.maxMessages) {
    messages = messages.slice(messages.length - options.maxMessages);
  }

  return messages
    .map((m) => `[${formatTimestamp(m.timestampMs)}] ${displayNames.get(m.senderId) ?? m.senderId}: ${m.text}`)
    .join('\n');
}
