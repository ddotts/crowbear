import { z } from "zod";

export const rollTargetSchema = z.enum(["everyone", "self", "dm", "gm_only"]);
export type RollTarget = z.infer<typeof rollTargetSchema>;

export const readySchema = z.object({
  requestId: z.string(),
  ready: z.literal(true),
  timestamp: z.number(),
});

export const validationSchema = z.object({
  requestId: z.string(),
  notation: z.string(),
  valid: z.boolean(),
  error: z.object({ message: z.string(), position: z.number() }).optional(),
  timestamp: z.number(),
});
export type NotationValidation = z.infer<typeof validationSchema>;

export const diceGroupSchema = z.object({
  description: z.string().optional(),
  diceModel: z.string().optional(),
  diceType: z.string(),
  dice: z.array(
    z.object({
      diceId: z.string(),
      rollId: z.string(),
      diceType: z.string(),
      value: z.number(),
      kept: z.boolean(),
    }),
  ),
  total: z.number(),
  isNegative: z.boolean().optional(),
  isCondensed: z.boolean().optional(),
  condensedCount: z.number().optional(),
});
export type DiceGroup = z.infer<typeof diceGroupSchema>;

export const rollResultSchema = z.object({
  rollId: z.string(),
  playerId: z.string(),
  playerName: z.string(),
  rollTarget: rollTargetSchema,
  timestamp: z.number(),
  result: z.object({
    rollId: z.string(),
    diceNotation: z.string(),
    totalValue: z.number(),
    rollSummary: z.string(),
    groups: z.array(diceGroupSchema),
  }),
});
export type RollResult = z.infer<typeof rollResultSchema>;

export const rollErrorSchema = z.object({
  rollId: z.string(),
  error: z.string(),
  notation: z.string(),
});

export interface RollOptions {
  diceNotation: string;
  rollTarget: RollTarget;
  showResults: boolean;
  timeoutMs?: number;
}

export interface RollRequest extends Omit<RollOptions, "timeoutMs"> {
  rollId: string;
  playerId: string;
  playerName: string;
  timestamp: number;
  source: string;
}
