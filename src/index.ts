/**
 * Public entry point of @trysac/mcp-readonly-fs: a read-only MCP filesystem
 * server over allowlisted roots.
 */

export type { PolicyErrorCode } from "./errors.js";
export { PolicyError } from "./errors.js";
export type {
  CreatePolicyInput,
  FsErrorCode,
  FsPolicy,
  ResolveResult,
} from "./policy.js";
export { createPolicy, isDenied, resolveSafe } from "./policy.js";
export type { ReadonlyFsEvent, ReadonlyFsServerOptions } from "./server.js";
export { createReadonlyFsServer } from "./server.js";
