import { z } from "zod";
import { diagnosticSchema } from "./diagnostics";
export const KEY = "com.ddotts.crowbear.spaceship-combat/state";
export const REQUEST = "com.ddotts.crowbear.spaceship-combat/request";
export const RESPONSE = "com.ddotts.crowbear.spaceship-combat/response";
export const storageKey = (room: string) =>
  `com.ddotts.crowbear.spaceship-combat/gm/${room}`;
const chunkSchema = z.object({
  id: z.string().uuid(),
  index: z.number().int().min(0),
  total: z.number().int().min(1).max(2000),
  text: z.string().max(1500),
});
/** Short chunks stay below the documented 16 KB broadcast cap even with escaping. */
export function chunks(id: string, value: unknown) {
  const json = JSON.stringify(value);
  if (json.length > 3000000)
    throw new Error(
      "Import is too large (maximum 3 million characters). Split the library into smaller imports.",
    );
  const total = Math.ceil(json.length / 1500);
  return Array.from({ length: total }, (_, index) => ({
    id,
    index,
    total,
    text: json.slice(index * 1500, (index + 1) * 1500),
  }));
}
export function assembler() {
  const messages = new Map<
    string,
    { parts: Map<number, string>; total: number; at: number }
  >();
  return (connection: string, input: unknown) => {
    const parsed = chunkSchema.safeParse(input);
    if (!parsed.success) return;
    for (const [key, value] of messages)
      if (Date.now() - value.at > 30000) messages.delete(key);
    const c = parsed.data;
    if (c.index >= c.total) return;
    const key = `${connection}:${c.id}`;
    if (!messages.has(key)) {
      if (messages.size >= 20) return;
      messages.set(key, { parts: new Map(), total: c.total, at: Date.now() });
    }
    const message = messages.get(key);
    if (!message || message.total !== c.total) return;
    message.parts.set(c.index, c.text);
    if (message.parts.size !== message.total) return;
    messages.delete(key);
    try {
      return {
        id: c.id,
        value: JSON.parse(
          Array.from({ length: c.total }, (_, i) => message.parts.get(i)).join(
            "",
          ),
        ) as unknown,
      };
    } catch {
      return;
    }
  };
}
export const replySchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  error: z.string().optional(),
  diagnostic: diagnosticSchema.optional(),
  notice: z.string().optional(),
  selectionId: z.string().uuid().optional(),
  roll: z
    .object({
      notation: z.string(),
      target: z.enum(["gm_only", "everyone"]),
      initiativeToken: z.string().optional(),
    })
    .optional(),
});
