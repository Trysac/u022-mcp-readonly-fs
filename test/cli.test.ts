import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { afterAll, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { call, makeFixture } from "./helpers.js";

const fx = await makeFixture();
afterAll(() => fx.cleanup());

function makeIo() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: {
        write: (text: string) => {
          out.push(text);
        },
      },
      stderr: {
        write: (text: string) => {
          err.push(text);
        },
      },
    },
  };
}

describe("run usage errors", () => {
  it("returns 2 with a message when no root is given", async () => {
    const { io, err } = makeIo();
    expect(await run([], io)).toBe(2);
    expect(err.join("")).toContain("--root is required");
  });

  it("returns 2 when the root is missing", async () => {
    const missingDir = join(fx.base, "does-not-exist");
    const { io, err } = makeIo();
    expect(await run(["--root", missingDir], io)).toBe(2);
    expect(err.join("")).toContain("error:");
  });

  it("returns 2 for unknown flags, missing values and bad numbers", async () => {
    for (const argv of [
      ["--bogus"],
      ["--root"],
      ["--root", fx.root, "--max-results", "abc"],
      ["--root", fx.root, "--max-file-bytes", "-5"],
    ]) {
      const { io, err } = makeIo();
      expect(await run(argv, io)).toBe(2);
      expect(err.join("")).not.toBe("");
    }
  });

  it("returns 2 for invalid policy values", async () => {
    const limit = makeIo();
    expect(await run(["--root", fx.root, "--max-file-bytes", "0"], limit.io)).toBe(2);
    expect(limit.err.join("")).toContain("maxFileBytes");
    const glob = makeIo();
    expect(await run(["--root", fx.root, "--deny", "g".repeat(300)], glob.io)).toBe(2);
  });

  it("prints help and returns 0", async () => {
    const { io, out } = makeIo();
    expect(await run(["--help"], io)).toBe(0);
    expect(out.join("")).toContain("Usage:");
  });
});

describe("run serving", () => {
  it("serves the tools with extra deny globs and limits, returning 0", async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const { io } = makeIo();
    const done = run(
      [`--root=${fx.root}`, "--deny", "**/a.txt", "--max-results", "1", "--max-file-bytes", "5"],
      io,
      { transport: serverSide },
    );
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(clientSide);
    expect((await call(client, "read_file", { path: "a.txt" })).text).toBe("ERROR DENIED: a.txt");
    expect((await call(client, "read_file", { path: ".env" })).text).toBe("ERROR DENIED: .env");
    expect((await call(client, "read_file", { path: "abcdef.txt" })).text).toBe(
      "ERROR TOO_LARGE: abcdef.txt",
    );
    expect((await call(client, "read_file", { path: "env.txt" })).text).toBe("y");
    const listing = JSON.parse((await call(client, "list_directory", { path: "." })).text) as {
      entries: unknown[];
      truncated: boolean;
    };
    expect(listing.entries).toHaveLength(1);
    expect(listing.truncated).toBe(true);
    await client.close();
    expect(await done).toBe(0);
  });

  it("returns 1 when the transport fails to start", async () => {
    const failing: Transport = {
      start: async () => {
        throw new Error("boom");
      },
      send: async () => {},
      close: async () => {},
    };
    const { io, err } = makeIo();
    expect(await run(["--root", fx.root], io, { transport: failing })).toBe(1);
    expect(err.join("")).toContain("boom");
  });
});
