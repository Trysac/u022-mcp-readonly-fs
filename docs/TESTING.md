# Testing

## Tools

- [Vitest](https://vitest.dev/) runs the suites in `test/`.
- Coverage is collected with V8 (`@vitest/coverage-v8`) over `src/`.

## Commands

```sh
npm test            # vitest run --coverage
npx vitest          # watch mode while developing
npm run check       # every gate, including tests
```

## Test files

- `test/policy.test.ts`: `createPolicy` defaults, validation and error codes; `resolveSafe` containment, traversal, symlink escape, invalid paths and Windows alternate data streams; deny globs including case handling on win32; helpers `containingRoot`, `relativePosix` and `clip`.
- `test/glob.test.ts`: `matchGlob` for `**`, `*`, `?` and pathological patterns.
- `test/server.test.ts`: the tool list and annotations; `list_directory`, `read_file` (offset, length, `TOO_LARGE`, `BINARY`) and `search_files` through an in-memory MCP client; error result text.
- `test/cli.test.ts`: `run` usage errors (exit code 2), help output, serving with extra deny globs and limits (exit code 0), and transport failure (exit code 1).
- `test/index.test.ts`: the exact set of exports of the public entry point.
- `test/readonly.test.ts`: scans the `src/` modules for write calls and write open flags.
- `test/helpers.ts`: fixture creation in the OS temp directory, in-memory client connection and tool call helper. Not a test file.

Symlink tests are skipped when the platform does not allow creating symlinks.

## Rules

- Coverage thresholds are set in `vitest.config.ts`. They must not be lowered.
- Tests go through the public entry point or the documented module functions and assert return values, error codes and messages.
- Each bug fix adds a test that fails without the fix.
- Tests are deterministic: no network access, and temporary files are created in the OS temp directory and removed after the run.

## Reports

Coverage reports are written to `coverage/` (text summary and `lcov`). The folder is ignored by git.
