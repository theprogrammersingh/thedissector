import { AnalyzeResult } from './provider.types';
import { parseStructuredJson } from './structured-output-parser';
import { parseMarkdownFallback } from './markdown-fallback-parser';

/** Tries structured JSON first, falling back to the lenient markdown parser. Returns null if neither works. */
export function extractAnalysisResult(
  rawText: string,
  knownParticipants: { id: string; displayName: string }[],
): AnalyzeResult | null {
  const structured = parseStructuredJson(rawText);
  if (structured) return { analysis: structured, usedFallbackParser: false };

  const fallback = parseMarkdownFallback(rawText, knownParticipants);
  if (fallback) return { analysis: fallback, usedFallbackParser: true };

  return null;
}
