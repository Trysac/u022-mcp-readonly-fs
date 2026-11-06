import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createPolicy, DEFAULT_DENY } from "./policy.js";
import { createReadonlyFsServer } from "./server.js";
import { clip } from "./util.js";

/** Output streams and environment used by {@link run}. */
export interface CliIo {
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
  env?: Record<string, string | undefined>;
}

/** Optional overrides of {@link run}, used by tests. */
export interface RunOptions {
  /** Transport to serve on; defaults to stdio. */
  transport?: Transport;
}

const USAGE = [
  "Usage: mcp-readonly-fs --root DIR [--root DIR ...] [options]",
  "",
  "Options:",
  "  --root DIR           Allowlisted root directory (repeatable, required)",
  "  --deny GLOB          Extra deny glob (repeatable)",
  "  --max-file-bytes N   Largest readable file in bytes",
  "  --max-results N      Largest number of list or search results",
  "  --help               Show this help",
  "",
].join("\n");

const VALUE_FLAGS = new Set(["--root", "--deny", "--max-file-bytes", "--max-results"]);

type Parsed =
  | { kind: "error"; message: string }
  | { kind: "help" }
  | {
      kind: "ok";
      roots: string[];
      deny: string[];
      maxFileBytes: number | undefined;
      maxResults: number | undefined;
    };

function parseCount(value: string): number | undefined {
  return /^[0-9]{1,15}$/.test(value) ? Number(value) : undefined;
}

function parseArgs(argv: readonly string[]): Parsed {
  const roots: string[] = [];
  const deny: string[] = [];
  let maxFileBytes: number | undefined;
  let maxResults: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--help" || arg === "-h") {
      return { kind: "help" };
    }
    const eq = arg.indexOf("=");
    const flag = arg.startsWith("--") && eq > 0 ? arg.slice(0, eq) : arg;
    if (!VALUE_FLAGS.has(flag)) {
      return { kind: "error", message: `unknown argument: ${clip(arg, 100)}` };
    }
    let value: string | undefined;
    if (flag === arg) {
      i += 1;
      value = argv[i];
    } else {
      value = arg.slice(eq + 1);
    }
    if (value === undefined) {
      return { kind: "error", message: `${flag} requires a value` };
    }
    if (flag === "--root") {
      roots.push(value);
    } else if (flag === "--deny") {
      deny.push(value);
    } else {
      const count = parseCount(value);
      if (count === undefined) {
        return { kind: "error", message: `${flag} must be a non-negative integer` };
      }
      if (flag === "--max-file-bytes") {
        maxFileBytes = count;
      } else {
        maxResults = count;
      }
    }
  }
  return { kind: "ok", roots, deny, maxFileBytes, maxResults };
}

function messageOf(error: unknown): string {
  return clip(error instanceof Error ? error.message : String(error), 200);
}

/**
 * Command line entry point: serves the read-only filesystem tools over stdio.
 *
 * @param argv - Arguments without the program name.
 * @param io - Output streams.
 * @param options - Optional transport override.
 * @returns 0 on success, 1 when the server fails at runtime, 2 on usage,
 * IO or parse errors.
 */
export async function run(argv: string[], io: CliIo, options: RunOptions = {}): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.kind === "error") {
    io.stderr.write(`error: ${parsed.message}\n${USAGE}`);
    return 2;
  }
  if (parsed.kind === "help") {
    io.stdout.write(USAGE);
    return 0;
  }
  if (parsed.roots.length === 0) {
    io.stderr.write(`error: at least one --root is required\n${USAGE}`);
    return 2;
  }
  let policy: Awaited<ReturnType<typeof createPolicy>>;
  try {
    policy = await createPolicy({
      roots: parsed.roots,
      deny: [...DEFAULT_DENY, ...parsed.deny],
      ...(parsed.maxFileBytes === undefined ? {} : { maxFileBytes: parsed.maxFileBytes }),
      ...(parsed.maxResults === undefined ? {} : { maxResults: parsed.maxResults }),
    });
  } catch (error) {
    io.stderr.write(`error: ${messageOf(error)}\n`);
    return 2;
  }
  const server = createReadonlyFsServer(policy);
  try {
    const closed = new Promise<void>((resolve) => {
      server.server.onclose = () => {
        resolve();
      };
    });
    let transport = options.transport;
    if (transport === undefined) {
      transport = new StdioServerTransport();
      process.stdin.once("end", () => {
        void server.close();
      });
    }
    await server.connect(transport);
    await closed;
    return 0;
  } catch (error) {
    io.stderr.write(`error: server failed: ${messageOf(error)}\n`);
    return 1;
  }
}
