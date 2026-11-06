import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FsToolError, listDirectory, readFile, searchFiles, statPath } from "./ops.js";
import { type FsPolicy, MAX_PATH_CHARS } from "./policy.js";
import { clip } from "./util.js";

/** Event emitted after every tool call. It never carries paths or contents. */
export interface ReadonlyFsEvent {
  readonly tool: string;
  readonly ok: boolean;
  readonly code?: string;
}

/** Options of {@link createReadonlyFsServer}. */
export interface ReadonlyFsServerOptions {
  /** Observer called after each tool call; its failures are ignored. */
  onEvent?: (event: ReadonlyFsEvent) => void;
}

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

const MAX_ERROR_ECHO = 200;

/**
 * Creates an MCP server exposing four read-only tools:
 * `list_directory`, `read_file`, `search_files` and `stat`. No tool writes.
 * Error results read `ERROR <CODE>: <requested path>` and never contain the
 * resolved real path.
 *
 * @param policy - Access policy from `createPolicy`.
 * @param opts - Optional observer.
 * @returns A server that is not yet connected to a transport.
 */
export function createReadonlyFsServer(
  policy: FsPolicy,
  opts: ReadonlyFsServerOptions = {},
): McpServer {
  const server = new McpServer({ name: "mcp-readonly-fs", version: "0.0.0" });
  const annotations = {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  };
  const pathSchema = z.string().min(1).max(MAX_PATH_CHARS);

  const emit = (event: ReadonlyFsEvent): void => {
    try {
      opts.onEvent?.(event);
    } catch {
      // observer failures must not change tool results
    }
  };

  const respond = async (
    tool: string,
    requested: string,
    work: () => Promise<string>,
  ): Promise<ToolResult> => {
    try {
      const text = await work();
      emit({ tool, ok: true });
      return { content: [{ type: "text", text }] };
    } catch (error) {
      const code = error instanceof FsToolError ? error.code : "NOT_FOUND";
      emit({ tool, ok: false, code });
      return {
        content: [
          {
            type: "text",
            text: `ERROR ${code}: ${clip(requested, MAX_ERROR_ECHO)}`,
          },
        ],
        isError: true,
      };
    }
  };

  server.registerTool(
    "list_directory",
    {
      description: "List a directory inside the allowlisted roots.",
      inputSchema: { path: pathSchema },
      annotations,
    },
    ({ path }) =>
      respond("list_directory", path, async () =>
        JSON.stringify(await listDirectory(policy, path)),
      ),
  );

  server.registerTool(
    "read_file",
    {
      description: "Read a UTF-8 text file. offset and length count bytes.",
      inputSchema: {
        path: pathSchema,
        offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
        length: z.number().int().min(1).max(policy.maxFileBytes).optional(),
      },
      annotations,
    },
    ({ path, offset, length }) =>
      respond("read_file", path, () => readFile(policy, path, offset, length)),
  );

  server.registerTool(
    "search_files",
    {
      description: "Search file names, and optionally contents, for a literal string.",
      inputSchema: {
        path: pathSchema,
        query: z.string().min(1).max(256),
        contents: z.boolean().optional(),
      },
      annotations,
    },
    ({ path, query, contents }) =>
      respond("search_files", path, async () =>
        JSON.stringify(await searchFiles(policy, path, query, contents === true)),
      ),
  );

  server.registerTool(
    "stat",
    {
      description: "Return type, size and modification time of a path.",
      inputSchema: { path: pathSchema },
      annotations,
    },
    ({ path }) => respond("stat", path, async () => JSON.stringify(await statPath(policy, path))),
  );

  return server;
}
