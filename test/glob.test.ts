import { describe, expect, it } from "vitest";
import { matchGlob } from "../src/glob.js";

describe("matchGlob", () => {
  it("matches ** as zero or more segments", () => {
    expect(matchGlob("**/.env", ".env")).toBe(true);
    expect(matchGlob("**/.env", "sub/.env")).toBe(true);
    expect(matchGlob("**/.env", "a/b/c/.env")).toBe(true);
    expect(matchGlob("**/.git/**", ".git/config")).toBe(true);
    expect(matchGlob("**/.git/**", "x/.git/a/b")).toBe(true);
  });

  it("keeps neighbours of denied names readable", () => {
    expect(matchGlob("**/.env", ".envrc")).toBe(false);
    expect(matchGlob("**/.env", "env.txt")).toBe(false);
    expect(matchGlob("**/.env.*", ".env")).toBe(false);
    expect(matchGlob("**/.env.*", "sub/.env.local")).toBe(true);
    expect(matchGlob("**/.env", "x.env")).toBe(false);
    expect(matchGlob("**/.env", ".env/x")).toBe(false);
  });

  it("supports * and ? inside one segment only", () => {
    expect(matchGlob("**/*.pem", "k.pem")).toBe(true);
    expect(matchGlob("**/*.pem", "a/.hidden.pem")).toBe(true);
    expect(matchGlob("**/id_rsa*", "id_rsa.pub")).toBe(true);
    expect(matchGlob("a?c", "abc")).toBe(true);
    expect(matchGlob("a?c", "ac")).toBe(false);
    expect(matchGlob("*", "a/b")).toBe(false);
    expect(matchGlob("a/*", "a/b")).toBe(true);
    expect(matchGlob("*", "")).toBe(false);
    expect(matchGlob("**", "")).toBe(true);
  });

  it("does not blow up on pathological patterns", () => {
    const text = "a".repeat(2000);
    expect(matchGlob("*a*a*a*a*a*a*a*a*b", text)).toBe(false);
    expect(matchGlob("*a*a*a*a*a*a*a*a*", text)).toBe(true);
    const deep = `${Array.from({ length: 199 }, () => "a").join("/")}/b`;
    expect(matchGlob("**/**/**/**/a", deep)).toBe(false);
  });
});
