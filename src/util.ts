/** NUL character, forbidden in every path this library accepts. */
export const NUL = String.fromCharCode(0);

/** Backslash character. */
export const BACKSLASH = String.fromCharCode(92);

/**
 * Returns at most `max` UTF-16 units of `value` with control characters
 * replaced by spaces, so untrusted text is safe to echo in messages.
 *
 * @param value - Untrusted text.
 * @param max - Maximum number of UTF-16 units in the result.
 */
export function clip(value: string, max: number): string {
  let out = "";
  for (const ch of value) {
    if (out.length + ch.length > max) {
      break;
    }
    out += (ch.codePointAt(0) ?? 0) < 32 ? " " : ch;
  }
  return out;
}
