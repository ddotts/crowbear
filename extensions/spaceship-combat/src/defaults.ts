import source from "./default-library.json";
import { type GmState, librarySchema, validateFleet } from "./schema";

export function defaultLibrary() {
  const library = librarySchema.parse(structuredClone(source));
  validateFleet(library.ships!, library.crew!);
  return library;
}

export function defaultFleet(kind: "Player" | "NPC") {
  const library = defaultLibrary();
  const ships = library.ships!.filter((ship) => ship.kind === kind);
  return {
    ships,
    crew: library.crew!.filter((member) =>
      ships.some((ship) => ship.id === member.ship),
    ),
  };
}

export function defaultGm(): GmState {
  const library = defaultLibrary();
  return {
    version: 1,
    ...defaultFleet("NPC"),
    encounters: library.encounters!,
    activeEncounterId: library.encounters![0]?.id ?? null,
  };
}
