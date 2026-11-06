import * as fs from "node:fs/promises";
import path from "node:path";
import { PolicyError } from "./errors.js";
import { matchGlob } from "./glob.js";
import { BACKSLASH, clip, NUL } from "./util.js";

/** Codes carried by tool error results and by failed path resolution. */
export type FsErrorCode =
  | "OUTSIDE_ROOT"
  | "DENIED"
  | "NOT_FOUND"
  | "TOO_LARGE"
  | "BINARY"
  | "INVALID_PATH"
  | "NOT_A_FILE"
  | "NOT_A_DIRECTORY";

/** Platform identifier used by the platform specific rules. */
export type Platform = NodeJS.Platform;

/** Longest accepted requested path, in characters. */
export const MAX_PATH_CHARS = 4096;
/** Longest accepted deny glob, in characters. */
export const MAX_GLOB_CHARS = 256;
const MAX_GLOBS = 256;
const MAX_ROOTS = 64;
const MAX_RELATIVE_CHARS = 8192;
const MAX_ANCESTOR_STEPS = 4096;

/** Deny globs applied when the caller does not provide any. */
export const DEFAULT_DENY: readonly string[] = Object.freeze([
  "**/.env",
  "**/.env.*",
  "**/.git/**",
  "**/*.pem",
  "**/*.key",
  "**/id_rsa*",
  "**/id_ed25519*",
]);

/** Immutable access policy shared by every tool. */
export interface FsPolicy {
  /** Real (symlink free) absolute paths of the allowlisted roots. */
  readonly roots: readonly string[];
  /** Deny globs matched against root-relative real POSIX paths. */
  readonly deny: readonly string[];
  /** Largest readable file, in bytes. */
  readonly maxFileBytes: number;
  /** Largest number of list or search results. */
  readonly maxResults: number;
  /** Largest number of directory entries examined by one operation. */
  readonly maxSearchFiles: number;
  /** Deepest directory level a search descends into. */
  readonly maxDepth: number;
}

/** Input of {@link createPolicy}; omitted fields use safe defaults. */
export interface CreatePolicyInput {
  /** Directories to expose. They must exist. */
  roots: readonly string[];
  /** Deny globs; replaces the defaults when given. */
  deny?: readonly string[];
  /** Largest readable file in bytes (default 1 MiB). */
  maxFileBytes?: number;
  /** Largest result count (default 200). */
  maxResults?: number;
  /** Largest number of examined entries (default 10000). */
  maxSearchFiles?: number;
  /** Deepest search level (default 32). */
  maxDepth?: number;
}

/** Outcome of {@link resolveSafe}. */
export type ResolveResult =
  | { readonly ok: true; readonly path: string; readonly root: string }
  | { readonly ok: false; readonly code: FsErrorCode };

function checkLimit(
  name: string,
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new PolicyError("INVALID_LIMIT", `${name} must be an integer between 1 and ${max}`);
  }
  return value;
}

function validateGlobs(globs: unknown): readonly string[] {
  if (!Array.isArray(globs) || globs.length > MAX_GLOBS) {
    throw new PolicyError("INVALID_GLOB", `deny must be an array of at most ${MAX_GLOBS} globs`);
  }
  const out: string[] = [];
  for (const [index, glob] of globs.entries()) {
    const value: unknown = glob;
    if (
      typeof value !== "string" ||
      value === "" ||
      value.length > MAX_GLOB_CHARS ||
      value.includes(NUL)
    ) {
      throw new PolicyError(
        "INVALID_GLOB",
        `deny glob #${index} must be 1 to ${MAX_GLOB_CHARS} characters without NUL`,
      );
    }
    out.push(value);
  }
  return Object.freeze(out);
}

async function resolveRoots(input: unknown): Promise<readonly string[]> {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_ROOTS) {
    throw new PolicyError("MISSING_ROOT", `roots must hold 1 to ${MAX_ROOTS} directories`);
  }
  const roots = new Set<string>();
  for (const item of input) {
    const value: unknown = item;
    if (
      typeof value !== "string" ||
      value === "" ||
      value.length > MAX_PATH_CHARS ||
      value.includes(NUL)
    ) {
      throw new PolicyError("MISSING_ROOT", "root is not a valid path");
    }
    let real: string | undefined;
    try {
      const candidate = await fs.realpath(path.resolve(value));
      if ((await fs.stat(candidate)).isDirectory()) {
        real = candidate;
      }
    } catch {
      real = undefined;
    }
    if (real === undefined) {
      throw new PolicyError(
        "MISSING_ROOT",
        `root not found or not a directory: ${clip(value, 100)}`,
      );
    }
    roots.add(real);
  }
  return Object.freeze([...roots]);
}

/**
 * Builds an immutable policy. Roots are resolved with realpath.
 *
 * @param input - Roots, deny globs and limits.
 * @returns The frozen policy.
 * @throws {PolicyError} MISSING_ROOT, INVALID_GLOB or INVALID_LIMIT.
 */
export async function createPolicy(input: CreatePolicyInput): Promise<FsPolicy> {
  const deny = validateGlobs(input.deny ?? DEFAULT_DENY);
  const maxFileBytes = checkLimit("maxFileBytes", input.maxFileBytes, 1024 * 1024, 2 ** 28);
  const maxResults = checkLimit("maxResults", input.maxResults, 200, 100_000);
  const maxSearchFiles = checkLimit("maxSearchFiles", input.maxSearchFiles, 10_000, 1_000_000);
  const maxDepth = checkLimit("maxDepth", input.maxDepth, 32, 256);
  const roots = await resolveRoots(input.roots);
  return Object.freeze({
    roots,
    deny,
    maxFileBytes,
    maxResults,
    maxSearchFiles,
    maxDepth,
  });
}

function isSeparator(ch: string | undefined): boolean {
  return ch === "/" || ch === BACKSLASH;
}

/**
 * Lexical validation of a requested path, before any filesystem access.
 *
 * @param requested - Untrusted path text.
 * @param platform - Platform whose rules apply.
 * @returns INVALID_PATH when rejected, otherwise undefined.
 */
export function validateRequested(requested: unknown, platform: Platform): FsErrorCode | undefined {
  if (
    typeof requested !== "string" ||
    requested === "" ||
    requested.length > MAX_PATH_CHARS ||
    requested.includes(NUL)
  ) {
    return "INVALID_PATH";
  }
  if (platform === "win32") {
    if (isSeparator(requested[0]) && isSeparator(requested[1])) {
      return "INVALID_PATH";
    }
    const rest = /^[A-Za-z]:/.test(requested) ? requested.slice(2) : requested;
    if (rest.includes(":")) {
      return "INVALID_PATH";
    }
  }
  return undefined;
}

/**
 * Finds the longest root containing `real`.
 *
 * @param roots - Real root paths.
 * @param real - Real path to test.
 * @param platform - Platform whose comparison rules apply.
 * @returns The containing root, or undefined.
 */
export function containingRoot(
  roots: readonly string[],
  real: string,
  platform: Platform,
): string | undefined {
  const win = platform === "win32";
  const sep = win ? path.win32.sep : path.posix.sep;
  const fold = (value: string): string => (win ? value.toLowerCase() : value);
  const target = fold(real);
  let best: string | undefined;
  for (const root of roots) {
    const folded = fold(root);
    const prefix = folded.endsWith(sep) ? folded : folded + sep;
    if (target === folded || target.startsWith(prefix)) {
      if (best === undefined || root.length > best.length) {
        best = root;
      }
    }
  }
  return best;
}

/**
 * Root-relative POSIX form of `full`; the empty string for the root itself.
 *
 * @param root - Real root.
 * @param full - Real path inside the root.
 */
export function relativePosix(root: string, full: string): string {
  const rel = path.relative(root, full);
  return rel === "" ? "" : rel.split(path.sep).join("/");
}

function normalizeWindowsSegment(segment: string): string {
  const lower = segment.toLowerCase();
  if (lower === "..") {
    return lower;
  }
  let end = lower.length;
  while (end > 0 && (lower[end - 1] === "." || lower[end - 1] === " ")) {
    end--;
  }
  return lower.slice(0, end);
}

/**
 * Platform aware deny check; see {@link isDenied}.
 *
 * @param platform - Platform whose rules apply.
 * @param policy - Policy holding the deny globs.
 * @param relativePath - Root-relative POSIX path.
 */
export function isDeniedFor(platform: Platform, policy: FsPolicy, relativePath: string): boolean {
  if (typeof relativePath !== "string" || relativePath.length > MAX_RELATIVE_CHARS) {
    return true;
  }
  const win = platform === "win32";
  const raw = win ? relativePath.split(BACKSLASH).join("/") : relativePath;
  let segments = raw.split("/").filter((s) => s !== "" && s !== ".");
  if (win) {
    segments = segments.map(normalizeWindowsSegment).filter((s) => s !== "");
  }
  const target = segments.join("/");
  for (const glob of policy.deny) {
    if (matchGlob(win ? glob.toLowerCase() : glob, target)) {
      return true;
    }
  }
  return false;
}

/**
 * Tells whether a root-relative real POSIX path matches a deny glob. On
 * win32 the comparison ignores case, trailing dots and trailing spaces.
 * Inputs longer than 8192 characters are denied (fail closed).
 *
 * @param policy - Policy holding the deny globs.
 * @param relativePath - Root-relative POSIX path, for example `sub/.env`.
 * @returns True when the path must be hidden and refused.
 */
export function isDenied(policy: FsPolicy, relativePath: string): boolean {
  return isDeniedFor(process.platform, policy, relativePath);
}

function errnoOf(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String(error.code);
  }
  return undefined;
}

async function classifyMissing(
  platform: Platform,
  policy: FsPolicy,
  candidate: string,
  error: unknown,
): Promise<FsErrorCode> {
  const errno = errnoOf(error);
  if (errno === "ENAMETOOLONG") {
    return "INVALID_PATH";
  }
  if (errno !== "ENOENT" && errno !== "ENOTDIR") {
    return "NOT_FOUND";
  }
  let current = candidate;
  for (let step = 0; step < MAX_ANCESTOR_STEPS; step++) {
    const parent = path.dirname(current);
    if (parent === current) {
      return "NOT_FOUND";
    }
    current = parent;
    try {
      const real = await fs.realpath(current);
      return containingRoot(policy.roots, real, platform) === undefined
        ? "OUTSIDE_ROOT"
        : "NOT_FOUND";
    } catch {
      // keep climbing until an existing ancestor is found
    }
  }
  return "NOT_FOUND";
}

/**
 * Platform aware implementation of {@link resolveSafe}.
 *
 * @param platform - Platform whose rules apply.
 * @param policy - Access policy.
 * @param requested - Untrusted path.
 */
export async function resolveSafeFor(
  platform: Platform,
  policy: FsPolicy,
  requested: string,
): Promise<ResolveResult> {
  const invalid = validateRequested(requested, platform);
  if (invalid !== undefined) {
    return { ok: false, code: invalid };
  }
  const base = policy.roots[0];
  if (base === undefined) {
    return { ok: false, code: "OUTSIDE_ROOT" };
  }
  const candidate = path.resolve(base, requested);
  let real: string;
  try {
    real = await fs.realpath(candidate);
  } catch (error) {
    const code = await classifyMissing(platform, policy, candidate, error);
    return { ok: false, code };
  }
  const root = containingRoot(policy.roots, real, platform);
  if (root === undefined) {
    return { ok: false, code: "OUTSIDE_ROOT" };
  }
  if (isDeniedFor(platform, policy, relativePosix(root, real))) {
    return { ok: false, code: "DENIED" };
  }
  return { ok: true, path: real, root };
}

/**
 * Resolves an untrusted path to a real path inside an allowlisted root.
 * Relative paths are resolved against the first root. The result of realpath
 * (symlinks followed) must lie inside a root and must not match a deny glob.
 * The window between this check and a later open is a documented TOCTOU gap.
 *
 * @param policy - Access policy.
 * @param requested - Untrusted path, at most 4096 characters.
 * @returns The real path and its root, or a failure code.
 */
export function resolveSafe(policy: FsPolicy, requested: string): Promise<ResolveResult> {
  return resolveSafeFor(process.platform, policy, requested);
}
