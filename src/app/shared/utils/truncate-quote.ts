/**
 * Caps a single verbatim quote.
 *
 * The evidence pack embeds real message bodies, and WhatsApp messages have no length limit worth
 * relying on — one long rant used to be pasted into the pack whole. On the on-device path that is
 * a correctness problem, not a tidiness one: a small model's practical input ceiling is a couple
 * of thousand tokens (see LOCAL_MAX_INPUT_TOKENS), so a single message could consume the entire
 * budget and push the prompt into an onnxruntime tensor-size overflow.
 *
 * Cutting at a word boundary matters because these strings are shown to the user in the report as
 * well as sent to the model — a quote severed mid-word reads as a rendering bug.
 */
export const MAX_QUOTE_CHARS = 300;

export function truncateQuote(text: string, maxChars: number = MAX_QUOTE_CHARS): string {
  if (text.length <= maxChars) return text;

  const slice = text.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(' ');
  // Only honor the word boundary if it isn't so early that it throws away most of the quote.
  const cut = lastSpace > maxChars * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}
