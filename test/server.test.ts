import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  type CreatePolicyInput,
  createPolicy,
  createReadonlyFsServer,
  type ReadonlyFsEvent,
  type ReadonlyFsServerOptions,
} from "../src/index.js";
import { FsToolError, searchFiles } from "../src/ops.js";
import { call, connect, makeFixture, put } from "./helpers.js";

const fx = await makeFixture();
afterAll(() => fx.cleanup());

async function open(input: Partial<CreatePolicyInput> = {}, opts: ReadonlyFsServerOptions = {}) {
  const policy = await createPolicy({ roots: [fx.root], ...input });
  return connect(createReadonlyFsServer(policy, opts));
}

function names(text: string): string[] {
  const parsed = JSON.parse(text) as { entries: { name: string }[] };
  return parsed.entries.map((e) => e.name);
}

describe("tool surface", () => {
  it("lists exactly four read-only tools", async () => {
    const client = await open();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "list_directory",
      "read_file",
      "search_files",
      "stat",
    ]);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.openWorldHint).toBe(false);
    }
  });
});

describe("list_directory", () => {
  it("hides denied entries and keeps lookalikes", async () => {
    for (const name of [
      ".env",
      ".env.local",
      "k.pem",
      ".envrc",
      "env.txt",
      "visible.txt",
      ".git/config",
    ]) {
      await put(join(fx.root, "ld", name), "x");
    }
    const client = await open();
    const res = await call(client, "list_directory", { path: "ld" });
    expect(res.isError).toBe(false);
    expect(names(res.text)).toEqual([".envrc", "env.txt", "visible.txt"]);
  });

  it.skipIf(!fx.symlinks)("hides escaping and aliased symlinks", async () => {
    const client = await open();
    const res = await call(client, "list_directory", { path: "." });
    const listed = names(res.text);
    expect(listed).toContain("a.txt");
    for (const hidden of ["link", "alias-env", "out-file", ".env", ".git"]) {
      expect(listed).not.toContain(hidden);
    }
  });

  it("returns at most maxResults entries and flags truncation", async () => {
    for (const n of [1, 2, 3, 4, 5]) {
      await put(join(fx.root, "many", `f${n}.txt`), "x");
    }
    const client = await open({ maxResults: 2 });
    const res = await call(client, "list_directory", { path: "many" });
    const parsed = JSON.parse(res.text) as {
      entries: unknown[];
      truncated: boolean;
    };
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.truncated).toBe(true);
    const all = await open();
    const full = JSON.parse((await call(all, "list_directory", { path: "many" })).text) as {
      entries: unknown[];
      truncated: boolean;
    };
    expect(full.entries).toHaveLength(5);
    expect(full.truncated).toBe(false);
  });

  it("truncates when more entries exist than may be examined", async () => {
    const client = await open({ maxSearchFiles: 2 });
    const res = await call(client, "list_directory", { path: "many" });
    const parsed = JSON.parse(res.text) as {
      entries: unknown[];
      truncated: boolean;
    };
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.truncated).toBe(true);
  });

  it("reports entry types", async () => {
    const client = await open();
    const res = await call(client, "list_directory", { path: "." });
    const parsed = JSON.parse(res.text) as {
      entries: { name: string; type: string }[];
    };
    expect(parsed.entries.find((e) => e.name === "sub")?.type).toBe("directory");
    expect(parsed.entries.find((e) => e.name === "a.txt")?.type).toBe("file");
  });

  it("returns error codes", async () => {
    const client = await open();
    const code = async (path: string) => (await call(client, "list_directory", { path })).text;
    expect(await code("a.txt")).toBe("ERROR NOT_A_DIRECTORY: a.txt");
    expect(await code("missing")).toBe("ERROR NOT_FOUND: missing");
    expect(await code("..")).toBe("ERROR OUTSIDE_ROOT: ..");
    expect(await code(".git")).toBe("ERROR DENIED: .git");
  });
});

describe("read_file", () => {
  it("reads text and honours offset and length", async () => {
    const client = await open();
    expect((await call(client, "read_file", { path: "a.txt" })).text).toBe("hello");
    const part = await call(client, "read_file", {
      path: "abcdef.txt",
      offset: 2,
      length: 3,
    });
    expect(part.text).toBe("cde");
    expect((await call(client, "read_file", { path: "abcdef.txt", offset: 4 })).text).toBe("ef");
    expect((await call(client, "read_file", { path: "abcdef.txt", length: 2 })).text).toBe("ab");
    const beyond = await call(client, "read_file", {
      path: "abcdef.txt",
      offset: 99,
    });
    expect(beyond).toEqual({ text: "", isError: false });
  });

  it("removes a UTF-8 BOM and replaces invalid bytes", async () => {
    await put(join(fx.root, "enc", "bom.txt"), Buffer.from([0xef, 0xbb, 0xbf, 0x68, 0x69]));
    await put(join(fx.root, "enc", "bad.txt"), Buffer.from([0x61, 0xff, 0x62]));
    const client = await open();
    expect((await call(client, "read_file", { path: "enc/bom.txt" })).text).toBe("hi");
    expect((await call(client, "read_file", { path: "enc/bad.txt" })).text).toBe("a\ufffdb");
  });

  it("refuses denied files but reads lookalikes", async () => {
    const client = await open();
    expect((await call(client, "read_file", { path: ".env" })).text).toBe("ERROR DENIED: .env");
    expect((await call(client, "read_file", { path: "sub/.env.local" })).text).toBe(
      "ERROR DENIED: sub/.env.local",
    );
    expect((await call(client, "read_file", { path: ".envrc" })).text).toBe("x");
    expect((await call(client, "read_file", { path: "env.txt" })).text).toBe("y");
  });

  it.skipIf(!fx.symlinks)("refuses an alias of a denied file", async () => {
    const client = await open();
    expect((await call(client, "read_file", { path: "alias-env" })).text).toBe(
      "ERROR DENIED: alias-env",
    );
  });

  it("returns TOO_LARGE over maxFileBytes", async () => {
    await put(join(fx.root, "caps", "big.txt"), "x".repeat(200));
    const client = await open({ maxFileBytes: 100 });
    expect((await call(client, "read_file", { path: "caps/big.txt" })).text).toBe(
      "ERROR TOO_LARGE: caps/big.txt",
    );
    await put(join(fx.root, "caps", "exact.txt"), "y".repeat(100));
    const exact = await call(client, "read_file", { path: "caps/exact.txt" });
    expect(exact.text).toHaveLength(100);
  });

  it("returns BINARY for a NUL in the first 8192 bytes only", async () => {
    const early = Buffer.alloc(20, 0x61);
    early[10] = 0;
    await put(join(fx.root, "caps", "early.bin"), early);
    const late = Buffer.alloc(9000, 0x61);
    late[8500] = 0;
    await put(join(fx.root, "caps", "late.bin"), late);
    const edge = Buffer.alloc(9000, 0x61);
    edge[8191] = 0;
    await put(join(fx.root, "caps", "edge.bin"), edge);
    const client = await open();
    expect((await call(client, "read_file", { path: "caps/early.bin" })).text).toBe(
      "ERROR BINARY: caps/early.bin",
    );
    expect((await call(client, "read_file", { path: "caps/edge.bin" })).text).toBe(
      "ERROR BINARY: caps/edge.bin",
    );
    const lateRes = await call(client, "read_file", { path: "caps/late.bin" });
    expect(lateRes.isError).toBe(false);
  });

  it("returns NOT_A_FILE for directories", async () => {
    const client = await open();
    expect((await call(client, "read_file", { path: "sub" })).text).toBe("ERROR NOT_A_FILE: sub");
  });

  it("rejects malformed arguments", async () => {
    const client = await open({ maxFileBytes: 100 });
    expect((await call(client, "read_file", { path: "" })).isError).toBe(true);
    expect((await call(client, "read_file", { path: "a.txt", offset: -1 })).isError).toBe(true);
    expect((await call(client, "read_file", { path: "a.txt", length: 101 })).isError).toBe(true);
    expect((await call(client, "read_file", { path: "a".repeat(4097) })).isError).toBe(true);
  });
});

describe("search_files", () => {
  it("returns at most maxResults and flags truncation", async () => {
    for (const n of [1, 2, 3, 4, 5]) {
      await put(join(fx.root, "srch", `alpha${n}.txt`), "x");
    }
    const limited = await open({ maxResults: 2 });
    const res = await call(limited, "search_files", {
      path: "srch",
      query: "alpha",
    });
    const parsed = JSON.parse(res.text) as {
      results: unknown[];
      truncated: boolean;
    };
    expect(parsed.results).toHaveLength(2);
    expect(parsed.truncated).toBe(true);
    const all = await open();
    const full = JSON.parse(
      (await call(all, "search_files", { path: "srch", query: "ALPHA" })).text,
    ) as { results: { path: string }[]; truncated: boolean };
    expect(full.results).toHaveLength(5);
    expect(full.truncated).toBe(false);
    expect(full.results[0]?.path).toBe(join(fx.root, "srch", "alpha1.txt"));
  });

  it("skips denied, oversized, binary files and symlinks", async () => {
    await put(join(fx.root, "cs", "c.txt"), "line1\nhas NeEdLe here\n");
    await put(join(fx.root, "cs", ".env"), "needle");
    await put(join(fx.root, "cs", ".git", "config"), "needle");
    await put(join(fx.root, "cs", "big.txt"), `needle ${"x".repeat(300)}`);
    await put(join(fx.root, "cs", "bin.dat"), Buffer.from("needle\u0000"));
    const client = await open({ maxFileBytes: 200 });
    const res = await call(client, "search_files", {
      path: "cs",
      query: "needle",
      contents: true,
    });
    const parsed = JSON.parse(res.text) as {
      results: { path: string; kind: string; line?: number; text?: string }[];
      truncated: boolean;
    };
    expect(parsed.results).toEqual([
      {
        path: join(fx.root, "cs", "c.txt"),
        kind: "content",
        line: 2,
        text: "has NeEdLe here",
      },
    ]);
    expect(parsed.truncated).toBe(false);
  });

  it("matches names without reading contents by default", async () => {
    const client = await open();
    const res = await call(client, "search_files", {
      path: "cs",
      query: "needle",
    });
    expect(JSON.parse(res.text)).toEqual({ results: [], truncated: false });
  });

  it.skipIf(!fx.symlinks)("does not traverse symlinked directories", async () => {
    const client = await open();
    const byName = await call(client, "search_files", {
      path: ".",
      query: "secret",
    });
    expect(byName.text).not.toContain("secret.txt");
    const byContent = await call(client, "search_files", {
      path: ".",
      query: "topsecret",
      contents: true,
    });
    expect(byContent.text).not.toContain("secret.txt");
    expect(byContent.text).not.toContain("TOPSECRET");
  });

  it("bounds depth and examined entries", async () => {
    await put(join(fx.root, "dp", "l1", "l2", "needle.txt"), "x");
    const shallow = await open({ maxDepth: 1 });
    const cut = JSON.parse(
      (await call(shallow, "search_files", { path: "dp", query: "needle" })).text,
    ) as { results: unknown[]; truncated: boolean };
    expect(cut.results).toHaveLength(0);
    expect(cut.truncated).toBe(true);
    const deep = await open();
    const found = JSON.parse(
      (await call(deep, "search_files", { path: "dp", query: "needle" })).text,
    ) as { results: unknown[] };
    expect(found.results).toHaveLength(1);
    const few = await open({ maxSearchFiles: 3 });
    const limited = JSON.parse(
      (await call(few, "search_files", { path: "srch", query: "alpha" })).text,
    ) as { truncated: boolean };
    expect(limited.truncated).toBe(true);
  });

  it("stops at a content byte budget and caps result count in content mode", async () => {
    const policy = await createPolicy({ roots: [fx.root], maxResults: 1 });
    const budget = await searchFiles(policy, "cs", "needle", true, 5);
    expect(budget.results).toEqual([]);
    expect(budget.truncated).toBe(true);
    await put(join(fx.root, "multi", "m.txt"), "hit\nhit\nhit\n");
    const capped = await searchFiles(policy, "multi", "hit", true);
    expect(capped.results).toHaveLength(1);
    expect(capped.truncated).toBe(true);
  });

  it("reports errors and rejects bad queries", async () => {
    const client = await open();
    expect((await call(client, "search_files", { path: "a.txt", query: "x" })).text).toBe(
      "ERROR NOT_A_DIRECTORY: a.txt",
    );
    expect((await call(client, "search_files", { path: "..", query: "x" })).text).toBe(
      "ERROR OUTSIDE_ROOT: ..",
    );
    expect((await call(client, "search_files", { path: ".", query: "" })).isError).toBe(true);
    const long = await call(client, "search_files", { path: ".", query: "q".repeat(257) });
    expect(long.isError).toBe(true);
  });
});

describe("stat", () => {
  it("returns type, size and mtime", async () => {
    const client = await open();
    const file = JSON.parse((await call(client, "stat", { path: "a.txt" })).text) as {
      type: string;
      size: number;
      mtime: string;
    };
    expect(file.type).toBe("file");
    expect(file.size).toBe(5);
    expect(Number.isNaN(Date.parse(file.mtime))).toBe(false);
    const dir = JSON.parse((await call(client, "stat", { path: "sub" })).text) as { type: string };
    expect(dir.type).toBe("directory");
  });

  it("refuses denied and missing paths", async () => {
    const client = await open();
    expect((await call(client, "stat", { path: ".env" })).text).toBe("ERROR DENIED: .env");
    expect((await call(client, "stat", { path: "nope" })).text).toBe("ERROR NOT_FOUND: nope");
  });
});

describe("error results", () => {
  it.skipIf(!fx.symlinks)("never contain the resolved outside path", async () => {
    const client = await open();
    for (const tool of ["read_file", "stat", "list_directory"]) {
      for (const path of ["out-file", "link", "link/secret.txt"]) {
        const res = await call(client, tool, { path });
        expect(res.isError).toBe(true);
        expect(res.text).toBe(`ERROR OUTSIDE_ROOT: ${path}`);
        expect(res.text).not.toContain(fx.outside);
        expect(res.text).not.toContain(fx.base);
      }
    }
  });

  it("refuses absolute outside paths without leaking more", async () => {
    const client = await open();
    const target = join(fx.outside, "secret.txt");
    const res = await call(client, "read_file", { path: target });
    expect(res.isError).toBe(true);
    expect(res.text.startsWith("ERROR OUTSIDE_ROOT: ")).toBe(true);
    expect(res.text).not.toContain("TOPSECRET");
  });

  it("echoes at most 200 characters of the requested path", async () => {
    const client = await open();
    const res = await call(client, "stat", { path: "z".repeat(300) });
    expect(res.isError).toBe(true);
    // Linux rejects a 300-byte name with ENAMETOOLONG (INVALID_PATH); Windows reports NOT_FOUND.
    const prefix = /^ERROR (NOT_FOUND|INVALID_PATH): /.exec(res.text)?.[0] ?? "";
    expect(prefix).not.toBe("");
    expect(res.text.length - prefix.length).toBeLessThanOrEqual(200);
  });

  it("sanitises control characters in the echoed path", async () => {
    const client = await open();
    const res = await call(client, "stat", { path: "a\nb" });
    expect(res.text).not.toContain("\n");
  });
});

describe("events", () => {
  it("reports success and failure without paths", async () => {
    const events: ReadonlyFsEvent[] = [];
    const client = await open({}, { onEvent: (e) => events.push(e) });
    await call(client, "stat", { path: "a.txt" });
    await call(client, "read_file", { path: ".env" });
    expect(events).toEqual([
      { tool: "stat", ok: true },
      { tool: "read_file", ok: false, code: "DENIED" },
    ]);
  });

  it("ignores a throwing observer", async () => {
    const client = await open(
      {},
      {
        onEvent: () => {
          throw new Error("observer failure");
        },
      },
    );
    expect((await call(client, "stat", { path: "a.txt" })).isError).toBe(false);
  });

  it("exposes FsToolError codes", () => {
    const error = new FsToolError("BINARY");
    expect(error.code).toBe("BINARY");
    expect(error).toBeInstanceOf(Error);
  });
});
