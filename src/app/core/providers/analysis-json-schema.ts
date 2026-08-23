/** Standard JSON Schema for AnalysisResult — used by OpenAI/Grok (response_format) and Claude (tool input_schema). */
export const ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    groupAudit: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        summary: { type: 'string' },
        verdictQuote: { type: 'string' },
      },
      required: ['title', 'summary', 'verdictQuote'],
    },
    dossiers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          participantId: { type: 'string' },
          displayName: { type: 'string' },
          archetype: { type: 'string' },
          verdictQuote: { type: 'string' },
          behavioralSummary: { type: 'string' },
          strengths: { type: 'array', items: { type: 'string' } },
          redFlags: { type: 'array', items: { type: 'string' } },
        },
        required: [
          'participantId',
          'displayName',
          'archetype',
          'verdictQuote',
          'behavioralSummary',
          'strengths',
          'redFlags',
        ],
      },
    },
    superlatives: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          participantId: { type: 'string' },
          blurb: { type: 'string' },
        },
        required: ['title', 'participantId', 'blurb'],
      },
    },
  },
  required: ['groupAudit', 'dossiers', 'superlatives'],
};

/** Gemini's `responseSchema` uses an OpenAPI-subset dialect (uppercase types, no $schema/$ref). */
export const ANALYSIS_GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    groupAudit: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING' },
        summary: { type: 'STRING' },
        verdictQuote: { type: 'STRING' },
      },
      required: ['title', 'summary', 'verdictQuote'],
    },
    dossiers: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          participantId: { type: 'STRING' },
          displayName: { type: 'STRING' },
          archetype: { type: 'STRING' },
          verdictQuote: { type: 'STRING' },
          behavioralSummary: { type: 'STRING' },
          strengths: { type: 'ARRAY', items: { type: 'STRING' } },
          redFlags: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: [
          'participantId',
          'displayName',
          'archetype',
          'verdictQuote',
          'behavioralSummary',
          'strengths',
          'redFlags',
        ],
      },
    },
    superlatives: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          participantId: { type: 'STRING' },
          blurb: { type: 'STRING' },
        },
        required: ['title', 'participantId', 'blurb'],
      },
    },
  },
  required: ['groupAudit', 'dossiers', 'superlatives'],
};
