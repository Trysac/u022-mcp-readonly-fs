# Project record: mcp-readonly-fs

## Objective

Provide a read-only MCP filesystem server over allowlisted roots. The server exposes four tools (`list_directory`, `read_file`, `search_files`, `stat`), enforces containment with realpath resolution, hides and refuses paths matching deny globs on real paths, and caps file sizes, result counts and search work. It is intended for agents that need read access to a few directories without write tools or access to secrets such as `.env` files.

## Scope

In scope:

- The public API documented in the README: `createPolicy`, `resolveSafe`, `isDenied`, `createReadonlyFsServer`, `PolicyError`.
- Four read-only MCP tools with `readOnlyHint` annotations.
- Platform-specific path rules for win32 (alternate data streams, device and UNC prefixes, case folding, trailing dots and spaces).
- A command line runner `run(argv, io)` in `src/cli.ts` that serves over stdio.

Out of scope:

- Write operations of any kind, including file creation, modification, deletion, renaming and archives.
- HTTP or other network transports; the CLI serves stdio only.
- Protection against a local process that modifies the roots concurrently (time-of-check to time-of-use races).
- Detection of secrets that do not match a deny glob.

## Timeline

| Date | Milestone |
|---|---|
| 2026 | Repository created from the factory utility template. |

## Effort metrics

Measured values only. Leave "pending measurement" until a real figure is recorded; never estimate here.

| Metric | Value | Source |
|---|---|---|
| Tokens (input / output) | 823462 / 126832 | factory ledger |
| Hours (human) | pending measurement | time log |
| Cost (USD) | 1.2250 | factory ledger |

## Factory run u022 (measured from API usage)

| Phase | Model | Batch | Input | Output | Cache write | Cache read | Cost (USD) |
|---|---|---|---|---|---|---|---|
| generation | claude-sonnet-5-5 | yes | 2526 | 80236 | 0 | 4473 | 0.4042 |
| fix-1 | claude-sonnet-5-5 | no | 22 | 27845 | 76409 | 482915 | 0.5178 |
| fix-2 | claude-sonnet-5-5 | no | 6 | 2057 | 11483 | 46606 | 0.0540 |
| fix-3 | claude-sonnet-5-5 | no | 6 | 796 | 9992 | 46582 | 0.0376 |
| fix-4 | claude-sonnet-5-5 | no | 4 | 621 | 8855 | 27126 | 0.0311 |
| audit | claude-sonnet-5-5 | no | 12 | 3540 | 31844 | 133956 | 0.1284 |
| fix-1 | claude-sonnet-5-5 | no | 6 | 1852 | 8216 | 40901 | 0.0432 |
| docs | claude-haiku-5-5 | no | 38321 | 9885 | 0 | 0 | 0.0088 |

Total: $1.2250. Prices: Anthropic list prices.
