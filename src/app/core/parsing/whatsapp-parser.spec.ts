import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport } from './whatsapp-parser';

const ANDROID_EXPORT = [
  '5/1/24, 2:00 PM - Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.',
  '5/1/24, 2:30 PM - Alice created group "Trip 2024"',
  '5/1/24, 2:32 PM - Alice: Hey, are we still on for tonight?',
  "5/1/24, 2:33 PM - Bob: yeah! I'll bring",
  'the snacks',
  '5/1/24, 2:35 PM - Alice: <Media omitted>',
  '5/1/24, 5:40 PM - +1 555-123-4567: perfect, see you then',
].join('\n');

const IOS_EXPORT = [
  '[5/1/24, 2:32:10 PM] Alice: Hey, are we still on for tonight?',
  "[5/1/24, 2:33:05 PM] Bob: yeah! I'll bring",
  'the snacks',
  '[5/1/24, 2:35:00 PM] Alice: image omitted',
].join('\n');

describe('parseWhatsAppExport', () => {
  it('detects the Android export format', () => {
    expect(parseWhatsAppExport(ANDROID_EXPORT).format).toBe('android');
  });

  it('detects the iOS export format', () => {
    expect(parseWhatsAppExport(IOS_EXPORT).format).toBe('ios');
  });

  it('excludes system messages from stats but keeps them out of participants', () => {
    const parsed = parseWhatsAppExport(ANDROID_EXPORT);
    expect(parsed.stats.messageCount).toBe(4);
    expect(parsed.participants.map((p) => p.rawName)).not.toContain('__system__');
  });

  it('joins multi-line message continuations onto the previous message', () => {
    const parsed = parseWhatsAppExport(ANDROID_EXPORT);
    const bobMessage = parsed.messages.find((m) => m.senderId === 'bob');
    expect(bobMessage?.text).toBe("yeah! I'll bring\nthe snacks");
  });

  it('flags <Media omitted> and platform-specific omitted variants without breaking parsing', () => {
    const androidMedia = parseWhatsAppExport(ANDROID_EXPORT).messages.find((m) => m.text === '<Media omitted>');
    expect(androidMedia?.isMediaOmitted).toBe(true);

    const iosMedia = parseWhatsAppExport(IOS_EXPORT).messages.find((m) => m.text === 'image omitted');
    expect(iosMedia?.isMediaOmitted).toBe(true);
  });

  it('detects phone-number-style sender identifiers', () => {
    const parsed = parseWhatsAppExport(ANDROID_EXPORT);
    const phoneParticipant = parsed.participants.find((p) => p.rawName === '+1 555-123-4567');
    const alice = parsed.participants.find((p) => p.rawName === 'Alice');
    expect(phoneParticipant?.looksLikePhoneNumber).toBe(true);
    expect(alice?.looksLikePhoneNumber).toBe(false);
  });

  it('counts messages per participant, including media placeholders', () => {
    const parsed = parseWhatsAppExport(ANDROID_EXPORT);
    const alice = parsed.participants.find((p) => p.rawName === 'Alice');
    expect(alice?.messageCount).toBe(2);
  });

  it('computes the longest gap between consecutive real messages', () => {
    const parsed = parseWhatsAppExport(ANDROID_EXPORT);
    expect(parsed.stats.longestGapMs).toBe(3 * 60 * 60 * 1000 + 5 * 60 * 1000);
  });

  it('strips a leading UTF-8 BOM before parsing', () => {
    const withBom = '﻿' + ANDROID_EXPORT;
    expect(parseWhatsAppExport(withBom).stats.messageCount).toBe(4);
  });
});
