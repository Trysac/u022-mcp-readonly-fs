# Stack

## Used

| Tool | Purpose | Why |
|---|---|---|
| TypeScript (strict) | Language and type checking | Typed public API and declarations for consumers. |
| Node.js 20+ | Runtime | Maintained LTS line with native ES modules. |
| `@modelcontextprotocol/sdk` (^1.23.0) | MCP server, tool registration and stdio transport | Standard MCP implementation; the tools are registered with `registerTool` and annotations. |
| `zod` (^4.1.0) | Input schemas of the MCP tools | Schema validation required by the MCP SDK tool registration. |
| Vitest + `@vitest/coverage-v8` | Tests and coverage | Fast, ESM-native, runs TypeScript without a build step. |
| Biome | Lint and format | One tool for both, single config file. |
| gitleaks | Secret scanning | Scanner run locally and in CI. |
| GitHub Actions + Dependabot | CI and dependency updates | Runs the local gates on Linux and Windows. |

## Discarded

| Tool | Why not |
|---|---|
| ESLint + Prettier | Two tools and several configs where Biome covers both. |
| Jest | Needs extra transforms for ESM and TypeScript; slower. |
| Shell scripts for gates | Not portable to Windows; the gate runner is a Node script. |
| Bundlers (tsup, Rollup) | Not needed for a small ESM library; `tsc` emits what is published. |
