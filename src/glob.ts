/**
 * Matches one path segment against a pattern made of literals, `*` and `?`.
 * Dynamic programming, O(pattern x text), no backtracking.
 */
function segmentMatches(pattern: string, text: string): boolean {
  const n = text.length;
  let prev = new Uint8Array(n + 1);
  prev[0] = 1;
  for (let i = 0; i < pattern.length; i++) {
    const pc = pattern[i];
    const cur = new Uint8Array(n + 1);
    cur[0] = pc === "*" ? (prev[0] ?? 0) : 0;
    for (let j = 1; j <= n; j++) {
      if (pc === "*") {
        cur[j] = (prev[j] ?? 0) | (cur[j - 1] ?? 0);
      } else if (pc === "?" || pc === text[j - 1]) {
        cur[j] = prev[j - 1] ?? 0;
      }
    }
    prev = cur;
  }
  return prev[n] === 1;
}

/**
 * Matches a POSIX path against a glob. Supported syntax: `*` and `?` inside a
 * segment, and a whole `**` segment that matches zero or more segments.
 * Runs in O(pattern segments x path segments x segment cost) with no
 * backtracking and never builds a RegExp from the pattern.
 *
 * @param pattern - Glob such as `**\/.env`.
 * @param path - Slash separated path without leading slash.
 * @returns True when the whole path matches.
 */
export function matchGlob(pattern: string, path: string): boolean {
  const segments = path === "" ? [] : path.split("/");
  const n = segments.length;
  let prev = new Uint8Array(n + 1);
  prev[0] = 1;
  for (const part of pattern.split("/")) {
    const cur = new Uint8Array(n + 1);
    if (part === "**") {
      cur[0] = prev[0] ?? 0;
      for (let j = 1; j <= n; j++) {
        cur[j] = (prev[j] ?? 0) | (cur[j - 1] ?? 0);
      }
    } else {
      for (let j = 1; j <= n; j++) {
        if (prev[j - 1] === 1 && segmentMatches(part, segments[j - 1] ?? "")) {
          cur[j] = 1;
        }
      }
    }
    prev = cur;
  }
  return prev[n] === 1;
}
