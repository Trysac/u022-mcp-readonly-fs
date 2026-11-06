# mcp-readonly-fs

[![npm version](https://img.shields.io/npm/v/@trysac/mcp-readonly-fs.svg)](https://www.npmjs.com/package/@trysac/mcp-readonly-fs)
[![license: MIT](https://img.shields.io/npm/l/@trysac/mcp-readonly-fs.svg)](LICENSE)
[![CI](https://github.com/Trysac/u022-mcp-readonly-fs/actions/workflows/ci.yml/badge.svg)](https://github.com/Trysac/u022-mcp-readonly-fs/actions/workflows/ci.yml)

Read-only MCP filesystem server over allowlisted roots with realpath containment, deny globs on real paths, size and binary caps, and readOnlyHint tools

## Problem

Describe in two or three sentences the concrete problem this utility solves, who hits it, and why existing
packages do not solve it well. Keep it factual; link to an issue or decision record when there is one.

## Install

```sh
npm install @trysac/mcp-readonly-fs
```

Requires Node.js 20 or newer. The package ships ES modules with TypeScript declarations.

## Usage

```ts
import { greet } from "@trysac/mcp-readonly-fs";

// Build a greeting; surrounding whitespace is ignored.
const message = greet("  Ada ");
console.log(message); // "Hello, Ada!"

try {
  greet("   ");
} catch (error) {
  console.error((error as Error).message); // "name must not be empty"
}
```

## API

| Export | Signature | Description |
|---|---|---|
| `greet` | `(name: string) => string` | Placeholder API; replace it with the real one. |

## Development

```sh
npm install
npm run check   # lint, format, types, tests with coverage, docs, secrets
```

See [AGENTS.md](AGENTS.md) for the full command list and [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.

## License

[MIT](LICENSE) © 2026 Miguel Gomez
