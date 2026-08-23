import { AnalysisResult, ParticipantDossier, Superlative } from '../models/report.model';

interface KnownParticipant {
  id: string;
  displayName: string;
}

interface Section {
  heading: string;
  body: string;
}

function splitSections(text: string): Section[] {
  const lines = text.split(/\r?\n/);
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    if (headingMatch) {
      if (current) sections.push(current);
      current = { heading: headingMatch[2].trim(), body: '' };
    } else if (current) {
      current.body += line + '\n';
    }
  }
  if (current) sections.push(current);
  return sections;
}

function extractQuote(body: string): { quote: string; rest: string } {
  const blockquote = /^>\s?(.+)$/m.exec(body);
  if (blockquote) {
    return { quote: blockquote[1].trim(), rest: body.replace(blockquote[0], '').trim() };
  }
  const quoted = /"([^"]{8,200})"/.exec(body);
  if (quoted) {
    return { quote: quoted[1].trim(), rest: body.trim() };
  }
  const firstSentence = (body.trim().split(/(?<=[.!?])\s/)[0] ?? '').trim();
  return { quote: firstSentence, rest: body.trim() };
}

function extractLabeledField(body: string, labelPattern: RegExp): string | null {
  const match = labelPattern.exec(body);
  return match ? match[1].trim() : null;
}

function extractBulletList(body: string, labelPattern: RegExp): string[] {
  const labelMatch = labelPattern.exec(body);
  if (!labelMatch) return [];
  const afterLabel = body.slice(labelMatch.index + labelMatch[0].length);
  const items: string[] = [];
  for (const line of afterLabel.split(/\r?\n/)) {
    const bulletMatch = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bulletMatch) {
      items.push(bulletMatch[1].trim());
    } else if (items.length > 0 && line.trim().length > 0) {
      break;
    } else if (/^\*\*/.test(line.trim())) {
      break;
    }
  }
  return items;
}

/**
 * Best-effort fallback for providers/models that don't respect structured-output mode.
 * Heuristically splits `#`-style markdown sections and cross-references headings against
 * the chat's known participant names. Not guaranteed to succeed on arbitrary markdown —
 * returns null when it can't find a group-audit section and at least one dossier section.
 */
export function parseMarkdownFallback(text: string, knownParticipants: KnownParticipant[]): AnalysisResult | null {
  const sections = splitSections(text);
  if (sections.length === 0) return null;

  let groupSection: Section | undefined;
  let superlativeSection: Section | undefined;
  const dossierSections: { section: Section; participantId: string; displayName: string }[] = [];

  for (const section of sections) {
    const headingLower = section.heading.toLowerCase();
    const matchedParticipant = knownParticipants.find((p) => headingLower.includes(p.displayName.toLowerCase()));

    if (matchedParticipant) {
      dossierSections.push({ section, participantId: matchedParticipant.id, displayName: matchedParticipant.displayName });
    } else if (/superlative|award/.test(headingLower)) {
      superlativeSection = section;
    } else if (!groupSection && /group|dynamic|audit|overview/.test(headingLower)) {
      groupSection = section;
    } else if (!groupSection && dossierSections.length === 0 && !superlativeSection) {
      groupSection = section;
    }
  }

  if (!groupSection || dossierSections.length === 0) return null;

  const { quote: groupQuote, rest: groupRest } = extractQuote(groupSection.body);

  const dossiers: ParticipantDossier[] = dossierSections.map(({ section, participantId, displayName }) => {
    const labeledArchetype = extractLabeledField(section.body, /\*\*Archetype:?\*\*:?\s*(.*)/i);
    const headingArchetype = section.heading.replace(displayName, '').replace(/^[\s—-]+|[\s—-]+$/g, '').trim();
    const archetype = labeledArchetype || headingArchetype || 'Unlabeled';

    const { quote: verdictQuote, rest } = extractQuote(section.body);
    const behavioralSummary = extractLabeledField(section.body, /\*\*(?:Behavioral )?Summary:?\*\*:?\s*(.*)/i) ?? rest;
    const strengths = extractBulletList(section.body, /\*\*Strengths?:?\*\*:?/i);
    const redFlags = extractBulletList(section.body, /\*\*(?:Red Flags?|Flaws?):?\*\*:?/i);

    return { participantId, displayName, archetype, verdictQuote, behavioralSummary, strengths, redFlags };
  });

  const superlatives: Superlative[] = [];
  if (superlativeSection) {
    for (const line of superlativeSection.body.split(/\r?\n/)) {
      const bulletMatch = /^\s*[-*•]\s+(.*)$/.exec(line);
      if (!bulletMatch) continue;
      const content = bulletMatch[1];
      const titleMatch = /\*\*(.+?)\*\*/.exec(content);
      const title = (titleMatch ? titleMatch[1] : content.split(/[:—-]/)[0]).trim();
      const matchedParticipant = knownParticipants.find((p) => content.toLowerCase().includes(p.displayName.toLowerCase()));
      if (!title || !matchedParticipant) continue;
      const remainder = content.replace(titleMatch?.[0] ?? title, '');
      const blurbMatch = /[:—-]\s*(.+)$/.exec(remainder);
      superlatives.push({
        title,
        participantId: matchedParticipant.id,
        blurb: (blurbMatch ? blurbMatch[1] : remainder).trim(),
      });
    }
  }

  return {
    groupAudit: { title: groupSection.heading, summary: groupRest, verdictQuote: groupQuote },
    dossiers,
    superlatives,
  };
}
