import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createPolicy, isDenied, PolicyError, resolveSafe } from "../src/index.js";
import {
  containingRoot,
  DEFAULT_DENY,
  isDeniedFor,
  relativePosix,
  resolveSafeFor,
  validateRequested,
} from "../src/policy.js";
import { clip } from "../src/util.js";
import { makeFixture, put } from "./helpers.js";

const BS = String.fromCharCode(92);
const NUL = String.fromCharCode(0);
const fx = await makeFixture();
afterAll(() => fx.cleanup());
const policy = await createPolicy({ roots: [fx.root] });

describe("createPolicy", () => {
  it("applies defaults and realpath-resolved roots", () => {
    expect(policy.roots).toEqual([fx.root]);
    expect(policy.deny).toEqual([...DEFAULT_DENY]);
    expect(policy.maxFileBytes).toBe(1024 * 1024);
    expect(policy.maxResults).toBe(200);
    expect(policy.maxSearchFiles).toBe(10_000);
    expect(policy.maxDepth).toBe(32);
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it("throws MISSING_ROOT for unusable roots", async () => {
    const missing = join(fx.base, "missing");
    await expect(createPolicy({ roots: [missing] })).rejects.toMatchObject({
      code: "MISSING_ROOT",
    });
    const notDir = createPolicy({ roots: [join(fx.root, "a.txt")] });
    await expect(notDir).rejects.toBeInstanceOf(PolicyError);
    await expect(createPolicy({ roots: [] })).rejects.toMatchObject({
      code: "MISSING_ROOT",
    });
    await expect(createPolicy({ roots: [`a${NUL}b`] })).rejects.toMatchObject({
      code: "MISSING_ROOT",
    });
    await expect(createPolicy({ roots: [""] })).rejects.toMatchObject({
      code: "MISSING_ROOT",
    });
    const many = Array.from({ length: 65 }, () => fx.root);
    await expect(createPolicy({ roots: many })).rejects.toMatchObject({
      code: "MISSING_ROOT",
    });
  });

  it("keeps error messages short", async () => {
    const long = join(fx.base, "m".repeat(3000));
    const error = await createPolicy({ roots: [long] }).catch((e) => e);
    expect(error).toBeInstanceOf(PolicyError);
    expect((error as Error).message.length).toBeLessThan(200);
  });

  it("deduplicates roots", async () => {
    const p = await createPolicy({ roots: [fx.root, fx.root] });
    expect(p.roots).toHaveLength(1);
  });

  it("throws INVALID_GLOB for bad globs", async () => {
    const bad = (deny: string[]) => createPolicy({ roots: [fx.root], deny }).catch((e) => e);
    const tooLong = await bad(["a".repeat(257)]);
    expect(tooLong).toBeInstanceOf(PolicyError);
    expect(tooLong.code).toBe("INVALID_GLOB");
    expect((await bad([""])).code).toBe("INVALID_GLOB");
    expect((await bad([`a${NUL}`])).code).toBe("INVALID_GLOB");
    expect((await bad([5 as unknown as string])).code).toBe("INVALID_GLOB");
    expect((await bad(Array.from({ length: 257 }, () => "a"))).code).toBe("INVALID_GLOB");
    const ok = await createPolicy({ roots: [fx.root], deny: ["a".repeat(256)] });
    expect(ok.deny).toHaveLength(1);
  });

  it("throws INVALID_LIMIT for bad limits", async () => {
    for (const maxFileBytes of [0, 1.5, Number.NaN, -1, 2 ** 40]) {
      const attempt = createPolicy({ roots: [fx.root], maxFileBytes });
      await expect(attempt).rejects.toMatchObject({ code: "INVALID_LIMIT" });
    }
    const zero = createPolicy({ roots: [fx.root], maxResults: 0 });
    await expect(zero).rejects.toMatchObject({ code: "INVALID_LIMIT" });
    const p = await createPolicy({
      roots: [fx.root],
      maxResults: 3,
      maxSearchFiles: 4,
      maxDepth: 5,
    });
    expect([p.maxResults, p.maxSearchFiles, p.maxDepth]).toEqual([3, 4, 5]);
  });

  it("exposes a stable error shape", () => {
    const error = new PolicyError("INVALID_GLOB", "x");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("PolicyError");
    expect(error.code).toBe("INVALID_GLOB");
  });
});

describe("resolveSafe containment", () => {
  it("resolves files and the root itself", async () => {
    expect(await resolveSafe(policy, "a.txt")).toEqual({
      ok: true,
      path: join(fx.root, "a.txt"),
      root: fx.root,
    });
    expect(await resolveSafe(policy, ".")).toMatchObject({ ok: true });
    expect(await resolveSafe(policy, join(fx.root, "sub"))).toMatchObject({
      ok: true,
    });
  });

  it("rejects traversal and absolute outside paths", async () => {
    const outside = { ok: false, code: "OUTSIDE_ROOT" };
    expect(await resolveSafe(policy, "../outside.txt")).toEqual(outside);
    expect(await resolveSafe(policy, "../outside/secret.txt")).toEqual(outside);
    expect(await resolveSafe(policy, join(fx.outside, "secret.txt"))).toEqual(outside);
    expect(await resolveSafe(policy, join(fx.outside, "nope.txt"))).toEqual(outside);
    expect(await resolveSafe(policy, "..")).toEqual(outside);
  });

  it.skipIf(!fx.symlinks)("rejects symlinks pointing outside", async () => {
    const outside = { ok: false, code: "OUTSIDE_ROOT" };
    expect(await resolveSafe(policy, "out-file")).toEqual(outside);
    expect(await resolveSafe(policy, "link/secret.txt")).toEqual(outside);
    expect(await resolveSafe(policy, "link/missing.txt")).toEqual(outside);
  });

  it("reports missing files inside a root as NOT_FOUND", async () => {
    const missing = { ok: false, code: "NOT_FOUND" };
    expect(await resolveSafe(policy, "missing.txt")).toEqual(missing);
    expect(await resolveSafe(policy, "a.txt/child")).toEqual(missing);
  });

  it("maps overlong names to INVALID_PATH or NOT_FOUND", async () => {
    const result = await resolveSafe(policy, "n".repeat(300));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["INVALID_PATH", "NOT_FOUND"]).toContain(result.code);
    }
  });

  it("returns OUTSIDE_ROOT when the policy has no root", async () => {
    const empty = { ...policy, roots: [] };
    expect(await resolveSafe(empty, "a.txt")).toEqual({
      ok: false,
      code: "OUTSIDE_ROOT",
    });
  });

  it("supports several roots and picks the matching one", async () => {
    const second = join(fx.base, "second");
    await put(join(second, "s.txt"), "s");
    const both = await createPolicy({ roots: [fx.root, second] });
    expect(await resolveSafe(both, join(second, "s.txt"))).toMatchObject({
      ok: true,
      root: second,
    });
  });
});

describe("invalid paths", () => {
  it("rejects NUL, empty and oversized paths", async () => {
    const invalid = { ok: false, code: "INVALID_PATH" };
    expect(await resolveSafe(policy, `a.txt${NUL}.png`)).toEqual(invalid);
    expect(await resolveSafe(policy, "")).toEqual(invalid);
    expect(await resolveSafe(policy, "a".repeat(4097))).toEqual(invalid);
    expect(await resolveSafe(policy, 5 as unknown as string)).toEqual(invalid);
  });

  it("rejects Windows alternate data streams", async () => {
    const invalid = { ok: false, code: "INVALID_PATH" };
    expect(await resolveSafeFor("win32", policy, "a.txt:secret")).toEqual(invalid);
    expect(await resolveSafeFor("win32", policy, "a.txt::$DATA")).toEqual(invalid);
    expect(validateRequested("a.txt:secret", "win32")).toBe("INVALID_PATH");
    expect(validateRequested("a.txt:secret", "linux")).toBeUndefined();
  });

  it("keeps drive prefixes but rejects UNC and device prefixes on win32", () => {
    expect(validateRequested(`C:${BS}data${BS}x`, "win32")).toBeUndefined();
    expect(validateRequested(`${BS}${BS}?${BS}C:${BS}x`, "win32")).toBe("INVALID_PATH");
    expect(validateRequested(`${BS}${BS}server${BS}share`, "win32")).toBe("INVALID_PATH");
    expect(validateRequested("//server/share", "win32")).toBe("INVALID_PATH");
    expect(validateRequested(`C:${BS}a:b`, "win32")).toBe("INVALID_PATH");
  });
});

describe("deny globs", () => {
  it("hides and refuses denied names", async () => {
    for (const rel of [".env", "sub/.env.local", ".git/config", "k.pem"]) {
      expect(isDenied(policy, rel)).toBe(true);
      expect(await resolveSafe(policy, rel)).toEqual({
        ok: false,
        code: "DENIED",
      });
    }
  });

  it("keeps lookalikes readable", async () => {
    expect(isDenied(policy, ".envrc")).toBe(false);
    expect(isDenied(policy, "env.txt")).toBe(false);
    expect(await resolveSafe(policy, ".envrc")).toMatchObject({ ok: true });
    expect(await resolveSafe(policy, "env.txt")).toMatchObject({ ok: true });
  });

  it.skipIf(!fx.symlinks)("refuses a symlink alias to a denied file", async () => {
    expect(await resolveSafe(policy, "alias-env")).toEqual({
      ok: false,
      code: "DENIED",
    });
  });

  it("ignores case on win32 only", () => {
    expect(isDeniedFor("win32", policy, ".ENV")).toBe(true);
    expect(isDeniedFor("win32", policy, ".env.")).toBe(true);
    expect(isDeniedFor("win32", policy, ".env ")).toBe(true);
    expect(isDeniedFor("win32", policy, `.GIT${BS}config`)).toBe(true);
    expect(isDeniedFor("win32", policy, "sub/K.PEM.")).toBe(true);
    expect(isDeniedFor("win32", policy, ".envrc")).toBe(false);
    expect(isDeniedFor("win32", policy, "..")).toBe(false);
    expect(isDeniedFor("linux", policy, ".ENV")).toBe(false);
    expect(isDeniedFor("linux", policy, ".env ")).toBe(false);
  });

  it("normalises dot segments and fails closed on huge input", () => {
    expect(isDenied(policy, "./sub//.env")).toBe(true);
    expect(isDenied(policy, "x/".repeat(5000))).toBe(true);
    expect(isDenied(policy, 5 as unknown as string)).toBe(true);
    expect(isDenied(policy, "")).toBe(false);
  });

  it("evaluates **/**/**/**/a on a 200-segment path without blow-up", async () => {
    const p = await createPolicy({
      roots: [fx.root],
      deny: ["**/**/**/**/a"],
    });
    const path = `${Array.from({ length: 199 }, () => "a").join("/")}/b`;
    expect(path.split("/")).toHaveLength(200);
    expect(isDenied(p, path)).toBe(false);
    expect(isDenied(p, "x/y/a")).toBe(true);
  });
});

describe("helpers", () => {
  it("containingRoot compares by path boundary", () => {
    expect(containingRoot(["/r"], "/r/x", "linux")).toBe("/r");
    expect(containingRoot(["/r"], "/r", "linux")).toBe("/r");
    expect(containingRoot(["/r"], "/rx", "linux")).toBeUndefined();
    expect(containingRoot(["/"], "/x", "linux")).toBe("/");
    expect(containingRoot(["/r", "/r/in"], "/r/in/f", "linux")).toBe("/r/in");
    expect(containingRoot(["/r"], "/R/x", "linux")).toBeUndefined();
  });

  it("containingRoot ignores case on win32", () => {
    const root = `C:${BS}Data`;
    expect(containingRoot([root], `c:${BS}data${BS}x`, "win32")).toBe(root);
    expect(containingRoot([root], `c:${BS}database`, "win32")).toBeUndefined();
  });

  it("relativePosix returns POSIX separators", () => {
    expect(relativePosix(fx.root, join(fx.root, "a", "b"))).toBe("a/b");
    expect(relativePosix(fx.root, fx.root)).toBe("");
  });

  it("clip bounds and cleans untrusted text", () => {
    expect(clip("a".repeat(500), 200)).toHaveLength(200);
    expect(clip(`a${NUL}b\nc`, 10)).toBe("a b c");
    expect(clip("😀😀😀", 3).length).toBeLessThanOrEqual(3);
  });
});
