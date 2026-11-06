import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = fileURLToPath(new URL("../src/", import.meta.url));
const files = readdirSync(srcDir).filter((f) => f.endsWith(".ts"));
const forbidden =
  /\b(writeFile|appendFile|rm|rmdir|unlink|mkdir|rename|copyFile|symlink|truncate|createWriteStream)(Sync)?\s*\(/;

describe("absence of write tools", () => {
  it("scans at least the library modules", () => {
    expect(files).toContain("ops.ts");
    expect(files).toContain("server.ts");
  });

  it.each(files)("%s contains no filesystem write call", (file) => {
    const source = readFileSync(`${srcDir}${file}`, "utf8");
    expect(forbidden.test(source)).toBe(false);
    expect(source).not.toMatch(/O_WRONLY|O_RDWR|O_APPEND|O_CREAT/);
  });
});
