import { ChatExportFormat, ChatMessage, ChatStats, ParsedChat } from '../models/chat-message.model';
import { Participant } from '../models/participant.model';

const NARROW_NBSP = ' ';
const LRM = '‎';
const RLM = '‏';

// Android: "5/1/24, 2:32 PM - Alice: text" or "05/01/2024, 14:32 - Alice: text"
const ANDROID_LINE =
  /^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap]\.?[Mm]\.?)?)\s-\s(.*)$/;

// iOS: "[5/1/24, 2:32:45 PM] Alice: text"
const IOS_LINE = /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap]\.?[Mm]\.?)?)\]\s(.*)$/;

// Splits "Sender: message body" from a system line that has no sender prefix at all.
const SENDER_SPLIT = /^([^:]{1,64}?):\s(.*)$/s;

const MEDIA_OMITTED_PATTERNS = [
  /^<Media omitted>$/i,
  /^(image|video|audio|GIF|sticker|document) omitted$/i,
  /^<attached:.*>$/i,
];

const DELETED_PATTERNS = [/^This message was deleted$/i, /^You deleted this message$/i];

function stripInvisible(line: string): string {
  return line.replace(new RegExp(`[${LRM}${RLM}]`, 'g'), '').replace(new RegExp(NARROW_NBSP, 'g'), ' ');
}

function parseTimestamp(dateStr: string, timeStr: string): number | null {
  // WhatsApp exports the date in the device locale's order. We assume DD/MM/YY unless
  // the first segment can't be a day (>12), in which case we treat it as MM/DD/YY.
  const parts = dateStr.split('/').map((s) => parseInt(s, 10));
  const [a, b, yRaw] = parts;
  if (a === undefined || b === undefined || yRaw === undefined || [a, b, yRaw].some(Number.isNaN)) {
    return null;
  }
  let day = a;
  let month = b;
  if (a > 12 && b <= 12) {
    month = a;
    day = b;
  }
  const year = yRaw < 100 ? 2000 + yRaw : yRaw;

  const timeMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s?([APap]\.?[Mm]\.?)?$/.exec(timeStr.trim());
  if (!timeMatch) return null;
  let hours = parseInt(timeMatch[1], 10);
  const minutes = parseInt(timeMatch[2], 10);
  const seconds = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
  const meridiem = timeMatch[4]?.toLowerCase().replace(/\./g, '');
  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;

  const date = new Date(year, month - 1, day, hours, minutes, seconds);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

interface MatchedLine {
  timestampMs: number;
  rest: string;
  isIos: boolean;
}

function matchLine(line: string): MatchedLine | null {
  const clean = stripInvisible(line);
  const ios = IOS_LINE.exec(clean);
  if (ios) {
    const ts = parseTimestamp(ios[1], ios[2]);
    if (ts !== null) return { timestampMs: ts, rest: ios[3], isIos: true };
  }
  const android = ANDROID_LINE.exec(clean);
  if (android) {
    const ts = parseTimestamp(android[1], android[2]);
    if (ts !== null) return { timestampMs: ts, rest: android[3], isIos: false };
  }
  return null;
}

function isMediaOrDeleted(text: string): boolean {
  const trimmed = text.trim();
  return MEDIA_OMITTED_PATTERNS.some((p) => p.test(trimmed)) || DELETED_PATTERNS.some((p) => p.test(trimmed));
}

function looksLikePhoneNumber(name: string): boolean {
  const stripped = name.replace(/[\s()-]/g, '');
  return /^\+?\d{6,}$/.test(stripped);
}

let messageIdCounter = 0;
function nextMessageId(): string {
  messageIdCounter += 1;
  return `m${messageIdCounter}`;
}

export function computeChatStats(messages: ChatMessage[], participantCount: number): ChatStats {
  const realMessages = messages.filter((m) => !m.isSystemMessage);
  const timestamps = realMessages.map((m) => m.timestampMs).sort((a, b) => a - b);
  let longestGapMs: number | null = null;
  for (let i = 1; i < timestamps.length; i++) {
    const gap = timestamps[i] - timestamps[i - 1];
    if (longestGapMs === null || gap > longestGapMs) longestGapMs = gap;
  }
  return {
    messageCount: realMessages.length,
    participantCount,
    dateRangeStart: timestamps[0] ?? null,
    dateRangeEnd: timestamps[timestamps.length - 1] ?? null,
    longestGapMs,
  };
}

export function parseWhatsAppExport(rawText: string): ParsedChat {
  const text = rawText.replace(/^﻿/, '');
  const lines = text.split(/\r\n|\r|\n/);

  const messages: ChatMessage[] = [];
  const participantOrder: string[] = [];
  const participantMeta = new Map<string, { rawName: string; count: number }>();

  let current: ChatMessage | null = null;
  let sawIos = false;
  let sawAndroid = false;

  for (const rawLine of lines) {
    if (rawLine.trim().length === 0 && current === null) continue;

    const matched = matchLine(rawLine);
    if (matched) {
      if (matched.isIos) sawIos = true;
      else sawAndroid = true;

      const senderSplit = SENDER_SPLIT.exec(matched.rest);
      if (senderSplit) {
        const rawName = senderSplit[1].trim();
        const body = senderSplit[2];
        const isMediaOmitted = isMediaOrDeleted(body);
        const senderId = rawName.toLowerCase();

        if (!participantMeta.has(senderId)) {
          participantMeta.set(senderId, { rawName, count: 0 });
          participantOrder.push(senderId);
        }
        participantMeta.get(senderId)!.count += 1;

        current = {
          id: nextMessageId(),
          senderId,
          timestampMs: matched.timestampMs,
          text: body,
          isSystemMessage: false,
          isMediaOmitted,
        };
      } else {
        current = {
          id: nextMessageId(),
          senderId: '__system__',
          timestampMs: matched.timestampMs,
          text: matched.rest,
          isSystemMessage: true,
          isMediaOmitted: false,
        };
      }
      messages.push(current);
    } else if (current) {
      current.text += `\n${rawLine}`;
    }
  }

  const format: ChatExportFormat = sawIos && !sawAndroid ? 'ios' : 'android';

  const participants: Participant[] = participantOrder.map((id) => {
    const meta = participantMeta.get(id)!;
    return {
      id,
      rawName: meta.rawName,
      displayName: meta.rawName,
      messageCount: meta.count,
      looksLikePhoneNumber: looksLikePhoneNumber(meta.rawName),
    };
  });

  const stats = computeChatStats(messages, participants.length);

  return { format, messages, participants, stats };
}
