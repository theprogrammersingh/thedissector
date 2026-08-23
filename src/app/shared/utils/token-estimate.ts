/** Rough English-text heuristic (~4 chars/token); good enough for a pre-flight budget check. */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}
