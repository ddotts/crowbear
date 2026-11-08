import OBR from "@owlbear-rodeo/sdk";
import { z } from "zod";
import { execute } from "./commands";
import { ships as sampleShips, crew as samplesCrew } from "./sample-data";
import {
  commandSchema,
  type GmState,
  gmSchema,
  type PublicState,
  publicSchema,
} from "./schema";
import { assembler, KEY, REQUEST, RESPONSE, storageKey } from "./transport";

const envelope = z.object({ sessionId: z.string(), command: commandSchema });
function initialGm(): GmState {
  return {
    version: 1,
    ships: structuredClone(sampleShips.filter((s) => s.kind === "NPC")),
    crew: structuredClone(samplesCrew.filter((c) => c.ship !== "kestrel")),
    encounters: [
      {
        id: "relay",
        name: "Ambush at the relay",
        shipIds: sampleShips.map((s) => s.id),
        round: 1,
        turn: 0,
        running: true,
      },
    ],
    activeEncounterId: "relay",
  };
}
if (OBR.isAvailable)
  OBR.onReady(async () => {
    const connection = await OBR.player.getConnectionId();
    const user = OBR.player.id;
    const localKey = storageKey(OBR.room.id);
    let shared: PublicState | null = null;
    let knownRole = await OBR.player.getRole();
    let generation = 0;
    let queue = Promise.resolve();
    let ready: Promise<void> = Promise.resolve();
    const replies = new Map<
      string,
      z.infer<typeof import("./transport").replySchema>
    >();
    const assemble = assembler();
    const getGm = () => {
      const raw = localStorage.getItem(localKey);
      return raw ? gmSchema.parse(JSON.parse(raw)) : initialGm();
    };
    async function load() {
      const ticket = ++generation;
      shared = null;
      if (!(await OBR.scene.isReady()) || ticket !== generation) return;
      const metadata = await OBR.scene.getMetadata();
      if (ticket !== generation) return;
      const role = await OBR.player.getRole();
      if (ticket !== generation) return;
      if (metadata[KEY] === undefined) {
        if (role !== "GM") return;
        const next: PublicState = {
          version: 1,
          sessionId: crypto.randomUUID(),
          ownerId: user,
          controllerId: connection,
          revision: 0,
          ships: structuredClone(
            sampleShips.filter((s) => s.kind === "Player"),
          ),
          crew: structuredClone(
            samplesCrew.filter((c) => c.ship === "kestrel"),
          ),
        };
        // Fail before sharing a scene if private storage is unavailable.
        localStorage.setItem(localKey, JSON.stringify(getGm()));
        if (ticket !== generation) return;
        await OBR.scene.setMetadata({ [KEY]: next });
        if (ticket === generation) shared = next;
      } else {
        const next = publicSchema.parse(metadata[KEY]);
        if (role === "GM" && next.ownerId === user) {
          localStorage.setItem(localKey, JSON.stringify(getGm()));
          const party = await OBR.party.getPlayers();
          if (ticket !== generation) return;
          if (
            next.controllerId !== connection &&
            !party.some(
              (p) => p.connectionId === next.controllerId && p.role === "GM",
            )
          ) {
            next.controllerId = connection;
            await OBR.scene.setMetadata({ [KEY]: next });
          }
        }
        if (ticket === generation) shared = next;
      }
    }
    OBR.scene.onReadyChange(() => {
      ready = load();
      void ready.catch(() => {});
    });
    OBR.scene.onMetadataChange((metadata) => {
      const parsed = publicSchema.safeParse(metadata[KEY]);
      if (parsed.success) shared = parsed.data;
    });
    OBR.party.onChange((players) => {
      if (
        shared?.ownerId === user &&
        shared.controllerId !== connection &&
        !players.some(
          (p) => p.connectionId === shared?.controllerId && p.role === "GM",
        )
      ) {
        ready = load();
        void ready.catch(() => {});
      }
    });
    OBR.player.onChange((player) => {
      if (knownRole === player.role) return;
      knownRole = player.role;
      ready = load();
      void ready.catch(() => {});
    });
    OBR.broadcast.onMessage(REQUEST, (event) => {
      // Only connected players can allocate a multi-part request buffer.
      void (async () => {
        const party = await OBR.party.getPlayers();
        if (
          event.connectionId !== connection &&
          !party.some((p) => p.connectionId === event.connectionId)
        )
          return;
        const assembled = assemble(event.connectionId, event.data);
        if (!assembled) return;
        queue = queue
          .catch(() => {})
          .then(async () => {
            try {
              await ready;
            } catch {
              /* Re-read private storage below to return its concrete error. */
            }
            if (
              !shared ||
              shared.controllerId !== connection ||
              shared.ownerId !== user ||
              (await OBR.player.getRole()) !== "GM"
            )
              return;
            const request = envelope.safeParse(assembled.value);
            const isGM = event.connectionId === connection;
            // Imported libraries and NPC commands are local to the controlling GM.
            const destination = isGM ? "LOCAL" : "REMOTE";
            const cacheKey = `${event.connectionId}:${assembled.id}`;
            const previous = replies.get(cacheKey);
            if (previous) {
              await OBR.broadcast.sendMessage(RESPONSE, previous, {
                destination,
              });
              return;
            }
            const ticket = generation;
            let response: z.infer<typeof import("./transport").replySchema> = {
              id: assembled.id,
              sessionId: shared.sessionId,
            };
            try {
              if (!request.success) throw new Error("Invalid command data.");
              if (request.data.sessionId !== shared.sessionId)
                throw new Error(
                  "The scene changed. Refresh before making another change.",
                );
              const freshParty = await OBR.party.getPlayers();
              if (
                !isGM &&
                !freshParty.some(
                  (p) =>
                    p.connectionId === event.connectionId &&
                    p.role === "PLAYER",
                )
              )
                throw new Error(
                  "Only this GM's local panel or a connected player can submit changes.",
                );
              const before = getGm();
              const result = execute(
                { shared, gm: before },
                request.data.command,
                isGM,
              );
              if (ticket !== generation || !(await OBR.scene.isReady()))
                throw new Error(
                  "Scene changed before saving. Refresh and try again.",
                );
              if (result.gmChanged)
                localStorage.setItem(localKey, JSON.stringify(result.state.gm));
              try {
                if (result.publicChanged) {
                  if (ticket !== generation)
                    throw new Error("Scene changed before saving.");
                  await OBR.scene.setMetadata({ [KEY]: result.state.shared });
                }
              } catch (error) {
                if (result.gmChanged)
                  localStorage.setItem(localKey, JSON.stringify(before));
                throw error;
              }
              if (ticket === generation) shared = result.state.shared;
              if (
                result.roll &&
                new TextEncoder().encode(JSON.stringify(result.roll))
                  .byteLength > 12000
              )
                throw new Error(
                  "Roll request is too large. Split it into smaller actions.",
                );
              response = {
                ...response,
                notice: result.notice,
                roll: result.roll,
              };
            } catch (error) {
              response.error =
                error instanceof Error
                  ? error.message
                  : typeof error === "string"
                    ? error
                    : "Could not save the change.";
            }
            replies.set(cacheKey, response);
            if (replies.size > 200)
              replies.delete(replies.keys().next().value as string);
            await OBR.broadcast.sendMessage(RESPONSE, response, {
              destination,
            });
          });
        void queue.catch(() => {});
      })().catch(() => {});
    });
    ready = load();
    void ready.catch(() => {});
  });
