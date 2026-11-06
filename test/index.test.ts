import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";

describe("public entry point", () => {
  it("exports exactly the documented API", () => {
    expect(Object.keys(api).sort()).toEqual([
      "PolicyError",
      "createPolicy",
      "createReadonlyFsServer",
      "isDenied",
      "resolveSafe",
    ]);
  });

  it("exposes callable functions", () => {
    expect(typeof api.createPolicy).toBe("function");
    expect(typeof api.resolveSafe).toBe("function");
    expect(typeof api.isDenied).toBe("function");
    expect(typeof api.createReadonlyFsServer).toBe("function");
  });
});
