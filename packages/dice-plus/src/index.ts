import OBR from "@owlbear-rodeo/sdk";
import {
  type NotationValidation,
  type RollOptions,
  type RollRequest,
  type RollResult,
  readySchema,
  rollErrorSchema,
  rollResultSchema,
  validationSchema,
} from "./protocol";

export type {
  DiceGroup,
  NotationValidation,
  RollOptions,
  RollRequest,
  RollResult,
  RollTarget,
} from "./protocol";

export class DicePlusTimeoutError extends Error {
  constructor(channel: string) {
    super(
      `Dice+ did not respond on ${channel}. Enable Dice+ in this room and try again.`,
    );
    this.name = "DicePlusTimeoutError";
  }
}

/** Call after OBR.onReady. Each extension must supply its own stable source ID. */
export function createDicePlusClient(
  source: string,
  sdk: Pick<typeof OBR, "broadcast" | "player"> = OBR,
) {
  function request<T>(
    channel: string,
    payload: object,
    responseChannels: string[],
    parse: (channel: string, data: unknown) => T | undefined,
    timeoutMs: number,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const unsubscribers: (() => void)[] = [];
      const cleanup = () => {
        clearTimeout(timer);
        for (const unsubscribe of unsubscribers) unsubscribe();
      };
      const fail = (error: unknown) => {
        cleanup();
        reject(error);
      };
      const timer = setTimeout(
        () => fail(new DicePlusTimeoutError(channel)),
        timeoutMs,
      );
      for (const responseChannel of responseChannels) {
        unsubscribers.push(
          sdk.broadcast.onMessage(responseChannel, (event) => {
            try {
              const result = parse(responseChannel, event.data);
              if (result !== undefined) {
                cleanup();
                resolve(result);
              }
            } catch (error) {
              fail(error);
            }
          }),
        );
      }
      // Subscribe first: local broadcasts can respond before sendMessage resolves.
      void sdk.broadcast
        .sendMessage(channel, payload, { destination: "ALL" })
        .catch(fail);
    });
  }

  return {
    async isReady(timeoutMs = 1000): Promise<boolean> {
      const requestId = crypto.randomUUID();
      try {
        return await request(
          "dice-plus/isReady",
          { requestId, timestamp: Date.now() },
          ["dice-plus/isReady"],
          (_channel, data) => {
            const parsed = readySchema.safeParse(data);
            return parsed.success && parsed.data.requestId === requestId
              ? true
              : undefined;
          },
          timeoutMs,
        );
      } catch (error) {
        if (error instanceof DicePlusTimeoutError) return false;
        throw error;
      }
    },

    validateNotation(
      notation: string,
      timeoutMs = 1000,
    ): Promise<NotationValidation> {
      const requestId = crypto.randomUUID();
      return request(
        "dice-plus/validate-notation",
        { requestId, notation, timestamp: Date.now() },
        ["dice-plus/validate-notation"],
        (_channel, data) => {
          const parsed = validationSchema.safeParse(data);
          return parsed.success && parsed.data.requestId === requestId
            ? parsed.data
            : undefined;
        },
        timeoutMs,
      );
    },

    async roll(options: RollOptions): Promise<RollResult> {
      const [playerId, playerName] = await Promise.all([
        sdk.player.getId(),
        sdk.player.getName(),
      ]);
      const payload: RollRequest = {
        rollId: crypto.randomUUID(),
        playerId,
        playerName,
        diceNotation: options.diceNotation,
        rollTarget: options.rollTarget,
        showResults: options.showResults,
        timestamp: Date.now(),
        source,
      };
      const resultChannel = `${source}/roll-result`;
      const errorChannel = `${source}/roll-error`;
      return request(
        "dice-plus/roll-request",
        payload,
        [resultChannel, errorChannel],
        (channel, data) => {
          if (channel === errorChannel) {
            const parsed = rollErrorSchema.safeParse(data);
            if (parsed.success && parsed.data.rollId === payload.rollId)
              throw new Error(parsed.data.error);
            return undefined;
          }
          const parsed = rollResultSchema.safeParse(data);
          return parsed.success && parsed.data.rollId === payload.rollId
            ? parsed.data
            : undefined;
        },
        options.timeoutMs ?? 60_000,
      );
    },
  };
}
