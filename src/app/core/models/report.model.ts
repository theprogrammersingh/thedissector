import { ProviderId } from './provider.model';

export interface ParticipantDossier {
  participantId: string;
  displayName: string;
  archetype: string;
  verdictQuote: string;
  behavioralSummary: string;
  strengths: string[];
  redFlags: string[];
}

export interface Superlative {
  title: string;
  participantId: string;
  blurb: string;
}

export interface GroupAudit {
  title: string;
  summary: string;
  verdictQuote: string;
}

export interface AnalysisResult {
  groupAudit: GroupAudit;
  dossiers: ParticipantDossier[];
  superlatives: Superlative[];
}

export interface AnalysisMetadata {
  providerId: ProviderId;
  modelId: string;
  consentGivenAt: string;
  anonymized: boolean;
  generatedAt: string;
  chatName: string;
}
