# Security

This document is the threat model of `@trysac/mcp-readonly-fs`, a read-only MCP filesystem server over allowlisted roots. Report vulnerabilities as described in the repository `SECURITY.md`.

## Why this server

The reference `server-filesystem` ships write tools and has no deny list. This server exposes four read-only tools (`list_directory`, `read_file`, `search_files`, `stat`), each annotated `readOnlyHint: true` and `openWorldHint: false`, and hides secret-like paths such as `.env` files by default.

## Trust boundaries

- The MCP client (an agent) is untrusted. Every path, offset, length and query it sends is validated.
- The allowlisted roots are trusted configuration supplied by the operator.
- The contents of the roots are assumed not to be modified concurrently by a hostile local process (see Not defended).

## Mechanism

1. Lexical validation rejects non-string input, empty input, NUL, and paths longer than 4096 characters (`INVALID_PATH`). On win32 it also rejects a `:` outside the drive prefix (alternate data streams) and paths starting with two separators (UNC, extended-length and device prefixes).
2. A relative path is resolved against the first root and passed to `fs.promises.realpath`, which follows symlinks. On Windows it also resolves 8.3 short names.
3. The real path must equal a root or start with the root followed by the path separator. On win32 the comparison ignores case. Otherwise the result is `OUTSIDE_ROOT`. A missing target is classified by its deepest existing ancestor, so a path outside the roots is reported as `OUTSIDE_ROOT` whether or not it exists.
4. Deny globs are matched against the root-relative real path, so symlink aliases cannot bypass them (`DENIED`). On win32 matching ignores case, trailing dots and trailing spaces.
5. Files are opened with `O_NOFOLLOW` where the platform supports it. The handle is checked with `fstat` (regular file, size limit) before reading. Binary detection looks for a NUL byte in the first 8192 bytes.

The glob matcher supports `*` and `?` inside a segment and whole `**` segments. It uses dynamic programming in O(pattern x path) and never builds a RegExp from input. Globs are limited to 256 characters and at most 256 globs per policy.

Directory walks never follow symlinks and are bounded by `maxResults`, `maxSearchFiles`, `maxDepth` and a 64 MiB content byte budget.

## Defended

| Item | Behaviour | Test |
|---|---|---|
| Traversal | `../outside.txt` and absolute outside paths return `OUTSIDE_ROOT` | `test/policy.test.ts` (containment) |
| Symlink escape | A symlink inside a root that points outside returns `OUTSIDE_ROOT` and is hidden from listings | `test/policy.test.ts`, `test/server.test.ts` |
| Deny bypass via alias | A symlink alias of a denied file returns `DENIED` | `test/policy.test.ts` (symlink alias) |
| Windows alternate data streams | `a.txt:secret` returns `INVALID_PATH` on win32 | `test/policy.test.ts` (invalid paths) |
| Case and trailing characters | `.ENV`, `.env.` and `.env ` are denied on win32 only | `test/policy.test.ts` (deny globs) |
| Oversize and binary reads | `TOO_LARGE` above `maxFileBytes`; `BINARY` for NUL in the first 8192 bytes | `test/server.test.ts` (read_file) |
| Unbounded walks | Result, entry, depth and byte limits; symlinks are not followed | `test/server.test.ts` (list_directory, search_files) |
| Pathological globs | `**/**/**/**/a` on a 200-segment path completes without backtracking | `test/policy.test.ts`, `test/glob.test.ts` |
| Absence of write tools | Four read-only tools; no source file calls a write API | `test/readonly.test.ts` |
| Error leakage | Error text is `ERROR <CODE>: <requested path>` (at most 200 characters) and never contains the resolved path | `test/server.test.ts` (error results) |

## Not defended

- Time-of-check to time-of-use races: a local writer inside the roots can replace a path between `realpath` and `open`. `O_NOFOLLOW` and the `fstat` check narrow the window but do not close it.
- Secrets that do not match a deny glob. Extra globs can be added with `--deny` or the `deny` option.
- Hard links: a hard link inside a root to a file outside it is indistinguishable from a regular file.
- Existence of targets inside a root: a symlink inside a root that points to a missing target reports `NOT_FOUND`.
- Windows 8.3 short-name expansion is delegated to `fs.promises.realpath` and is not exercised by the Linux test runs.

## Out of scope

Writes, archives, and HTTP transports. The CLI serves stdio only.

## Resource limits

Paths: 4096 characters. Query: 1 to 256 characters. Deny globs: 256 characters each, at most 256. Files: `maxFileBytes` (default 1 MiB). Results: `maxResults` (default 200). Examined entries: `maxSearchFiles` (default 10000). Search depth: `maxDepth` (default 32). Content search budget: 64 MiB per call.
