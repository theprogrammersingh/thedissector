import { Participant } from './participant.model';

export type ChatExportFormat = 'android' | 'ios';

export interface ChatMessage {
  id: string;
  senderId: string;
  timestampMs: number;
  text: string;
  isSystemMessage: boolean;
  isMediaOmitted: boolean;
}

export interface ChatStats {
  messageCount: number;
  participantCount: number;
  dateRangeStart: number | null;
  dateRangeEnd: number | null;
  longestGapMs: number | null;
}

export interface ParsedChat {
  format: ChatExportFormat;
  messages: ChatMessage[];
  participants: Participant[];
  stats: ChatStats;
}
