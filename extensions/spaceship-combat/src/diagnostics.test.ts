import { describe, expect, it } from "vitest";
import {
  describeError,
  diagnosticSchema,
  jsonBytes,
  makeDiagnostic,
} from "./diagnostics";
import { replySchema } from "./transport";

describe("save diagnostics", () => {
  it("preserves messages from native, string and structured SDK errors", () => {
    expect(describeError(new Error("Native error"))).toBe("Native error");
    expect(describeError("String error")).toBe("String error");
    expect(
      describeError({
        name: "SDKError",
        message: "Metadata rejected",
        code: "LIMIT",
      }),
    ).toBe("Metadata rejected [LIMIT]");
    expect(
      describeError({ error: { message: "Nested failure", status: 403 } }),
    ).toBe("Nested failure [403]");
  });
  it("describes unknown/circular errors without dumping arbitrary payload values", () => {
    expect(describeError({ payload: { secret: "private NPC" } })).toBe(
      "Error object (fields: payload)",
    );
    const circular: { error?: unknown } = {};
    circular.error = circular;
    expect(describeError(circular)).toBe("Error object (fields: error)");
    expect(describeError(null)).toBe("Unknown error (null)");
    expect(describeError("x".repeat(10000))).toHaveLength(3000);
  });
  it("counts UTF-8 payload bytes including the metadata envelope", () => {
    expect(jsonBytes({ label: "é" })).toBe(
      new TextEncoder().encode('{"label":"é"}').byteLength,
    );
    expect(jsonBytes({ namespace: { label: "é" } })).toBeGreaterThan(
      jsonBytes({ label: "é" }),
    );
  });
  it("round-trips bounded context through replies without including the imported JSON", () => {
    const diagnostic = makeDiagnostic(
      {
        operation: "import",
        stage: "save Owlbear scene metadata",
        requestId: "request",
        commandBytes: 2000,
        sharedBytes: 1000,
        rollback: "GM browser storage restored",
        importCounts: { ships: 1, crew: 2, encounters: 1 },
      },
      { message: "SDK failure", code: "FAIL" },
    );
    expect(diagnostic.error).toBe("SDK failure [FAIL]");
    expect(diagnostic.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(diagnosticSchema.parse(diagnostic)).toEqual(diagnostic);
    expect(
      replySchema.parse({
        id: "request",
        sessionId: "scene",
        error: diagnostic.error,
        diagnostic,
      }).diagnostic,
    ).toEqual(diagnostic);
    expect(Object.keys(diagnostic)).not.toContain("library");
  });
});
