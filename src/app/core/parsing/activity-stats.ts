import { ParsedChat } from '../models/chat-message.model';

export interface ParticipantActivity {
  participantId: string;
  displayName: string;
  messagesPerDay: number;
}

const MS_PER_DAY = 86_400_000;

export function computeParticipantActivity(chat: ParsedChat): ParticipantActivity[] {
  const { dateRangeStart, dateRangeEnd } = chat.stats;
  if (dateRangeStart === null || dateRangeEnd === null) return [];

  const totalChatDays = Math.max(1, Math.round((dateRangeEnd - dateRangeStart) / MS_PER_DAY));

  return chat.participants.map((p) => ({
    participantId: p.id,
    displayName: p.displayName,
    messagesPerDay: p.messageCount / totalChatDays,
  }));
}
