import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport } from './whatsapp-parser';
import { computeParticipantActivity } from './activity-stats';

describe('computeParticipantActivity', () => {
  it('divides each participant message count by the chat date span in days', () => {
    const chat = parseWhatsAppExport(
      [
        '1/5/24, 9:00 AM - Alice: one',
        '1/5/24, 9:01 AM - Alice: two',
        '1/5/24, 9:02 AM - Bob: hi',
        '3/5/24, 9:00 AM - Alice: three',
        '3/5/24, 9:01 AM - Alice: four',
        '3/5/24, 9:02 AM - Bob: hey',
      ].join('\n'),
    );

    const activity = computeParticipantActivity(chat);

    expect(activity).toEqual([
      { participantId: 'alice', displayName: 'Alice', messagesPerDay: 2 },
      { participantId: 'bob', displayName: 'Bob', messagesPerDay: 1 },
    ]);
  });

  it('returns an empty array when the chat has no dated real messages', () => {
    const chat = parseWhatsAppExport(
      '1/5/24, 9:00 AM - Messages to this group are now secured with end-to-end encryption.',
    );

    expect(computeParticipantActivity(chat)).toEqual([]);
  });

  it('clamps a same-day chat to a minimum of 1 day', () => {
    const chat = parseWhatsAppExport(
      ['1/5/24, 9:00 AM - Alice: hi', '1/5/24, 9:05 AM - Bob: hey'].join('\n'),
    );

    const activity = computeParticipantActivity(chat);

    expect(activity).toEqual([
      { participantId: 'alice', displayName: 'Alice', messagesPerDay: 1 },
      { participantId: 'bob', displayName: 'Bob', messagesPerDay: 1 },
    ]);
  });
});
