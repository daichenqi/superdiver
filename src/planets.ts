import type { Gloom, Weather } from "./model";

const WEATHER: readonly Weather[] = [
  "acid-storms",
  "blizzards",
  "extreme-cold",
  "fire-tornados",
  "intense-heat",
  "ion-storms",
  "meteor-storms",
  "rainstorms",
  "sandstorms",
  "thick-fog",
  "tremors",
  "volcanic-activity",
];

function isWeather(value: string): value is Weather {
  return (WEATHER as readonly string[]).includes(value);
}

export function mapPlanet(
  planet: { name: string; hazards?: { name: string }[] },
  tables: {
    hazards: Record<string, string>;
    gloom: Record<string, "light" | "moderate" | "heavy" | "source">;
  },
): { weather: Weather[]; gloom: Gloom; unknownHazards: string[] } {
  const gloom = tables.gloom[planet.name.trim()] ?? "none";
  const weather: Weather[] = [];
  const unknownHazards: string[] = [];

  for (const hazard of planet.hazards ?? []) {
    const mapped = tables.hazards[hazard.name.trim().toLowerCase()];
    if (mapped !== undefined && isWeather(mapped)) {
      if (!weather.includes(mapped)) weather.push(mapped);
      continue;
    }
    unknownHazards.push(hazard.name);
  }

  return { weather, gloom, unknownHazards };
}
