import { createDicePlusClient } from "@crowbear/dice-plus";
import OBR from "@owlbear-rodeo/sdk";
import { allData, execute, type State } from "./commands";
import type { Crew, Ship } from "./rules";
import { crew, ships } from "./sample-data";
import {
  type Command,
  type Encounter,
  type GmState,
  gmSchema,
  type PublicState,
  publicSchema,
} from "./schema";
import {
  chunks,
  KEY,
  REQUEST,
  RESPONSE,
  replySchema,
  storageKey,
} from "./transport";
export type ViewState = {
  sessionId: string | null;
  ships: Ship[];
  crew: Crew[];
  encounters: Encounter[];
  activeEncounterId: string | null;
  role: "GM" | "Player";
  status: string;
  ready: boolean;
};
export function demoState(): State {
  return {
    shared: {
      version: 1,
      sessionId: "demo",
      ownerId: "demo",
      controllerId: "demo",
      revision: 0,
      ships: structuredClone(ships.filter((s) => s.kind === "Player")),
      crew: structuredClone(crew.filter((c) => c.ship === "kestrel")),
    },
    gm: {
      version: 1,
      ships: structuredClone(ships.filter((s) => s.kind === "NPC")),
      crew: structuredClone(crew.filter((c) => c.ship !== "kestrel")),
      encounters: [
        {
          id: "relay",
          name: "Ambush at the relay",
          shipIds: ships.map((s) => s.id),
          round: 1,
          turn: 0,
          running: true,
        },
      ],
      activeEncounterId: "relay",
    },
  };
}
const emptyGm = (): GmState => ({
  version: 1,
  ships: [],
  crew: [],
  encounters: [],
  activeEncounterId: null,
});
export function createSession(update: (view: ViewState) => void) {
  let demo = demoState();
  let live: ViewState | null = null;
  let publicSessionId = "";
  let controller = "";
  let actualRole: "GM" | "Player" = "GM";
  let demoRole: "GM" | "Player" = "GM";
  let reading = 0;
  let sharedSignature = "";
  let partySignature = "";
  const pending = new Map<
    string,
    {
      resolve: (reply: ReturnType<typeof replySchema.parse>) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  function showDemo() {
    const data = allData(demo);
    update({
      sessionId: "demo",
      ...data,
      encounters: demo.gm.encounters,
      activeEncounterId: demo.gm.activeEncounterId,
      role: demoRole,
      status: "Standalone demo · changes reset on reload",
      ready: true,
    });
  }
  async function read() {
    const ticket = ++reading;
    try {
      actualRole = (await OBR.player.getRole()) === "GM" ? "GM" : "Player";
      let shared: PublicState | undefined;
      if (await OBR.scene.isReady()) {
        const metadata = await OBR.scene.getMetadata();
        sharedSignature = JSON.stringify(metadata[KEY]);
        if (metadata[KEY] !== undefined)
          shared = publicSchema.parse(metadata[KEY]);
      }
      let gm = emptyGm();
      if (actualRole === "GM") {
        const raw = localStorage.getItem(storageKey(OBR.room.id));
        if (raw) gm = gmSchema.parse(JSON.parse(raw));
      }
      if (ticket !== reading) return;
      if (!shared) {
        publicSessionId = "";
        controller = "";
        live = {
          sessionId: null,
          ships: gm.ships,
          crew: gm.crew,
          encounters: gm.encounters,
          activeEncounterId: gm.activeEncounterId,
          role: actualRole,
          status:
            "Open a scene and enable the extension for its controlling GM.",
          ready: false,
        };
      } else {
        publicSessionId = shared.sessionId;
        controller = shared.controllerId;
        const party = await OBR.party.getPlayers();
        partySignature = party
          .map((p) => `${p.connectionId}:${p.role}`)
          .sort()
          .join("|");
        const own = await OBR.player.getConnectionId();
        if (ticket !== reading) return;
        const owner = actualRole !== "GM" || shared.ownerId === OBR.player.id;
        const online =
          controller === own ||
          party.some((p) => p.connectionId === controller && p.role === "GM");
        live = {
          sessionId: shared.sessionId,
          ships: [...shared.ships, ...gm.ships],
          crew: [...shared.crew, ...gm.crew],
          encounters: gm.encounters,
          activeEncounterId: gm.activeEncounterId,
          role: actualRole,
          status: !owner
            ? "This scene belongs to a different GM browser. Player ships are read-only here."
            : online
              ? "Scene connected · GM controller online"
              : "Controlling GM is offline. Shared ships are read-only.",
          ready: online && owner,
        };
      }
      update(live);
    } catch (error) {
      if (ticket !== reading) return;
      live = {
        sessionId: null,
        ships: [],
        crew: [],
        encounters: [],
        activeEncounterId: null,
        role: actualRole,
        status:
          error instanceof Error
            ? error.message
            : "Could not load stored data.",
        ready: false,
      };
      update(live);
    }
  }
  function start() {
    if (!OBR.isAvailable) {
      showDemo();
      return;
    }
    update({
      sessionId: null,
      ships: [],
      crew: [],
      encounters: [],
      activeEncounterId: null,
      role: "Player",
      status: "Connecting to Owlbear…",
      ready: false,
    });
    OBR.onReady(() => {
      OBR.broadcast.onMessage(RESPONSE, (event) => {
        const parsed = replySchema.safeParse(event.data);
        if (
          !parsed.success ||
          event.connectionId !== controller ||
          parsed.data.sessionId !== publicSessionId
        )
          return;
        const request = pending.get(parsed.data.id);
        if (!request) return;
        clearTimeout(request.timer);
        pending.delete(parsed.data.id);
        if (parsed.data.error) request.reject(new Error(parsed.data.error));
        else request.resolve(parsed.data);
      });
      OBR.scene.onMetadataChange((metadata) => {
        if (JSON.stringify(metadata[KEY]) !== sharedSignature) void read();
      });
      OBR.scene.onReadyChange(() => {
        for (const request of pending.values()) {
          clearTimeout(request.timer);
          request.reject(
            new Error("Scene changed. Review current state before retrying."),
          );
        }
        pending.clear();
        void read();
      });
      OBR.party.onChange((players) => {
        if (
          players
            .map((p) => `${p.connectionId}:${p.role}`)
            .sort()
            .join("|") !== partySignature
        )
          void read();
      });
      OBR.player.onChange((player) => {
        if ((player.role === "GM" ? "GM" : "Player") !== actualRole)
          void read();
      });
      window.addEventListener("storage", (event) => {
        if (event.key === storageKey(OBR.room.id)) void read();
      });
      void read();
    });
  }
  async function command(command: Command) {
    if (!OBR.isAvailable) {
      const result = execute(demo, command, demoRole === "GM");
      demo = result.state;
      showDemo();
      return { notice: result.notice, roll: result.roll };
    }
    if (!live?.ready)
      throw new Error(live?.status ?? "Wait for Owlbear to connect.");
    const id = crypto.randomUUID();
    const reply = await new Promise<ReturnType<typeof replySchema.parse>>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(
            new Error(
              "GM did not acknowledge this change. It may have saved; refresh and inspect before retrying.",
            ),
          );
        }, 15000);
        pending.set(id, { resolve, reject, timer });
        void (async () => {
          for (const chunk of chunks(id, {
            sessionId: publicSessionId,
            command,
          }))
            await OBR.broadcast.sendMessage(REQUEST, chunk, {
              destination: actualRole === "GM" ? "LOCAL" : "REMOTE",
            });
        })().catch((error) => {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        });
      },
    );
    await read();
    return reply;
  }
  async function roll(commandData: Command) {
    const result = await command(commandData);
    if (!result.roll) return result.notice ?? "Action used.";
    if (!OBR.isAvailable)
      return `${result.roll.target === "gm_only" ? "Private" : "Public"} demo · ${result.roll.notation}. No dice rolled.`;
    const dice = createDicePlusClient("com.ddotts.crowbear.spaceship-combat");
    if (!(await dice.isReady()))
      throw new Error("Enable Dice+ in this room before rolling.");
    const validation = await dice.validateNotation(result.roll.notation);
    if (!validation.valid)
      throw new Error(
        validation.error?.message ?? "Dice+ rejected this notation.",
      );
    await dice.roll({
      diceNotation: validation.notation,
      rollTarget: result.roll.target,
      showResults: true,
    });
    return "Roll complete. Dice+ displays it to the correct audience.";
  }
  return {
    start,
    command,
    roll,
    refresh: () => (OBR.isAvailable ? read() : Promise.resolve(showDemo())),
    setDemoRole: (role: "GM" | "Player") => {
      demoRole = role;
      showDemo();
    },
  };
}
