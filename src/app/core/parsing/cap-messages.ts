import { ParsedChat } from '../models/chat-message.model';
import { computeChatStats } from './whatsapp-parser';

/**
 * A view of the chat holding only its most recent `maxMessages` real messages.
 *
 * Used on the on-device path, where the constraint is not prompt size — the evidence pack has its
 * own token budget — but the forensics passes, which embed and classify message-by-message and are
 * the slowest part of a local run by a wide margin on a long export.
 *
 * `participants[].messageCount` and `stats` are recomputed rather than carried over, because both
 * are shown to the user and fed to the model: the evidence pack's MESSAGE COUNTS block would
 * otherwise describe a conversation wider than the one actually analyzed.
 *
 * "Most recent N" matches `buildTranscript`'s existing tail-slice semantics deliberately — two
 * different meanings of the same phrase in one app would be its own bug.
 */
export function capRecentMessages(chat: ParsedChat, maxMessages: number): ParsedChat {
  const real = chat.messages.filter((m) => !m.isSystemMessage && !m.isMediaOmitted);
  if (real.length <= maxMessages) return chat;

  const messages = real.slice(real.length - maxMessages);

  const counts = new Map<string, number>();
  for (const message of messages) {
    counts.set(message.senderId, (counts.get(message.senderId) ?? 0) + 1);
  }

  // Participants who said nothing inside the window are dropped: a dossier built from zero
  // messages is exactly the kind of invention the evidence path exists to prevent.
  const participants = chat.participants
    .filter((p) => (counts.get(p.id) ?? 0) > 0)
    .map((p) => ({ ...p, messageCount: counts.get(p.id) ?? 0 }));

  return {
    ...chat,
    messages,
    participants,
    stats: computeChatStats(messages, participants.length),
  };
}
