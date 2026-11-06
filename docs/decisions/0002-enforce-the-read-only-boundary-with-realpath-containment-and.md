# Enforce the read-only boundary with realpath containment and deny globs on real paths

Status: accepted (generated, pending human review)

## Context

Agents given a general filesystem server can write files, read secrets such as .env files, and escape the intended folders through traversal, symlinks or Windows path quirks. Many setups need only read access to a few directories.

## Decision

Expose four read-only MCP tools over allowlisted roots. Every path goes through one pure resolver: lexical validation, fs.realpath, a containment check against real roots, then deny-glob matching on the root-relative real path, so aliases cannot bypass deny rules. A missing target is classified by its deepest existing ancestor to avoid an existence oracle. Globs are matched by a dynamic-programming matcher that never builds a RegExp from input. Platform rules take an injectable platform so Windows behaviour is tested on any OS. The tool set contains no write capability, and a test scans the sources for write calls.

## Consequences

The boundary is small, testable and independent of the MCP SDK. A local writer racing inside the roots (TOCTOU), hard links and secrets outside the deny globs are not defended and are documented. Walks skip symlinks entirely, which costs some convenience. Deny globs given to createPolicy replace the defaults, while the CLI extends them.
