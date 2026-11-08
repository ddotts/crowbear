import { z } from "zod";
import packageSource from "../package.json?raw";

export const diagnosticSchema = z.object({
  version: z.string(),
  time: z.string(),
  operation: z.string(),
  stage: z.string(),
  requestId: z.string().optional(),
  error: z.string(),
  errorType: z.string(),
  commandBytes: z.number().optional(),
  sharedBytes: z.number().optional(),
  metadataUpdateBytes: z.number().optional(),
  gmBytes: z.number().optional(),
  revision: z.number().optional(),
  importMode: z.string().optional(),
  importCounts: z
    .object({ ships: z.number(), crew: z.number(), encounters: z.number() })
    .optional(),
  rollback: z.string().optional(),
});
export type SaveDiagnostic = z.infer<typeof diagnosticSchema>;
export type DiagnosticContext = Omit<
  SaveDiagnostic,
  "version" | "time" | "error" | "errorType"
>;

/** SDK rejections may be structured objects rather than Error instances. */
export function describeError(error: unknown, depth = 0): string {
  if (depth > 3) return "Nested error";
  if (typeof error === "string") return error.slice(0, 3000);
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const detail =
      record.message ?? record.error ?? record.reason ?? record.cause;
    const message =
      detail !== undefined && detail !== error
        ? describeError(detail, depth + 1)
        : `Error object (fields: ${Object.keys(record).slice(0, 12).join(", ") || "none"})`;
    const code = record.code ?? record.status ?? record.statusCode;
    return `${message}${typeof code === "string" || typeof code === "number" ? ` [${String(code).slice(0, 100)}]` : ""}`.slice(
      0,
      4000,
    );
  }
  return `Unknown error (${String(error)})`;
}

export function jsonBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function makeDiagnostic(
  context: DiagnosticContext,
  error: unknown,
): SaveDiagnostic {
  return {
    ...context,
    version: String(JSON.parse(packageSource).version),
    time: new Date().toISOString(),
    error: describeError(error),
    errorType:
      error &&
      typeof error === "object" &&
      "name" in error &&
      typeof error.name === "string"
        ? error.name
        : typeof error,
  };
}

export class CommandError extends Error {
  constructor(
    message: string,
    public readonly diagnostic?: SaveDiagnostic,
  ) {
    super(message);
    this.name = "CommandError";
  }
}
