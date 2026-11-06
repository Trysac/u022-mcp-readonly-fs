# Architecture

## Overview

`@trysac/mcp-readonly-fs` is a TypeScript library published to npm as ES modules with type declarations. It provides a read-only MCP filesystem server over allowlisted roots, with realpath containment, deny globs matched on real paths, size and binary caps, and tools annotated `readOnlyHint`. Runtime dependencies are `@modelcontextprotocol/sdk` and `zod`.

## Modules

| Module | Responsibility |
|---|---|
| `src/index.ts` | Public API. Re-exports `createPolicy`, `resolveSafe`, `isDenied`, `createReadonlyFsServer`, `PolicyError` and their types. |
| `src/policy.ts` | Policy creation, limits, default deny globs, path validation, containment and deny checks, realpath resolution. |
| `src/glob.ts` | Glob matcher (`*`, `?`, whole `**` segments) by dynamic programming. |
| `src/ops.ts` | File operations: list, read, stat and search, with the byte and binary limits. |
| `src/server.ts` | MCP server creation with the four tools, input schemas, annotations and error formatting. |
| `src/errors.ts` | `PolicyError` and its codes. |
| `src/util.ts` | `clip` for safe echoing of untrusted text and the NUL and backslash constants. |
| `src/cli.ts` | `run(argv, io)` command line runner over stdio. Not re-exported by `src/index.ts`. |

## Boundaries

- Path resolution (`src/policy.ts`) is the only place that decides containment and denial. Operations in `src/ops.ts` call it before touching the filesystem.
- Platform rules are passed in as a parameter in internal functions (`validateRequested`, `isDeniedFor`, `containingRoot`, `resolveSafeFor`), so win32 behaviour is testable on any operating system. The public `resolveSafe` and `isDenied` use `process.platform`.
- The library does not write to the filesystem. Only read-capable open flags are used.
- Errors from the policy are `PolicyError`; tool failures are reported as `ERROR <CODE>` text with `isError: true`.

## Build and distribution

`npm run build` compiles `src/` to `dist/` with `tsconfig.build.json`. Only `dist/` is published (`files` in `package.json`).

## Decisions

Architectural decisions are recorded in [decisions/](decisions/), starting with [0001](decisions/0001-record-architecture-decisions.md).
