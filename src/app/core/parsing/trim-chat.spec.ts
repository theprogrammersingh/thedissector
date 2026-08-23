import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport } from './whatsapp-parser';
import { buildTranscript } from './transcript-builder';
import { buildTrimmedTranscript } from './trim-chat';

const EXPORT = [
  '5/1/24, 2:32 PM - Alice: first message',
  '5/1/24, 2:33 PM - Bob: second message',
  '5/1/24, 2:34 PM - Alice: third message',
  '5/1/24, 2:35 PM - Bob: fourth message',
].join('\n');

describe('buildTranscript', () => {
  it('renders real names by default', () => {
    const chat = parseWhatsAppExport(EXPORT);
    const transcript = buildTranscript(chat, { anonymize: false });
    expect(transcript).toContain('Alice: first message');
    expect(transcript).toContain('Bob: second message');
  });

  it('replaces names with Participant A/B labels when anonymized', () => {
    const chat = parseWhatsAppExport(EXPORT);
    const transcript = buildTranscript(chat, { anonymize: true });
    expect(transcript).not.toContain('Alice');
    expect(transcript).not.toContain('Bob');
    expect(transcript).toContain('Participant A: first message');
    expect(transcript).toContain('Participant B: second message');
  });

  it('keeps only the most recent N messages when maxMessages is set', () => {
    const chat = parseWhatsAppExport(EXPORT);
    const transcript = buildTranscript(chat, { anonymize: false, maxMessages: 2 });
    expect(transcript).not.toContain('first message');
    expect(transcript).toContain('third message');
    expect(transcript).toContain('fourth message');
  });
});

function buildLargeExport(messageCount: number): string {
  const lines: string[] = [];
  for (let i = 0; i < messageCount; i++) {
    const minute = i % 60;
    const hour = 1 + Math.floor(i / 60);
    lines.push(`5/1/24, ${hour}:${String(minute).padStart(2, '0')} AM - Alice: message number ${i}`);
  }
  return lines.join('\n');
}

describe('buildTrimmedTranscript', () => {
  it('does not trim when the transcript already fits the budget', () => {
    const chat = parseWhatsAppExport(EXPORT);
    const result = buildTrimmedTranscript(chat, { anonymize: false }, 100_000, 2_000);
    expect(result.wasAutoTrimmed).toBe(false);
    expect(result.keptMessageCount).toBe(4);
  });

  it('drops the oldest messages until the transcript fits a small budget', () => {
    const chat = parseWhatsAppExport(buildLargeExport(300));
    const result = buildTrimmedTranscript(chat, { anonymize: false }, 3_000, 1_000);
    expect(result.wasAutoTrimmed).toBe(true);
    expect(result.keptMessageCount).toBeLessThan(300);
    expect(result.estimatedTokens).toBeLessThanOrEqual(2_000);
    expect(result.transcript).toContain('message number 299');
    expect(result.transcript).not.toContain('message number 0\n');
  });
});
