import { ParsedChat } from '../models/chat-message.model';
import { estimateTokenCount } from '../../shared/utils/token-estimate';
import { buildTranscript, TranscriptOptions } from './transcript-builder';

export interface TrimResult {
  transcript: string;
  wasAutoTrimmed: boolean;
  keptMessageCount: number;
  candidateMessageCount: number;
  estimatedTokens: number;
}

/**
 * Builds the transcript for the user's chosen date range / message cap, then — if it still
 * exceeds the model's context budget — repeatedly drops the oldest remaining messages until
 * it fits. This is the MVP's "hard truncation with a visible warning" strategy (PRD FR-3);
 * map-reduce summarization for oversized chats is out of scope for v1.
 */
export function buildTrimmedTranscript(
  chat: ParsedChat,
  options: TranscriptOptions,
  contextWindowTokens: number,
  reservedForPromptAndOutputTokens: number,
): TrimResult {
  const usableBudget = Math.max(contextWindowTokens - reservedForPromptAndOutputTokens, 1000);

  let candidateMessages = chat.messages.filter((m) => !m.isSystemMessage && !m.isMediaOmitted);
  if (options.startMs !== undefined) {
    candidateMessages = candidateMessages.filter((m) => m.timestampMs >= options.startMs!);
  }
  if (options.endMs !== undefined) {
    candidateMessages = candidateMessages.filter((m) => m.timestampMs <= options.endMs!);
  }
  if (options.maxMessages !== undefined && candidateMessages.length > options.maxMessages) {
    candidateMessages = candidateMessages.slice(candidateMessages.length - options.maxMessages);
  }

  const candidateMessageCount = candidateMessages.length;
  let keptCount = candidateMessageCount;
  let transcript = buildTranscript(chat, { ...options, maxMessages: keptCount });
  let estimatedTokens = estimateTokenCount(transcript);

  while (estimatedTokens > usableBudget && keptCount > 1) {
    keptCount = Math.max(1, Math.floor(keptCount * 0.9));
    transcript = buildTranscript(chat, { ...options, maxMessages: keptCount });
    estimatedTokens = estimateTokenCount(transcript);
  }

  return {
    transcript,
    wasAutoTrimmed: keptCount < candidateMessageCount,
    keptMessageCount: keptCount,
    candidateMessageCount,
    estimatedTokens,
  };
}
