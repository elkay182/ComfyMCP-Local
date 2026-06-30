import { describe, expect, it } from "vitest";
import { containPath } from "../../src/policy/path-policy.js";

describe("path policy", () => {
  it("allows contained relative paths", () => {
    expect(containPath("/tmp/root", "inputs/example.png")).toMatchObject({
      ok: true,
      normalizedPath: "/tmp/root/inputs/example.png"
    });
  });

  it("rejects traversal and unsafe Windows path forms", () => {
    expect(containPath("/tmp/root", "../escape.png")).toEqual({
      ok: false,
      reason: "OUTSIDE_ROOT"
    });
    expect(containPath("/tmp/root", "\\\\server\\share\\file.png")).toEqual({
      ok: false,
      reason: "UNC_PATH"
    });
    expect(containPath("/tmp/root", "CON")).toEqual({
      ok: false,
      reason: "RESERVED_NAME"
    });
  });
});
