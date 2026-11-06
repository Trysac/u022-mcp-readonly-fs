import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface Fixture {
  base: string;
  root: string;
  outside: string;
  symlinks: boolean;
  cleanup(): Promise<void>;
}

export async function put(file: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, data);
}

export async function makeFixture(): Promise<Fixture> {
  const base = await realpath(await mkdtemp(join(tmpdir(), "rofs-")));
  const root = join(base, "root");
  const outside = join(base, "outside");
  await put(join(root, "a.txt"), "hello");
  await put(join(root, "abcdef.txt"), "abcdef");
  await put(join(root, "sub", ".env.local"), "S=1");
  await put(join(root, ".env"), "SECRET=1");
  await put(join(root, ".git", "config"), "[core]");
  await put(join(root, "k.pem"), "KEY");
  await put(join(root, ".envrc"), "x");
  await put(join(root, "env.txt"), "y");
  await put(join(outside, "secret.txt"), "TOPSECRET");
  await put(join(outside, "needle.txt"), "needle");
  let symlinks = true;
  try {
    await symlink(outside, join(root, "link"), "dir");
    await symlink(join(root, ".env"), join(root, "alias-env"));
    await symlink(join(outside, "secret.txt"), join(root, "out-file"));
  } catch {
    symlinks = false;
  }
  return {
    base,
    root,
    outside,
    symlinks,
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}

export async function connect(server: McpServer): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

export interface ToolOutput {
  text: string;
  isError: boolean;
}

export async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutput> {
  try {
    const res = (await client.callTool({
      name,
      arguments: args,
    })) as unknown as { content: { text: string }[]; isError?: boolean };
    return { text: res.content[0]?.text ?? "", isError: res.isError === true };
  } catch (error) {
    return { text: String(error), isError: true };
  }
}
