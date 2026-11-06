import { constants, type Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import { type FsErrorCode, type FsPolicy, isDenied, relativePosix, resolveSafe } from "./policy.js";
import { clip } from "./util.js";

/** Number of leading bytes inspected for NUL when detecting binary files. */
export const BINARY_PROBE_BYTES = 8192;
/** Total bytes a single content search may read. */
export const SEARCH_BYTES_BUDGET = 64 * 1024 * 1024;
const MAX_SNIPPET_CHARS = 200;
const NOFOLLOW = (constants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;
const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });

/** Error carrying a tool error code. */
export class FsToolError extends Error {
  /** Machine-readable code. */
  readonly code: FsErrorCode;

  /** @param code - Tool error code. */
  constructor(code: FsErrorCode) {
    super(code);
    this.name = "FsToolError";
    this.code = code;
  }
}

/** One directory entry. */
export interface ListEntry {
  name: string;
  type: "file" | "directory" | "symlink" | "other";
}

/** Result of {@link listDirectory}. */
export interface ListResult {
  entries: ListEntry[];
  truncated: boolean;
}

/** One search hit. */
export interface SearchHit {
  path: string;
  kind: "name" | "content";
  line?: number;
  text?: string;
}

/** Result of {@link searchFiles}. */
export interface SearchResult {
  results: SearchHit[];
  truncated: boolean;
}

/** Result of {@link statPath}. */
export interface StatResult {
  type: "file" | "directory" | "other";
  size: number;
  mtime: string;
}

async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof FsToolError) {
      throw error;
    }
    throw new FsToolError("NOT_FOUND");
  }
}

async function need(policy: FsPolicy, requested: string) {
  const resolved = await resolveSafe(policy, requested);
  if (!resolved.ok) {
    throw new FsToolError(resolved.code);
  }
  return resolved;
}

function openReadOnly(file: string): Promise<fs.FileHandle> {
  return fs.open(file, constants.O_RDONLY | NOFOLLOW);
}

async function readBytes(handle: fs.FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let got = 0;
  while (got < length) {
    const { bytesRead } = await handle.read(buffer, got, length - got, position + got);
    if (bytesRead === 0) {
      break;
    }
    got += bytesRead;
  }
  return buffer.subarray(0, got);
}

function decode(bytes: Uint8Array, atStart: boolean): string {
  const text = decoder.decode(bytes);
  return atStart && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function compareNames(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

function sortEntries<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => compareNames(a.name, b.name));
}

function kindOf(entry: Pick<Dirent, "isSymbolicLink" | "isDirectory" | "isFile">) {
  if (entry.isSymbolicLink()) {
    return "symlink" as const;
  }
  if (entry.isDirectory()) {
    return "directory" as const;
  }
  return entry.isFile() ? ("file" as const) : ("other" as const);
}

/**
 * Lists a directory, hiding denied entries and entries that resolve outside
 * every root. At most `policy.maxResults` entries are returned.
 *
 * @param policy - Access policy.
 * @param requested - Untrusted directory path.
 * @throws {FsToolError} With a tool error code.
 */
export async function listDirectory(policy: FsPolicy, requested: string): Promise<ListResult> {
  const target = await need(policy, requested);
  return guard(async () => {
    const info = await fs.stat(target.path);
    if (!info.isDirectory()) {
      throw new FsToolError("NOT_A_DIRECTORY");
    }
    const dirents = sortEntries(await fs.readdir(target.path, { withFileTypes: true }));
    const entries: ListEntry[] = [];
    let truncated = dirents.length > policy.maxSearchFiles;
    for (const dirent of dirents.slice(0, policy.maxSearchFiles)) {
      const child = await resolveSafe(policy, path.join(target.path, dirent.name));
      if (!child.ok) {
        continue;
      }
      if (entries.length >= policy.maxResults) {
        truncated = true;
        break;
      }
      entries.push({ name: dirent.name, type: kindOf(dirent) });
    }
    return { entries, truncated };
  });
}

/**
 * Reads a UTF-8 text file (invalid bytes become U+FFFD, a BOM at the start
 * is removed). Offsets and lengths count bytes.
 *
 * @param policy - Access policy.
 * @param requested - Untrusted file path.
 * @param offset - First byte to read (default 0).
 * @param length - Number of bytes to read (default: to the end).
 * @throws {FsToolError} With a tool error code.
 */
export async function readFile(
  policy: FsPolicy,
  requested: string,
  offset = 0,
  length?: number,
): Promise<string> {
  const target = await need(policy, requested);
  return guard(async () => {
    const before = await fs.lstat(target.path);
    if (!before.isFile()) {
      throw new FsToolError("NOT_A_FILE");
    }
    const handle = await openReadOnly(target.path);
    try {
      const info = await handle.stat();
      if (!info.isFile()) {
        throw new FsToolError("NOT_A_FILE");
      }
      if (info.size > policy.maxFileBytes) {
        throw new FsToolError("TOO_LARGE");
      }
      const head = await readBytes(handle, 0, Math.min(BINARY_PROBE_BYTES, info.size));
      if (head.includes(0)) {
        throw new FsToolError("BINARY");
      }
      const start = Math.min(offset, info.size);
      const available = info.size - start;
      const wanted = length === undefined ? available : Math.min(length, available);
      return decode(await readBytes(handle, start, wanted), start === 0);
    } finally {
      await handle.close();
    }
  });
}

/**
 * Returns type, size and modification time of a path.
 *
 * @param policy - Access policy.
 * @param requested - Untrusted path.
 * @throws {FsToolError} With a tool error code.
 */
export async function statPath(policy: FsPolicy, requested: string): Promise<StatResult> {
  const target = await need(policy, requested);
  return guard(async () => {
    const info = await fs.lstat(target.path);
    let type: StatResult["type"] = "other";
    if (info.isDirectory()) {
      type = "directory";
    } else if (info.isFile()) {
      type = "file";
    }
    return { type, size: info.size, mtime: info.mtime.toISOString() };
  });
}

/**
 * Searches file names and optionally contents below a directory. Symlinks
 * are never followed, denied and oversized files are skipped, and the walk
 * is bounded by `maxResults`, `maxSearchFiles`, `maxDepth` and a byte budget.
 * Matching is a case-insensitive literal substring test.
 *
 * @param policy - Access policy.
 * @param requested - Untrusted directory path.
 * @param query - Literal text to look for.
 * @param contents - Also search inside files.
 * @param byteBudget - Total bytes content search may read.
 * @throws {FsToolError} With a tool error code.
 */
export async function searchFiles(
  policy: FsPolicy,
  requested: string,
  query: string,
  contents: boolean,
  byteBudget: number = SEARCH_BYTES_BUDGET,
): Promise<SearchResult> {
  const start = await need(policy, requested);
  return guard(async () => {
    const info = await fs.stat(start.path);
    if (!info.isDirectory()) {
      throw new FsToolError("NOT_A_DIRECTORY");
    }
    const needle = query.toLowerCase();
    const results: SearchHit[] = [];
    let truncated = false;
    let scanned = 0;
    let budget = byteBudget;

    const add = (hit: SearchHit): boolean => {
      if (results.length >= policy.maxResults) {
        truncated = true;
        return false;
      }
      results.push(hit);
      return true;
    };

    const scanContents = async (file: string): Promise<boolean> => {
      const handle = await openReadOnly(file).catch(() => undefined);
      if (handle === undefined) {
        return true;
      }
      try {
        const stats = await handle.stat();
        if (!stats.isFile() || stats.size > policy.maxFileBytes) {
          return true;
        }
        if (stats.size > budget) {
          truncated = true;
          return false;
        }
        budget -= stats.size;
        const bytes = await readBytes(handle, 0, stats.size);
        if (bytes.subarray(0, BINARY_PROBE_BYTES).includes(0)) {
          return true;
        }
        const lines = decode(bytes, true).split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? "";
          if (line.toLowerCase().includes(needle)) {
            const hit = {
              path: file,
              kind: "content" as const,
              line: i + 1,
              text: clip(line, MAX_SNIPPET_CHARS),
            };
            if (!add(hit)) {
              return false;
            }
          }
        }
        return true;
      } catch {
        return true;
      } finally {
        await handle.close();
      }
    };

    const walk = async (dir: string, depth: number): Promise<boolean> => {
      let dirents: Dirent[];
      try {
        dirents = sortEntries(await fs.readdir(dir, { withFileTypes: true }));
      } catch {
        return true;
      }
      for (const dirent of dirents) {
        if (scanned >= policy.maxSearchFiles) {
          truncated = true;
          return false;
        }
        scanned++;
        if (dirent.isSymbolicLink()) {
          continue;
        }
        const full = path.join(dir, dirent.name);
        if (isDenied(policy, relativePosix(start.root, full))) {
          continue;
        }
        if (dirent.isDirectory()) {
          if (depth >= policy.maxDepth) {
            truncated = true;
          } else if (!(await walk(full, depth + 1))) {
            return false;
          }
          continue;
        }
        if (!dirent.isFile()) {
          continue;
        }
        if (dirent.name.toLowerCase().includes(needle) && !add({ path: full, kind: "name" })) {
          return false;
        }
        if (contents && !(await scanContents(full))) {
          return false;
        }
      }
      return true;
    };

    await walk(start.path, 0);
    return { results, truncated };
  });
}
