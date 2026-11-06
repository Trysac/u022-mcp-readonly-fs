# mcp-readonly-fs

[![npm version](https://img.shields.io/npm/v/@trysac/mcp-readonly-fs.svg)](https://www.npmjs.com/package/@trysac/mcp-readonly-fs)
[![license: MIT](https://img.shields.io/npm/l/@trysac/mcp-readonly-fs.svg)](LICENSE)
[![CI](https://github.com/Trysac/u022-mcp-readonly-fs/actions/workflows/ci.yml/badge.svg)](https://github.com/Trysac/u022-mcp-readonly-fs/actions/workflows/ci.yml)

Read-only MCP filesystem server over allowlisted roots with realpath containment, deny globs on real paths, size and binary caps, and readOnlyHint tools

## Problem

Giving an agent file access through a general filesystem server exposes write tools, secrets such as `.env` files, and paths outside the intended folders, reachable through traversal, symlinks or Windows path quirks. Many setups only need read access to a few directories. This package exposes four read-only MCP tools (`list_directory`, `read_file`, `search_files`, `stat`) over allowlisted roots. Path resolution is pure and tested separately from the MCP layer. The threat model is in [docs/SECURITY.md](docs/SECURITY.md).

## Install

```sh
npm install @trysac/mcp-readonly-fs
```

Requires Node.js 20 or newer. The package ships ES modules with TypeScript declarations. Runtime dependencies are `@modelcontextprotocol/sdk` (^1.23.0) and `zod` (^4.1.0).

## Usage

```ts
import { createPolicy, createReadonlyFsServer } from "@trysac/mcp-readonly-fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const policy = await createPolicy({ roots: ["./docs"] });
const server = createReadonlyFsServer(policy, {
  onEvent: (e) => console.error(e.tool, e.ok, e.code),
});
await server.connect(new StdioServerTransport());
```

`createPolicy` throws `PolicyError` when a root does not exist or is not a directory.

## Command line

`src/cli.ts` exports `run(argv, io)`, which parses the flags below and serves over stdio. It is not re-exported by the package entry point and the package declares no `bin` entry.

```sh
--root DIR            # repeatable, required
--deny GLOB           # extra deny glob, added to the defaults
--max-file-bytes N    # default 1 MiB
--max-results N       # default 200
```

Exit codes: 0 success, 1 runtime server failure, 2 usage, IO or parse errors.

## API

| Export | Signature | Description |
|---|---|---|
| `createPolicy` | `(input: CreatePolicyInput) => Promise<FsPolicy>` | Builds a frozen policy with realpath-resolved roots. Throws `PolicyError` with code `MISSING_ROOT`, `INVALID_GLOB` or `INVALID_LIMIT`. |
| `resolveSafe` | `(policy, requested) => Promise<ResolveResult>` | Returns `{ ok: true, path, root }` or `{ ok: false, code }`. Codes: `OUTSIDE_ROOT`, `DENIED`, `NOT_FOUND`, `INVALID_PATH`. |
| `isDenied` | `(policy, rootRelativePosixPath) => boolean` | Matches deny globs against a root-relative POSIX path. Inputs longer than 8192 characters are denied. |
| `createReadonlyFsServer` | `(policy, opts?) => McpServer` | Creates an MCP server with the four read-only tools. `opts.onEvent` receives `{ tool, ok, code? }` after each call. |
| `PolicyError` | `class extends Error { code }` | Stable code: `MISSING_ROOT`, `INVALID_GLOB` or `INVALID_LIMIT`. |

Tool error codes returned by the tools: `OUTSIDE_ROOT`, `DENIED`, `NOT_FOUND`, `TOO_LARGE`, `BINARY`, `INVALID_PATH`, `NOT_A_FILE`, `NOT_A_DIRECTORY`. An error result has `isError: true` and text `ERROR <CODE>: <requested path>`, truncated to 200 characters. It never contains the resolved real path.

### Tools

| Tool | Arguments | Result |
|---|---|---|
| `list_directory` | `path` | JSON with `entries` (`name`, `type`) and `truncated`. |
| `read_file` | `path`, `offset?`, `length?` (bytes) | UTF-8 text. Invalid bytes become U+FFFD and a leading BOM is removed. |
| `search_files` | `path`, `query` (literal, 1 to 256 characters), `contents?` | JSON with `results` and `truncated`. Matching is case-insensitive. |
| `stat` | `path` | JSON with `type`, `size` and `mtime`. |

All tools are annotated `readOnlyHint: true` and `openWorldHint: false`.

### Limits and options

| Option | Default | Limit |
|---|---|---|
| `maxFileBytes` | 1 MiB | 1 to 2^28 bytes |
| `maxResults` | 200 | 1 to 100000 |
| `maxSearchFiles` | 10000 | 1 to 1000000 entries examined |
| `maxDepth` | 32 | 1 to 256 |
| `deny` | `**/.env`, `**/.env.*`, `**/.git/**`, `**/*.pem`, `**/*.key`, `**/id_rsa*`, `**/id_ed25519*` | At most 256 globs of 1 to 256 characters |

Paths are limited to 4096 characters. Roots: 1 to 64 directories. `createPolicy` replaces the default deny list when `deny` is given; the CLI `--deny` option adds to the defaults. Content search reads at most 64 MiB in total per call.

## Why not server-filesystem

The reference `server-filesystem` MCP server ships write tools and has no deny list. This package exposes only read operations and hides secret-like paths by default.

## Development

```sh
npm install
npm run check   # lint, format, types, tests with coverage, docs, secrets
```

See [AGENTS.md](AGENTS.md) for the full command list and [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.

## Security

The threat model, the defended and undefended cases, and the limits are described in [docs/SECURITY.md](docs/SECURITY.md).

## License

[MIT](LICENSE) © 2026 Miguel Gomez
