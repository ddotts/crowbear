import { createDicePlusClient } from "@crowbear/dice-plus";
import OBR from "@owlbear-rodeo/sdk";
import { allData, execute, type State } from "./commands";
import {
  CommandError,
  describeError,
  jsonBytes,
  makeDiagnostic,
} from "./diagnostics";
import { type Crew, randomInitiative, type Ship } from "./rules";
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
  round: number;
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
      round: 1,
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
          currentCrewId: null,
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
      round: demo.shared.round,
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
          round: 1,
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
          round: shared.round,
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
        round: 1,
        ships: [],
        crew: [],
        encounters: [],
        activeEncounterId: null,
        role: actualRole,
        status: describeError(error),
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
      round: 1,
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
        if (parsed.data.error)
          request.reject(
            new CommandError(parsed.data.error, parsed.data.diagnostic),
          );
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
      return {
        notice: result.notice,
        roll: result.roll,
        selectionId: result.selectionId,
      };
    }
    if (!live?.ready)
      throw new Error(live?.status ?? "Wait for Owlbear to connect.");
    const id = crypto.randomUUID();
    const reply = await new Promise<ReturnType<typeof replySchema.parse>>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(
            new CommandError(
              "GM did not acknowledge this change. It may have saved; refresh and inspect before retrying.",
              makeDiagnostic(
                {
                  operation: command.op,
                  stage: "wait for GM acknowledgement",
                  requestId: id,
                  commandBytes: jsonBytes(command),
                },
                "No response within 15 seconds",
              ),
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
          reject(
            new CommandError(
              "Could not send the change to the GM.",
              makeDiagnostic(
                {
                  operation: command.op,
                  stage: "send command",
                  requestId: id,
                  commandBytes: jsonBytes(command),
                },
                error,
              ),
            ),
          );
        });
      },
    );
    await read();
    return reply;
  }
  async function roll(commandData: Command) {
    const initiative = commandData.op === "initiative-roll";
    if (commandData.op !== "roll" && !initiative)
      throw new Error("Invalid roll command.");
    const preview = await command(
      initiative ? commandData : { ...commandData, op: "roll-preview" },
    );
    if (!preview.roll) {
      const result = await command(commandData);
      return result.notice ?? "Action used.";
    }
    if (!OBR.isAvailable) {
      const result = initiative
        ? preview
        : await command({
            ...commandData,
            expectedNotation: preview.roll.notation,
          } as Command);
      if (initiative && preview.roll.initiativeToken)
        await command({
          op: "initiative-result",
          crewId: commandData.crewId,
          token: preview.roll.initiativeToken,
          value: randomInitiative(preview.roll.notation),
        });
      return `${result.roll?.target === "gm_only" ? "Private" : "Public"} demo · ${result.roll?.notation}. No Dice+ roll sent.`;
    }
    const dice = createDicePlusClient("com.ddotts.crowbear.spaceship-combat");
    if (!(await dice.isReady()))
      throw new Error("Enable Dice+ in this room before rolling.");
    const validation = await dice.validateNotation(preview.roll.notation);
    if (!validation.valid)
      throw new Error(
        validation.error?.message ?? "Dice+ rejected this notation.",
      );
    const result = initiative
      ? preview
      : await command({
          ...commandData,
          expectedNotation: preview.roll.notation,
        } as Command);
    if (!result.roll) throw new Error("Roll preparation failed.");
    const rolled = await dice.roll({
      diceNotation: validation.notation,
      rollTarget: result.roll.target,
      showResults: true,
    });
    if (initiative && result.roll.initiativeToken)
      await command({
        op: "initiative-result",
        crewId: commandData.crewId,
        token: result.roll.initiativeToken,
        value: rolled.result.totalValue,
      });
    return initiative
      ? "Initiative added to the tracker."
      : "Roll complete. Dice+ displays it to the correct audience.";
  }
  async function activateSelection(
    commandData: Extract<
      Command,
      { op: "activate-selection" | "selection-preview" }
    >,
  ) {
    const preview = await command({ ...commandData, op: "selection-preview" });
    const dice =
      OBR.isAvailable && preview.roll
        ? createDicePlusClient("com.ddotts.crowbear.spaceship-combat")
        : undefined;
    let validatedNotation = preview.roll?.notation;
    if (dice) {
      if (!(await dice.isReady()))
        throw new Error(
          "Enable Dice+ in this room before activating this action.",
        );
      const validation = await dice.validateNotation(preview.roll!.notation);
      validatedNotation = validation.notation;
      if (!validation.valid)
        throw new Error(
          validation.error?.message ?? "Dice+ rejected this notation.",
        );
    }
    const result = await command({
      ...commandData,
      op: "activate-selection",
      expectedNotation: preview.roll?.notation ?? "",
    });
    if (!result.selectionId)
      throw new Error("Activation did not produce a selection.");
    let notice = result.notice ?? "Activation spent.";
    if (result.roll) {
      if (dice) {
        try {
          await dice.roll({
            diceNotation: validatedNotation ?? result.roll.notation,
            rollTarget: result.roll.target,
            showResults: true,
          });
          notice =
            "Roll complete. Choose a target; cancelling does not refund activation costs.";
        } catch (error) {
          notice = `Activation costs remain spent. Dice+ did not confirm the roll: ${error instanceof Error ? error.message : "Roll failed"}. Check Dice+ before resolving or cancelling.`;
        }
      } else
        notice = `${result.roll.target === "gm_only" ? "Private" : "Public"} demo · ${result.roll.notation}. Activation costs spent; choose a target.`;
    }
    return { selectionId: result.selectionId, notice };
  }
  return {
    start,
    command,
    activateSelection,
    roll,
    refresh: () => (OBR.isAvailable ? read() : Promise.resolve(showDemo())),
    setDemoRole: (role: "GM" | "Player") => {
      demoRole = role;
      showDemo();
    },
  };
}
