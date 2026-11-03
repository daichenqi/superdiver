import { describe, expect, it } from "vitest";
import { mapPlanet } from "./planets";

const tables = {
  hazards: { "ion storms": "ion-storms", "acid storms": "acid-storms" } as Record<string, "ion-storms" | "acid-storms">,
  gloom: { Hellmire: "heavy" as const },
};

describe("mapPlanet", () => {
  it("maps known hazards and gloom, and keeps unknown names", () => {
    const mapped = mapPlanet(
      { name: "Hellmire", hazards: [{ name: "Ion Storms" }, { name: "Spore Geysers" }] },
      tables,
    );
    expect(mapped.weather).toEqual(["ion-storms"]);
    expect(mapped.gloom).toBe("heavy");
    expect(mapped.unknownHazards).toEqual(["Spore Geysers"]);
  });
});
