import type OBR from "@owlbear-rodeo/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDicePlusClient, DicePlusTimeoutError } from "./index";

// The real SDK requires a browser; protocol tests provide the transport below.
vi.mock("@owlbear-rodeo/sdk", () => ({ default: {} }));

function setup() {
  const listeners = new Map<
    string,
    Set<(event: { data: unknown; connectionId: string }) => void>
  >();
  const emit = (channel: string, data: unknown) => {
    for (const listener of [...(listeners.get(channel) ?? [])])
      listener({ data, connectionId: "peer" });
  };
  const sdk = {
    player: {
      getId: vi.fn().mockResolvedValue("player-1"),
      getName: vi.fn().mockResolvedValue("Ada"),
    },
    broadcast: {
      sendMessage: vi
        .fn<typeof OBR.broadcast.sendMessage>()
        .mockResolvedValue(undefined),
      onMessage: vi.fn(
        (
          channel: string,
          callback: (event: { data: unknown; connectionId: string }) => void,
        ) => {
          const callbacks = listeners.get(channel) ?? new Set();
          callbacks.add(callback);
          listeners.set(channel, callbacks);
          return () => callbacks.delete(callback);
        },
      ),
    },
  };
  const client = createDicePlusClient(
    "com.crowbear.test",
    sdk as unknown as Pick<typeof OBR, "broadcast" | "player">,
  );
  const listenerCount = () =>
    [...listeners.values()].reduce((n, callbacks) => n + callbacks.size, 0);
  return { sdk, client, emit, listenerCount };
}

function result(rollId: string) {
  return {
    rollId,
    playerId: "player-1",
    playerName: "Ada",
    rollTarget: "self",
    timestamp: 123,
    result: {
      rollId,
      diceNotation: "2*2d6",
      totalValue: 16,
      rollSummary: "2*[4,4] 8 = 16",
      groups: [
        {
          diceType: "d6",
          total: 8,
          isCondensed: true,
          condensedCount: 2,
          dice: [
            {
              diceId: "aggregate",
              rollId,
              diceType: "d6",
              value: 8,
              kept: true,
            },
          ],
        },
      ],
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("Dice+ broadcast contract", () => {
  it("subscribes before sending and ignores request echoes, malformed data, and other request IDs", async () => {
    const { sdk, client, emit, listenerCount } = setup();
    sdk.broadcast.sendMessage.mockImplementation(async (channel, payload) => {
      emit(channel, payload);
      emit(channel, null);
      emit(channel, {
        ...(payload as object),
        ready: true,
        requestId: "other",
      });
      emit(channel, { ...(payload as object), ready: true });
    });
    await expect(client.isReady()).resolves.toBe(true);
    expect(sdk.broadcast.sendMessage).toHaveBeenCalledWith(
      "dice-plus/isReady",
      {
        requestId: expect.any(String),
        timestamp: expect.any(Number),
      },
      { destination: "ALL" },
    );
    expect(listenerCount()).toBe(0);
  });

  it("returns false when Dice+ is absent and releases its listener", async () => {
    vi.useFakeTimers();
    const { client, listenerCount } = setup();
    const ready = client.isReady();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(ready).resolves.toBe(false);
    expect(listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves notation validation errors and correlates concurrent checks", async () => {
    const { sdk, client, emit, listenerCount } = setup();
    const first = client.validateNotation("bad");
    const second = client.validateNotation("1d20");
    const requests = sdk.broadcast.sendMessage.mock.calls;
    emit("dice-plus/validate-notation", {
      ...(requests[1][1] as object),
      valid: true,
    });
    emit("dice-plus/validate-notation", {
      ...(requests[0][1] as object),
      valid: false,
      error: { message: "Unexpected token", position: 0 },
    });
    await expect(first).resolves.toMatchObject({
      valid: false,
      error: { message: "Unexpected token", position: 0 },
    });
    await expect(second).resolves.toMatchObject({
      valid: true,
      notation: "1d20",
    });
    expect(listenerCount()).toBe(0);
  });

  it("rejects validation timeouts rather than reporting valid notation as invalid", async () => {
    vi.useFakeTimers();
    const { client, listenerCount } = setup();
    const check = expect(
      client.validateNotation("1d20"),
    ).rejects.toBeInstanceOf(DicePlusTimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await check;
    expect(listenerCount()).toBe(0);
  });

  it("sends the documented player and audience fields and preserves computed and condensed results", async () => {
    const { sdk, client, emit, listenerCount } = setup();
    sdk.broadcast.sendMessage.mockImplementation(async (channel, payload) => {
      expect(channel).toBe("dice-plus/roll-request");
      emit("com.crowbear.test/roll-result", result("unrelated"));
      emit("com.crowbear.test/roll-result", {
        ...result((payload as { rollId: string }).rollId),
        result: { totalValue: "wrong type" },
      });
      emit(
        "com.crowbear.test/roll-result",
        result((payload as { rollId: string }).rollId),
      );
    });
    const roll = await client.roll({
      diceNotation: "2*2d6",
      rollTarget: "self",
      showResults: false,
    });
    expect(sdk.broadcast.sendMessage).toHaveBeenCalledWith(
      "dice-plus/roll-request",
      {
        rollId: expect.any(String),
        playerId: "player-1",
        playerName: "Ada",
        source: "com.crowbear.test",
        diceNotation: "2*2d6",
        rollTarget: "self",
        showResults: false,
        timestamp: expect.any(Number),
      },
      { destination: "ALL" },
    );
    expect(roll.result.totalValue).toBe(16);
    expect(roll.result.groups[0]).toMatchObject({
      isCondensed: true,
      condensedCount: 2,
      total: 8,
    });
    expect(listenerCount()).toBe(0);
  });

  it("rejects a matching roll error and removes both listeners", async () => {
    const { sdk, client, emit, listenerCount } = setup();
    sdk.broadcast.sendMessage.mockImplementation(async (_channel, payload) => {
      emit("com.crowbear.test/roll-error", {
        rollId: "unrelated",
        error: "Ignore",
        notation: "bad",
      });
      emit("com.crowbear.test/roll-error", {
        rollId: (payload as { rollId: string }).rollId,
        error: "Invalid notation",
        notation: "bad",
      });
    });
    await expect(
      client.roll({
        diceNotation: "bad",
        rollTarget: "everyone",
        showResults: true,
      }),
    ).rejects.toThrow("Invalid notation");
    expect(listenerCount()).toBe(0);
  });

  it("does not retry a timed-out roll and removes its result and error listeners", async () => {
    vi.useFakeTimers();
    const { sdk, client, listenerCount } = setup();
    const roll = expect(
      client.roll({
        diceNotation: "1d20",
        rollTarget: "gm_only",
        showResults: true,
        timeoutMs: 2000,
      }),
    ).rejects.toBeInstanceOf(DicePlusTimeoutError);
    await vi.advanceTimersByTimeAsync(2000);
    await roll;
    expect(sdk.broadcast.sendMessage).toHaveBeenCalledTimes(1);
    expect(listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates transport failures and immediately cleans up listeners and timers", async () => {
    vi.useFakeTimers();
    const { sdk, client, listenerCount } = setup();
    sdk.broadcast.sendMessage.mockRejectedValue(
      new Error("Transport disconnected"),
    );
    await expect(client.isReady()).rejects.toThrow("Transport disconnected");
    await expect(
      client.roll({
        diceNotation: "1d20",
        rollTarget: "dm",
        showResults: true,
      }),
    ).rejects.toThrow("Transport disconnected");
    expect(listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
